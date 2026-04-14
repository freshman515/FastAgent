import { existsSync, accessSync, constants as fsConstants } from 'node:fs'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * Returns a list of filesystem roots Claude Code should be allowed to touch
 * when the user has explicitly opted into `bypassPermissions` mode.
 *
 * Claude Code's built-in "allowed working directories" restriction is NOT
 * removed by `--dangerously-skip-permissions` alone — the CLI still refuses
 * to operate on paths outside cwd / additional directories. The user-facing
 * expectation of "bypass" mode is full-disk write access, so when enabled we
 * also pass `--add-dir` for every drive root we can read.
 */
function collectBypassDirectories(cwd: string): string[] {
  const roots = new Set<string>()

  // Always include the user's home directory as a safe baseline
  try { roots.add(homedir()) } catch { /* ignore */ }

  if (process.platform === 'win32') {
    // Enumerate accessible drive letters (A-Z); cheap existsSync probe
    for (let code = 'A'.charCodeAt(0); code <= 'Z'.charCodeAt(0); code += 1) {
      const drive = `${String.fromCharCode(code)}:\\`
      try {
        accessSync(drive, fsConstants.F_OK)
        roots.add(drive)
      } catch {
        // Drive not present / not accessible — skip silently
      }
    }
  } else {
    // On POSIX, a single `/` is enough to cover everything
    roots.add('/')
  }

  // Never add cwd itself (Claude Code already has it) — avoid duplicate flags
  roots.delete(cwd)
  roots.delete(cwd.replace(/[/\\]+$/, ''))

  return [...roots]
}
import { StringDecoder } from 'node:string_decoder'
import type { WebContents } from 'electron'
import {
  IPC,
  type ClaudeDiffReviewOptions,
  type ClaudeDiffReviewResult,
  type ClaudeGuiEvent,
  type ClaudeGuiImagePayload,
  type ClaudeGuiLanguage,
  type ClaudeGuiRequestOptions,
  type ClaudePromptOptimizeOptions,
  type ClaudePromptOptimizeResult,
} from '@shared/types'

const VALID_MODELS = new Set([
  'default',
  'opus',
  'sonnet',
  'opusplan',
  'claude-opus-4-6',
  'claude-opus-4-5-20251101',
  'claude-sonnet-4-6',
  'claude-sonnet-4-5-20250929',
  'claude-haiku-4-5-20251001',
])

const TOOL_STATUS_MAP: Record<string, string> = {
  Agent: 'Launching subagent',
  Task: 'Launching subagent',
  Bash: 'Executing command',
  Read: 'Reading file',
  Edit: 'Editing file',
  Write: 'Writing file',
  Grep: 'Searching files',
  Glob: 'Finding files',
  TodoWrite: 'Updating tasks',
  WebFetch: 'Fetching web content',
  WebSearch: 'Searching web',
  NotebookEdit: 'Editing notebook',
  ToolSearch: 'Loading tool definitions',
  TaskOutput: 'Getting task output',
  TaskStop: 'Stopping task',
  AskUserQuestion: 'Waiting for user input',
  Skill: 'Executing skill',
  EnterPlanMode: 'Entering plan mode',
  ExitPlanMode: 'Exiting plan mode',
  EnterWorktree: 'Creating worktree',
  ExitWorktree: 'Exiting worktree',
  MultiEdit: 'Editing multiple files',
}

const MODEL_FOR_MAX_MODE = 'claude-sonnet-4-6'
const PROMPT_OPTIMIZER_MODEL = 'claude-haiku-4-5-20251001'

const LANGUAGE_PROMPTS: Record<ClaudeGuiLanguage, { communicate: string; full: string }> = {
  zh: {
    communicate: '\n\n请用中文与我交流。在编写代码时，代码注释请使用英文。',
    full: '\n\n请用中文与我交流。在编写代码时，代码注释也请使用中文。',
  },
  es: {
    communicate: '\n\nPor favor, comunicate conmigo en espanol. Al escribir codigo, usa ingles en los comentarios.',
    full: '\n\nPor favor, comunicate conmigo en espanol. Al escribir codigo, tambien usa espanol en los comentarios del codigo.',
  },
  ar: {
    communicate: '\n\nيرجى التواصل معي بالعربية. عند كتابة الكود، يرجى استخدام الإنجليزية في التعليقات.',
    full: '\n\nيرجى التواصل معي بالعربية. عند كتابة الكود، يرجى أيضا استخدام العربية في تعليقات الكود.',
  },
  fr: {
    communicate: '\n\nVeuillez communiquer avec moi en francais. Lors de l ecriture du code, utilisez l anglais pour les commentaires.',
    full: '\n\nVeuillez communiquer avec moi en francais. Lors de l ecriture du code, utilisez aussi le francais dans les commentaires.',
  },
  de: {
    communicate: '\n\nBitte kommunizieren Sie mit mir auf Deutsch. Beim Schreiben von Code verwenden Sie bitte Englisch fur Kommentare.',
    full: '\n\nBitte kommunizieren Sie mit mir auf Deutsch. Beim Schreiben von Code verwenden Sie bitte auch Deutsch in Kommentaren.',
  },
  ja: {
    communicate: '\n\n日本語で私と会話してください。コードを書く際は、コードコメントは英語で記述してください。',
    full: '\n\n日本語で私と会話してください。コードを書く際は、コードコメントも日本語で記述してください。',
  },
  ko: {
    communicate: '\n\n한국어로 대화해 주세요. 코드를 작성할 때 코드 주석은 영어로 작성해 주세요.',
    full: '\n\n한국어로 대화해 주세요. 코드를 작성할 때 코드 주석도 한국어로 작성해 주세요.',
  },
}

interface RequestState {
  requestId: string
  conversationId: string
  totalTokensInput: number
  totalTokensOutput: number
  currentTokensInput: number
  currentTokensOutput: number
  totalCost: number
  requestCount: number
  lastToolUseId?: string
  lastToolName?: string
}

interface PendingControlPermissionRequest {
  id: string
  conversationId: string
  toolName: string
  toolUseId?: string
  suggestions: unknown[]
}

function normalizeCwd(value: string): string {
  return value.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
}

function formatPermissionDetail(toolName: string, input: Record<string, unknown>, description?: string): string {
  if (typeof description === 'string' && description.trim()) return description.trim()
  if ((toolName === 'Edit' || toolName === 'Write' || toolName === 'Read') && typeof input.file_path === 'string') {
    return input.file_path
  }
  if (toolName === 'Bash' && typeof input.command === 'string') {
    return input.command
  }
  if ((toolName === 'Glob' || toolName === 'Grep') && typeof input.pattern === 'string') {
    return input.pattern
  }
  for (const value of Object.values(input)) {
    if (typeof value === 'string' && value.trim()) return value
  }
  return ''
}

function formatPermissionSuggestionLabel(toolName: string, suggestion: unknown): string {
  if (!suggestion || typeof suggestion !== 'object') return `Allow ${toolName}`
  const value = suggestion as {
    type?: unknown
    mode?: unknown
    ruleContent?: unknown
    toolName?: unknown
    rules?: unknown
  }

  if (value.type === 'setMode' && typeof value.mode === 'string') {
    return value.mode === 'acceptEdits' ? 'Auto-accept edits' : `Switch to ${value.mode}`
  }

  if (value.type === 'addRules') {
    const firstRule = Array.isArray(value.rules) && value.rules[0] && typeof value.rules[0] === 'object'
      ? value.rules[0] as { ruleContent?: unknown; toolName?: unknown }
      : null
    const ruleContent = typeof firstRule?.ruleContent === 'string'
      ? firstRule.ruleContent
      : (typeof value.ruleContent === 'string' ? value.ruleContent : '')
    const suggestionTool = typeof firstRule?.toolName === 'string'
      ? firstRule.toolName
      : (typeof value.toolName === 'string' ? value.toolName : toolName)

    if (ruleContent.includes('**')) {
      const dir = ruleContent.split('**')[0]?.replace(/[\\/]$/, '').split(/[\\/]/).pop() || ruleContent
      return `Allow ${suggestionTool} in ${dir}/`
    }

    if (ruleContent) {
      return `Always allow ${suggestionTool}`
    }
  }

  return `Allow ${toolName}`
}

function emit(sender: WebContents | null, payload: ClaudeGuiEvent): void {
  if (!sender || sender.isDestroyed()) return
  sender.send(IPC.CLAUDE_GUI_EVENT, payload)
}

function normalizeLabels(values: unknown): string[] {
  if (!Array.isArray(values)) return []
  return values.flatMap((item) => {
    if (typeof item === 'string') return [item]
    if (!item || typeof item !== 'object') return []
    const value = item as { name?: unknown; id?: unknown; label?: unknown }
    if (typeof value.name === 'string') return [value.name]
    if (typeof value.id === 'string') return [value.id]
    if (typeof value.label === 'string') return [value.label]
    return []
  })
}

function getToolStatusText(toolName: string): string {
  return TOOL_STATUS_MAP[toolName] ?? 'Processing'
}

function shouldHideToolResult(toolName: string | undefined, isError: boolean): boolean {
  if (toolName === 'AskUserQuestion' || toolName === 'ExitPlanMode') return true
  if (isError) return false
  return ['Read', 'Edit', 'TodoWrite', 'MultiEdit'].includes(toolName ?? '')
}

function formatResultContent(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    const textParts = content
      .filter((block) => block && typeof block === 'object' && (block as { type?: unknown }).type === 'text')
      .map((block) => (block as { text?: unknown }).text)
      .filter((text): text is string => typeof text === 'string')
    if (textParts.length > 0) return textParts.join('\n')
  }
  if (content && typeof content === 'object') return JSON.stringify(content, null, 2)
  return String(content ?? '')
}

function buildPromptText(options: ClaudeGuiRequestOptions): string {
  if (options.text.trim().startsWith('/')) {
    return options.text.trim()
  }

  let actualMessage = options.text

  if (options.planMode) {
    actualMessage = 'ENTER PLAN MODE: Use the EnterPlanMode tool to enter planning mode. Create a detailed implementation plan and wait for my explicit approval before making any changes. Do not implement anything until I confirm. This planning requirement applies only to this current message.\n\n' + actualMessage
  }

  if (options.thinkingMode) {
    actualMessage = `THINK HARD THROUGH THIS STEP BY STEP:\n\n${actualMessage}`
  }

  if (options.languageMode && options.language) {
    const prompt = LANGUAGE_PROMPTS[options.language]
    if (prompt) {
      actualMessage += options.onlyCommunicate ? prompt.communicate : prompt.full
    }
  }

  return actualMessage
}

function buildUserMessage(text: string, images?: ClaudeGuiImagePayload[]): object {
  const content: Array<Record<string, unknown>> = [{ type: 'text', text }]

  for (const image of images ?? []) {
    content.push({
      type: 'image',
      source: {
        type: 'base64',
        media_type: image.mediaType,
        data: image.data,
      },
    })
  }

  return {
    type: 'user',
    message: {
      role: 'user',
      content,
    },
  }
}

function buildPromptOptimizerText(options: ClaudePromptOptimizeOptions): string {
  const source = options.prompt.trim()
  const extraInstruction = options.instruction?.trim()

  return [
    'You are a prompt engineering assistant.',
    'Rewrite the user prompt into a clearer, more complete, directly usable prompt.',
    'Preserve the original intent and language. If the source prompt is Chinese, output Chinese.',
    'Do not answer the task described by the prompt.',
    'Do not use tools. Return only the improved prompt. Do not wrap it in markdown fences unless the prompt itself requires fences.',
    extraInstruction ? `[User optimization instruction]\n${extraInstruction}` : '',
    `[Original prompt]\n${source}`,
  ].filter(Boolean).join('\n\n')
}

function buildDiffReviewText(options: ClaudeDiffReviewOptions): string {
  const maxDiffChars = 160000
  const rawDiff = options.diff.trim()
  const diff = rawDiff.length > maxDiffChars
    ? `${rawDiff.slice(0, maxDiffChars)}\n\n[DIFF TRUNCATED: ${rawDiff.length - maxDiffChars} chars omitted]`
    : rawDiff
  const files = options.files
    .map((file) => `${file.staged ? 'staged' : 'worktree'} ${file.status} ${file.path}`)
    .join('\n')

  return [
    'You are a senior software engineer performing a pre-commit code review.',
    'Review only the supplied git diff. This is a code review for local Git changes, not a pull request review. Do not mention PR, pull request, merge request, reviewer approval, or merge decisions.',
    'Prioritize real defects: bugs, behavioral regressions, data loss, security issues, race conditions, broken IPC/API contracts, missing validation, and missing tests. Avoid style nits unless they hide a real risk.',
    'Output in Chinese as a polished Markdown report. Do not wrap the entire answer in a code fence. Keep the report useful but not excessively long.',
    'Use this exact report style and section order:',
    '# 代码审查报告',
    '欢迎查看审查结果！本次审查已完成，以下是基于当前 Git 更改的详细分析和建议。',
    '使用提示：文件位置请使用 `path:line` 或 `path · symbol/section`，便于后续跳转和定位。',
    '## 审查概览 · 一目了然',
    'Create a Markdown table with columns: 审查项目, 发现数量, 占比, 处理状态. Include rows for 审查文件, 严重问题, 中等问题, 轻微问题. Counts must match your findings. If there are no findings in a category, use 0 and ✅ 无问题.',
    'Add a short score block: 综合评分: N/100, 本次等级: 优秀/良好/一般/需修复. Score based on actual risk, not optimism.',
    'Add 问题分布 with simple text bars for 严重/中等/轻微. Percentages must be internally consistent.',
    '## 关键发现',
    'Create a Markdown table with columns: 类别, 发现数量, 优先级, 趋势. Categories should include 安全性, 性能, 代码质量, 健壮性, 测试覆盖. Use 0 when no issue exists.',
    '## 问题清单与修复指南',
    'List every issue grouped by severity: 严重问题, 中等问题, 轻微问题. If no issue in a severity, write “无”。',
    'For each issue use this format: **#编号 标题** — `file:line` or `file · symbol`; then include 风险, 原因, 建议修复. Keep each item concrete and actionable.',
    '## 亮点与肯定',
    'List 3-7 concrete strengths from the diff. If the diff is too small to infer strengths, write the real observable strengths only.',
    '## 最终建议',
    'Give one of: ✅ 可以提交, ⚠️ 修复后提交, ❌ 暂不建议提交. Then give 2-5 concrete action items. Do not use “合并” wording.',
    'For each finding, include file path and the best line reference you can infer from the diff. If a line number is not inferable, include the file path and the relevant symbol/section.',
    'Do not invent issues, counts, or file paths. If the diff is truncated, explicitly mention that the review may be incomplete.',
    `[Branch]\n${options.branch ?? 'unknown'}`,
    `[Changed files]\n${files || 'none'}`,
    `[Git diff]\n${diff}`,
  ].join('\n\n')
}

function collectAssistantText(payload: any): string[] {
  if (!payload || typeof payload !== 'object') return []

  if (payload.type !== 'assistant' || !payload.message || typeof payload.message !== 'object') {
    return []
  }

  const content = Array.isArray(payload.message.content) ? payload.message.content : []
  return content
    .filter((block) => block && typeof block === 'object' && block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text as string)
}

function getClaudeSpawnTarget(args: string[]): { command: string; args: string[] } {
  if (process.platform !== 'win32') {
    return { command: 'claude', args }
  }

  const appData = process.env.APPDATA
  const localCmd = appData ? join(appData, 'npm', 'claude.cmd') : null

  if (localCmd && existsSync(localCmd)) {
    const cmd = process.env.COMSPEC || 'C:\\Windows\\System32\\cmd.exe'
    return {
      command: cmd,
      args: ['/d', '/c', localCmd, ...args],
    }
  }

  return { command: 'claude', args }
}

async function killProcessTree(proc: ChildProcessWithoutNullStreams): Promise<void> {
  if (proc.killed) return

  if (process.platform === 'win32' && proc.pid) {
    await new Promise<void>((resolve) => {
      const killer = spawn('taskkill', ['/pid', String(proc.pid), '/T', '/F'], {
        windowsHide: true,
        stdio: 'ignore',
      })
      killer.once('exit', () => resolve())
      killer.once('error', () => resolve())
    })
    return
  }

  try {
    proc.kill('SIGTERM')
  } catch {
    // Ignore missing process errors.
  }
}

function runClaudeOneShot(promptText: string, cwd: string, emptyMessage: string): Promise<string> {
  const args = [
    '-p',
    '--output-format',
    'stream-json',
    '--input-format',
    'stream-json',
    '--verbose',
    '--model',
    PROMPT_OPTIMIZER_MODEL,
  ]
  const launch = getClaudeSpawnTarget(args)

  return new Promise<string>((resolve, reject) => {
    const proc = spawn(launch.command, launch.args, {
      cwd,
      env: {
        ...(process.env as Record<string, string>),
      },
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    let stdoutBuffer = ''
    let stderrBuffer = ''
    let settled = false
    const outputParts: string[] = []
    const stdoutDecoder = new StringDecoder('utf8')
    const stderrDecoder = new StringDecoder('utf8')

    const fail = (error: Error): void => {
      if (settled) return
      settled = true
      reject(error)
    }

    const processLine = (line: string): void => {
      const text = line.trim()
      if (!text) return

      try {
        const payload = JSON.parse(text)
        if (payload?.error && typeof payload.error === 'string') {
          fail(new Error(payload.error.includes('login')
            ? 'Authentication required. Please run `claude login` in your terminal first.'
            : payload.error))
          return
        }
        const assistantParts = collectAssistantText(payload)
        if (assistantParts.length > 0) {
          outputParts.push(...assistantParts)
        } else if (outputParts.length === 0 && payload?.type === 'result' && typeof payload.result === 'string') {
          outputParts.push(payload.result)
        }
      } catch {
        outputParts.push(`${text}\n`)
      }
    }

    proc.stdout.on('data', (chunk) => {
      stdoutBuffer += stdoutDecoder.write(chunk)
      const lines = stdoutBuffer.split(/\r?\n/)
      stdoutBuffer = lines.pop() ?? ''
      for (const line of lines) processLine(line)
    })

    proc.stderr.on('data', (chunk) => {
      stderrBuffer += stderrDecoder.write(chunk)
    })

    proc.once('error', (error) => {
      fail(error)
    })

    proc.once('close', (code) => {
      if (settled) return
      stdoutBuffer += stdoutDecoder.end()
      stderrBuffer += stderrDecoder.end()
      if (stdoutBuffer.trim()) processLine(stdoutBuffer)

      const stderrText = stderrBuffer.trim()
      if (code !== 0) {
        fail(new Error(stderrText.includes('login')
          ? 'Authentication required. Please run `claude login` in your terminal first.'
          : stderrText || `Claude exited with code ${code ?? 0}`))
        return
      }

      const content = outputParts.join('').trim()
      if (!content) {
        fail(new Error(stderrText || emptyMessage))
        return
      }

      settled = true
      resolve(content)
    })

    proc.stdin.write(JSON.stringify(buildUserMessage(promptText)) + '\n')
    proc.stdin.end()
  })
}

export class ClaudeGuiService {
  private currentProcess: ChildProcessWithoutNullStreams | null = null
  private currentSender: WebContents | null = null
  private currentConversationId: string | null = null
  private currentCwd: string | null = null
  private stdinClosed = false
  private readonly pendingControlPermissionRequests = new Map<string, PendingControlPermissionRequest>()

  findConversationIdByCwd(cwd: string): string | null {
    if (!this.currentConversationId || !this.currentCwd) return null
    return normalizeCwd(this.currentCwd) === normalizeCwd(cwd) ? this.currentConversationId : null
  }

  resolvePermissionRequest(id: string, behavior: 'allow' | 'deny', suggestionIndex?: number): boolean {
    const request = this.pendingControlPermissionRequests.get(id)
    const proc = this.currentProcess
    const sender = this.currentSender
    if (!request || !proc || this.stdinClosed || proc.stdin.destroyed) return false

    this.pendingControlPermissionRequests.delete(id)
    const selectedSuggestion = typeof suggestionIndex === 'number' ? request.suggestions[suggestionIndex] : undefined
    const response =
      behavior === 'allow'
        ? {
            behavior: 'allow',
            ...(request.toolUseId ? { toolUseID: request.toolUseId } : {}),
            ...(selectedSuggestion ? { updatedPermissions: [selectedSuggestion], decisionClassification: 'user_permanent' } : { decisionClassification: 'user_temporary' }),
          }
        : {
            behavior: 'deny',
            message: 'Denied by user',
            ...(request.toolUseId ? { toolUseID: request.toolUseId } : {}),
            decisionClassification: 'user_reject',
          }

    proc.stdin.write(JSON.stringify({
      type: 'control_response',
      response: {
        subtype: 'success',
        request_id: id,
        response,
      },
    }) + '\n')

    if (sender && !sender.isDestroyed()) {
      sender.send(IPC.PERMISSION_DISMISS, { id })
    }

    return true
  }

  private closeStdin(): void {
    if (this.stdinClosed) return
    if (!this.currentProcess || this.currentProcess.stdin.destroyed) return
    this.stdinClosed = true
    this.currentProcess.stdin.end()
  }

  private dismissPendingControlPermissions(sender: WebContents | null): void {
    for (const id of this.pendingControlPermissionRequests.keys()) {
      if (sender && !sender.isDestroyed()) {
        sender.send(IPC.PERMISSION_DISMISS, { id })
      }
    }
    this.pendingControlPermissionRequests.clear()
  }

  async optimizePrompt(options: ClaudePromptOptimizeOptions): Promise<ClaudePromptOptimizeResult> {
    const prompt = options.prompt?.trim()
    if (!prompt) {
      throw new Error('Prompt is empty')
    }

    const cwd = typeof options.cwd === 'string' && options.cwd.trim() ? options.cwd : process.cwd()
    const content = await runClaudeOneShot(
      buildPromptOptimizerText({ ...options, prompt }),
      cwd,
      'Claude returned an empty optimized prompt',
    )
    return { content }
  }

  async reviewDiff(options: ClaudeDiffReviewOptions): Promise<ClaudeDiffReviewResult> {
    const diff = options.diff?.trim()
    if (!diff) {
      throw new Error('Git diff is empty')
    }

    const cwd = typeof options.cwd === 'string' && options.cwd.trim() ? options.cwd : process.cwd()
    const content = await runClaudeOneShot(
      buildDiffReviewText({ ...options, cwd, diff }),
      cwd,
      'Claude returned an empty code review',
    )
    return { content }
  }

  async start(sender: WebContents, options: ClaudeGuiRequestOptions): Promise<void> {
    if (this.currentProcess) {
      throw new Error('Claude Code GUI already has a running request')
    }

    const args = [
      '-p',
      '--output-format',
      'stream-json',
      '--input-format',
      'stream-json',
      '--verbose',
    ]

    if (options.permissionMode) {
      args.push('--permission-mode', options.permissionMode)
    }

    if (options.permissionMode === 'bypassPermissions') {
      args.push('--dangerously-skip-permissions')
      // Expand the "allowed working directories" set so Claude Code's
      // hardcoded cwd check doesn't block operations on other drives/paths.
      for (const dir of collectBypassDirectories(options.cwd)) {
        args.push('--add-dir', dir)
      }
    }

    if (options.sessionId) {
      args.push('--resume', options.sessionId)
    }

    if (options.model && VALID_MODELS.has(options.model) && options.model !== 'default') {
      args.push('--model', options.model)
    }

    const env: Record<string, string> = {
      ...(process.env as Record<string, string>),
    }

    if (options.computeMode === 'max') {
      env.ANTHROPIC_DEFAULT_HAIKU_MODEL = MODEL_FOR_MAX_MODE
    } else {
      delete env.ANTHROPIC_DEFAULT_HAIKU_MODEL
    }

    const launch = getClaudeSpawnTarget(args)
    const proc = spawn(launch.command, launch.args, {
      cwd: options.cwd,
      env,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    this.currentProcess = proc
    this.currentSender = sender
    this.currentConversationId = options.conversationId
    this.currentCwd = options.cwd
    this.stdinClosed = false
    this.pendingControlPermissionRequests.clear()

    const state: RequestState = {
      requestId: options.requestId,
      conversationId: options.conversationId,
      totalTokensInput: 0,
      totalTokensOutput: 0,
      currentTokensInput: 0,
      currentTokensOutput: 0,
      totalCost: 0,
      requestCount: 0,
    }

    emit(sender, {
      requestId: options.requestId,
      conversationId: options.conversationId,
      type: 'processing',
      active: true,
    })

    const userMessage = buildUserMessage(buildPromptText(options), options.images)
    proc.stdin.write(JSON.stringify(userMessage) + '\n')

    let stdoutBuffer = ''
    let stderrBuffer = ''
    const stdoutDecoder = new StringDecoder('utf8')
    const stderrDecoder = new StringDecoder('utf8')

    proc.stdout.on('data', (chunk) => {
      stdoutBuffer += stdoutDecoder.write(chunk)
      const lines = stdoutBuffer.split(/\r?\n/)
      stdoutBuffer = lines.pop() ?? ''

      for (const line of lines) {
        if (!line.trim()) continue
        this.processLine(line, sender, state)
      }
    })

    proc.stderr.on('data', (chunk) => {
      stderrBuffer += stderrDecoder.write(chunk)
      const lines = stderrBuffer.split(/\r?\n/)
      stderrBuffer = lines.pop() ?? ''

      for (const line of lines) {
        const text = line.trim()
        if (!text) continue
        emit(sender, {
          requestId: state.requestId,
          conversationId: state.conversationId,
          type: 'error',
          error: text.includes('login')
            ? 'Authentication required. Please run `claude login` in your terminal first.'
            : text,
        })
      }
    })

    proc.once('error', (error) => {
      emit(sender, {
        requestId: state.requestId,
        conversationId: state.conversationId,
        type: 'error',
        error: error.message,
      })
    })

    proc.once('close', (code) => {
      stdoutBuffer += stdoutDecoder.end()
      stderrBuffer += stderrDecoder.end()
      if (stdoutBuffer.trim()) {
        this.processLine(stdoutBuffer.trim(), sender, state)
      }
      if (stderrBuffer.trim()) {
        emit(sender, {
          requestId: state.requestId,
          conversationId: state.conversationId,
          type: 'error',
          error: stderrBuffer.trim(),
        })
      }

      if (this.currentProcess === proc) {
        this.dismissPendingControlPermissions(sender)
        this.currentProcess = null
        this.currentSender = null
        this.currentConversationId = null
        this.currentCwd = null
        this.stdinClosed = true
      }

      emit(sender, {
        requestId: state.requestId,
        conversationId: state.conversationId,
        type: 'processing',
        active: false,
      })
      emit(sender, {
        requestId: state.requestId,
        conversationId: state.conversationId,
        type: 'closed',
        exitCode: code ?? 0,
      })
    })
  }

  async stop(): Promise<void> {
    const proc = this.currentProcess
    const sender = this.currentSender
    if (!proc) return

    this.dismissPendingControlPermissions(sender)
    this.currentProcess = null
    this.currentSender = null
    this.currentConversationId = null
    this.currentCwd = null
    this.stdinClosed = true
    await killProcessTree(proc)
  }

  private processLine(line: string, sender: WebContents, state: RequestState): void {
    try {
      const payload = JSON.parse(line)
      this.processJson(payload, sender, state)
    } catch {
      emit(sender, {
        requestId: state.requestId,
        conversationId: state.conversationId,
        type: 'system',
        messageId: `system-${Date.now()}`,
        text: line,
      })
    }
  }

  private processJson(payload: any, sender: WebContents, state: RequestState): void {
    if (!payload || typeof payload !== 'object') return

    if (payload.type === 'system' && payload.subtype === 'init') {
      emit(sender, {
        requestId: state.requestId,
        conversationId: state.conversationId,
        type: 'connected',
        sessionId: typeof payload.session_id === 'string' ? payload.session_id : undefined,
        model: typeof payload.model === 'string' ? payload.model : undefined,
        tools: normalizeLabels(payload.tools),
        skills: normalizeLabels(payload.skills),
      })
      return
    }

    if (payload.type === 'result') {
      this.processResult(payload, sender, state)
      return
    }

    if (payload.type === 'tool_progress') {
      emit(sender, {
        requestId: state.requestId,
        conversationId: state.conversationId,
        type: 'tool-status',
        toolUseId: typeof payload.tool_use_id === 'string' ? payload.tool_use_id : undefined,
        toolName: typeof payload.tool_name === 'string' ? payload.tool_name : 'unknown',
        status: `⏳ ${getToolStatusText(payload.tool_name ?? 'unknown')} (${Math.floor(payload.elapsed_time_seconds ?? 0)}s)`,
      })
      return
    }

    if (payload.type === 'control_request') {
      const request = payload.request && typeof payload.request === 'object'
        ? payload.request as Record<string, unknown>
        : null
      const requestId = typeof payload.request_id === 'string' ? payload.request_id : null
      if (requestId && request?.subtype === 'can_use_tool') {
        const toolName = typeof request.tool_name === 'string' ? request.tool_name : 'Unknown'
        const input = request.input && typeof request.input === 'object' ? request.input as Record<string, unknown> : {}
        const description = typeof request.description === 'string' ? request.description : undefined
        const suggestions = Array.isArray(request.permission_suggestions) ? request.permission_suggestions : []

        this.pendingControlPermissionRequests.set(requestId, {
          id: requestId,
          conversationId: state.conversationId,
          toolName,
          toolUseId: typeof request.tool_use_id === 'string' ? request.tool_use_id : undefined,
          suggestions,
        })

        if (!sender.isDestroyed()) {
          sender.send(IPC.PERMISSION_REQUEST, {
            id: requestId,
            sessionId: null,
            conversationId: state.conversationId,
            toolName,
            detail: formatPermissionDetail(toolName, input, description),
            suggestions: suggestions.map((suggestion) => formatPermissionSuggestionLabel(toolName, suggestion)),
          })
        }
        return
      }
    }

    if (payload.type === 'control_cancel_request' && typeof payload.request_id === 'string') {
      this.pendingControlPermissionRequests.delete(payload.request_id)
      if (!sender.isDestroyed()) {
        sender.send(IPC.PERMISSION_DISMISS, { id: payload.request_id })
      }
      return
    }

    if (payload.error && typeof payload.error === 'string') {
      emit(sender, {
        requestId: state.requestId,
        conversationId: state.conversationId,
        type: 'error',
        error: payload.error.includes('login')
          ? 'Authentication required. Please run `claude login` in your terminal first.'
          : payload.error,
      })
      return
    }

    if ((payload.type === 'assistant' || payload.type === 'user' || payload.type === 'system') && payload.message) {
      this.processMessage(payload.message, sender, state)
    }
  }

  private processMessage(message: any, sender: WebContents, state: RequestState): void {
    if (message.usage) {
      const inputTokens = Number(message.usage.input_tokens ?? 0)
      const outputTokens = Number(message.usage.output_tokens ?? 0)
      const cacheCreationTokens = Number(message.usage.cache_creation_input_tokens ?? 0)
      const cacheReadTokens = Number(message.usage.cache_read_input_tokens ?? 0)

      state.totalTokensInput += inputTokens
      state.totalTokensOutput += outputTokens
      state.currentTokensInput += inputTokens
      state.currentTokensOutput += outputTokens

      emit(sender, {
        requestId: state.requestId,
        conversationId: state.conversationId,
        type: 'usage',
        usage: {
          totalTokensInput: state.totalTokensInput,
          totalTokensOutput: state.totalTokensOutput,
          currentInputTokens: inputTokens,
          currentOutputTokens: outputTokens,
          cacheCreationTokens,
          cacheReadTokens,
        },
      })
    }

    const messageId = typeof message.id === 'string' ? message.id : `msg-${Date.now()}`
    const content = Array.isArray(message.content) ? message.content : []

    if (message.role === 'system') {
      for (const block of content) {
        if (block?.type !== 'text' || typeof block.text !== 'string') continue
        emit(sender, {
          requestId: state.requestId,
          conversationId: state.conversationId,
          type: 'system',
          messageId,
          text: block.text,
        })
      }
      return
    }

    if (message.role === 'assistant') {
      for (const block of content) {
        if (!block || typeof block !== 'object') continue

        if (block.type === 'text' && typeof block.text === 'string') {
          emit(sender, {
            requestId: state.requestId,
            conversationId: state.conversationId,
            type: 'assistant',
            messageId,
            text: block.text,
          })
          continue
        }

        if (block.type === 'thinking' && typeof block.text === 'string') {
          emit(sender, {
            requestId: state.requestId,
            conversationId: state.conversationId,
            type: 'thinking',
            messageId,
            text: block.text,
          })
          continue
        }

        if (block.type === 'tool_use') {
          const toolUseId = typeof block.id === 'string' ? block.id : `tool-${Date.now()}`
          const toolName = typeof block.name === 'string' ? block.name : 'unknown'
          state.lastToolUseId = toolUseId
          state.lastToolName = toolName

          if (toolName === 'EnterPlanMode') {
            emit(sender, {
              requestId: state.requestId,
              conversationId: state.conversationId,
              type: 'plan-mode',
              active: true,
            })
          } else if (toolName === 'ExitPlanMode') {
            emit(sender, {
              requestId: state.requestId,
              conversationId: state.conversationId,
              type: 'plan-mode',
              active: false,
            })
          }

          emit(sender, {
            requestId: state.requestId,
            conversationId: state.conversationId,
            type: 'tool-use',
            messageId,
            toolUseId,
            toolName,
            rawInput: block.input,
          })

          emit(sender, {
            requestId: state.requestId,
            conversationId: state.conversationId,
            type: 'tool-status',
            toolUseId,
            toolName,
            status: getToolStatusText(toolName),
          })
        }
      }
      return
    }

    if (message.role === 'user') {
      for (const block of content) {
        if (!block || typeof block !== 'object' || block.type !== 'tool_result') continue
        const text = formatResultContent(block.content)
        const isError = block.is_error === true
        emit(sender, {
          requestId: state.requestId,
          conversationId: state.conversationId,
          type: 'tool-result',
          toolUseId: typeof block.tool_use_id === 'string' ? block.tool_use_id : state.lastToolUseId,
          toolName: state.lastToolName,
          text,
          isError,
          hidden: shouldHideToolResult(state.lastToolName, isError),
        })
      }
    }
  }

  private processResult(payload: any, sender: WebContents, state: RequestState): void {
    if (payload.error && typeof payload.error === 'string' && payload.error.includes('login')) {
      emit(sender, {
        requestId: state.requestId,
        conversationId: state.conversationId,
        type: 'error',
        error: 'Authentication required. Please run `claude login` in your terminal first.',
      })
      return
    }

    state.requestCount += 1
    state.totalCost += Number(payload.total_cost_usd ?? 0)
    this.closeStdin()

    emit(sender, {
      requestId: state.requestId,
      conversationId: state.conversationId,
      type: 'result',
      result: {
        sessionId: typeof payload.session_id === 'string' ? payload.session_id : undefined,
        totalCost: Number(payload.total_cost_usd ?? 0),
        duration: Number(payload.duration_ms ?? 0),
        turns: Number(payload.num_turns ?? 0),
        totalTokensInput: state.totalTokensInput,
        totalTokensOutput: state.totalTokensOutput,
        requestCount: state.requestCount,
        currentTokensInput: state.currentTokensInput,
        currentTokensOutput: state.currentTokensOutput,
      },
    })

    state.currentTokensInput = 0
    state.currentTokensOutput = 0
  }
}

export const claudeGuiService = new ClaudeGuiService()
