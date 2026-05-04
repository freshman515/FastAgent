import { ChevronDown, ChevronRight, GitBranch, RefreshCw, Circle, Plus, Minus, Undo2, Check, ExternalLink, File, Folder, FolderOpen, Loader2, Trash2, Wrench } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { createPortal } from 'react-dom'
import { isCodexType, type SessionType } from '@shared/types'
import { cn, generateId } from '@/lib/utils'
import claudeIcon from '@/assets/icons/Claude.png'
import { useProjectsStore } from '@/stores/projects'
import { useWorktreesStore } from '@/stores/worktrees'
import { useGitStore } from '@/stores/git'
import { detectLanguage, FILE_ICONS, useEditorsStore } from '@/stores/editors'
import { usePanesStore } from '@/stores/panes'
import { useUIStore, type GitReviewMode } from '@/stores/ui'
import { useGitReviewStore } from '@/stores/gitReview'
import { useSessionsStore } from '@/stores/sessions'
import { useClaudeGuiStore, type ClaudeGuiPreferences } from '@/stores/claudeGui'
import { renderMarkdown } from '@/lib/markdown'
import { filterSessionTypesForCurrentPlatform } from '@/lib/platformSessionTypes'
import { parseCustomSessionArgs } from '@/lib/createSession'
import { SESSION_OPTIONS, getCustomSessionOptionId } from '@/components/session/NewSessionMenu'
import { SessionIconView } from '@/components/session/SessionIconView'

interface GitFileStatus {
  path: string
  status: string
  staged: boolean
}

type GitTreeNode = GitTreeDirectory | GitTreeFile

interface GitTreeDirectory {
  type: 'directory'
  name: string
  path: string
  count: number
  children: GitTreeNode[]
}

interface GitTreeFile {
  type: 'file'
  name: string
  path: string
  file: GitFileStatus
}

interface MutableGitTreeDirectory {
  name: string
  path: string
  count: number
  directories: Map<string, MutableGitTreeDirectory>
  files: GitTreeFile[]
}

const STATUS_COLORS: Record<string, string> = {
  M: 'text-[var(--color-warning)]',
  A: 'text-[var(--color-success)]',
  D: 'text-[var(--color-error)]',
  '?': 'text-[var(--color-text-tertiary)]',
  R: 'text-[var(--color-info)]',
  U: 'text-[var(--color-error)]',
}

const STATUS_LABELS: Record<string, string> = {
  M: 'M', A: 'A', D: 'D', '?': 'U', R: 'R', U: 'U',
}

const HEADER_ICON_BUTTON = 'flex h-6 w-6 items-center justify-center rounded-[var(--radius-sm)] text-[var(--color-text-tertiary)] transition-colors hover:bg-[var(--color-bg-surface)] hover:text-[var(--color-text-secondary)]'
const ROW_ICON_BUTTON = 'flex h-5.5 w-5.5 items-center justify-center rounded-[var(--radius-sm)] text-[var(--color-text-tertiary)] transition-colors hover:bg-[var(--color-bg-surface)]'
const GIT_FLOW_BUTTON = 'inline-flex h-7 items-center justify-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-bg-primary)] px-2 text-[10px] font-medium text-[var(--color-text-secondary)] transition-colors hover:border-[var(--color-border-hover)] hover:text-[var(--color-text-primary)] disabled:cursor-not-allowed disabled:opacity-40'
const GIT_TAB_BUTTON = 'flex h-8 flex-1 items-center justify-center gap-1.5 rounded-[var(--radius-sm)] px-2 text-[var(--ui-font-xs)] font-medium transition-colors'
const REVIEW_RUNNER_BUTTON = 'inline-flex h-7 min-w-0 items-center justify-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-bg-primary)] px-2 text-[10px] font-medium text-[var(--color-text-secondary)] transition-colors hover:border-[var(--color-border-hover)] hover:text-[var(--color-text-primary)]'
const CLAUDE_REVIEW_FIX_MODEL = 'claude-opus-4-6'
const REVIEW_RUNNER_MENU_WIDTH = 220
const REVIEW_RESULT_PENDING_MARKER = '<!-- FASTAGENTS_REVIEW_PENDING -->'
const REVIEW_RESULT_POLL_INTERVAL_MS = 1500
const REVIEW_RESULT_TIMEOUT_MS = 30 * 60 * 1000
const REVIEW_CAPTURE_MAX_CHARS = 120000
const DEFAULT_AGENT_TASK_SUBMIT_DELAY_MS = 1200
const CODEX_TASK_SUBMIT_DELAY_MS = 10000

const REVIEW_SESSION_TYPES = new Set<SessionType>([
  'claude-code',
  'claude-code-yolo',
  'claude-code-wsl',
  'claude-code-yolo-wsl',
  'codex',
  'codex-yolo',
  'codex-wsl',
  'codex-yolo-wsl',
  'gemini',
  'gemini-yolo',
  'opencode',
])

interface ReviewRunnerOption {
  id: string
  label: string
  description: string
  icon?: string
  fallbackSrc?: string
  customIcon: boolean
  kind: 'claude-gui' | 'session' | 'custom'
  type?: SessionType
  customSessionDefinitionId?: string
  customSessionCommand?: string
  customSessionArgs?: string[]
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

function stripAnsiText(value: string): string {
  return value
    .replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, '')
    .replace(/\r/g, '\n')
}

function normalizeReviewResultFile(raw: string): string {
  return raw.replace(REVIEW_RESULT_PENDING_MARKER, '').trim()
}

function extractCapturedReviewOutput(output: string): string | null {
  const clean = stripAnsiText(output)
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => {
      const trimmed = line.trim()
      return trimmed
        && !trimmed.includes('请先完整读取并严格执行这个代码审查任务文件')
        && !trimmed.includes('fastagents-ai-review-')
        && !trimmed.includes('fastagents-ai-review-result-')
        && trimmed !== '要求：'
        && !/^\d+\.\s/.test(trimmed)
    })
    .join('\n')
    .trim()

  return clean.length >= 80 ? clean : null
}

async function waitForReviewResult(resultFilePath: string, ptyId: string): Promise<string> {
  let capturedOutput = ''
  let exited = false
  const offData = window.api.session.onData((event) => {
    if (event.ptyId !== ptyId) return
    capturedOutput += event.data
    if (capturedOutput.length > REVIEW_CAPTURE_MAX_CHARS) {
      capturedOutput = capturedOutput.slice(-REVIEW_CAPTURE_MAX_CHARS)
    }
  })
  const offExit = window.api.session.onExit((event) => {
    if (event.ptyId === ptyId) exited = true
  })

  try {
    const startedAt = Date.now()
    while (Date.now() - startedAt < REVIEW_RESULT_TIMEOUT_MS) {
      const fileContent = await window.api.fs.readFile(resultFilePath).catch(() => '')
      const review = normalizeReviewResultFile(fileContent)
      if (review) return review

      if (exited) {
        const fallback = extractCapturedReviewOutput(capturedOutput)
        if (fallback) return fallback
        throw new Error('AI 审查会话已退出，但没有写入审查结果文件。请在审查标签页查看输出。')
      }

      await delay(REVIEW_RESULT_POLL_INTERVAL_MS)
    }

    const fallback = extractCapturedReviewOutput(capturedOutput)
    if (fallback) return fallback
    throw new Error('AI 审查超时：没有读取到审查结果文件。请在审查标签页查看输出。')
  } finally {
    offData()
    offExit()
  }
}

async function waitForSessionPty(sessionId: string, timeoutMs = 15000, intervalMs = 500): Promise<string> {
  const attempts = Math.max(1, Math.ceil(timeoutMs / intervalMs))
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const session = useSessionsStore.getState().sessions.find((item) => item.id === sessionId)
    if (session?.ptyId) return session.ptyId
    await delay(intervalMs)
  }
  throw new Error('AI 审查会话启动超时，请检查标签页是否正常打开。')
}

function buildReviewRunnerOptions(
  customDefinitions: Array<{ id: string; name: string; icon: string; command: string; args: string }>,
): ReviewRunnerOption[] {
  const builtInOptions: ReviewRunnerOption[] = filterSessionTypesForCurrentPlatform(SESSION_OPTIONS)
    .filter((option) => REVIEW_SESSION_TYPES.has(option.type))
    .map((option) => ({
      id: option.type,
      label: option.label,
      description: '新开标签页并发送审查任务',
      fallbackSrc: option.icon,
      customIcon: false,
      kind: 'session',
      type: option.type,
    }))

  return [
    {
      id: 'claude-gui',
      label: 'Claude GUI',
      description: '直接在 Git 面板返回审查结果',
      fallbackSrc: claudeIcon,
      customIcon: false,
      kind: 'claude-gui',
    },
    ...builtInOptions,
    ...customDefinitions.map((definition) => ({
      id: getCustomSessionOptionId(definition.id),
      label: definition.name,
      description: '自定义启动器',
      icon: definition.icon,
      customIcon: true,
      kind: 'custom' as const,
      type: 'terminal' as const,
      customSessionDefinitionId: definition.id,
      customSessionCommand: definition.command,
      customSessionArgs: parseCustomSessionArgs(definition.args),
    })),
  ]
}

function getReviewRunnerIconProps(option: ReviewRunnerOption): {
  icon?: string
  fallbackSrc?: string
} {
  return option.customIcon
    ? { icon: option.icon }
    : { fallbackSrc: option.fallbackSrc }
}

function getTaskSubmitDelayMs(option: ReviewRunnerOption): number {
  if (option.type && isCodexType(option.type)) return CODEX_TASK_SUBMIT_DELAY_MS
  if (option.customSessionCommand?.trim().toLowerCase().includes('codex')) return CODEX_TASK_SUBMIT_DELAY_MS
  return DEFAULT_AGENT_TASK_SUBMIT_DELAY_MS
}

function normalizeGitPath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\/+/, '')
}

function hashString(value: string): string {
  let hash = 0
  for (let i = 0; i < value.length; i += 1) {
    hash = ((hash << 5) - hash + value.charCodeAt(i)) | 0
  }
  return Math.abs(hash).toString(36)
}

function formatReviewTime(timestamp: number | null): string {
  if (!timestamp) return ''
  return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function getClaudeSessionScopeKey(sessionId: string): string {
  return `session::${sessionId}`
}

function buildReviewPrompt(options: {
  branch?: string | null
  diff: string
  files: GitFileStatus[]
  resultFilePath: string
}): string {
  const fileList = options.files
    .map((file) => `- ${file.staged ? 'staged' : 'unstaged'} ${file.status} ${normalizeGitPath(file.path)}`)
    .join('\n')

  return `你现在在一个 AI Code Review 会话中执行一次代码审查任务。

目标：审查当前 Git diff，优先找出真实的 bug、行为回归、风险和缺失测试。

执行规则：
1. 只基于当前 diff 和必要的相关源码指出具体问题。
2. 按严重程度排序，优先列出会导致错误行为的问题。
3. 每条问题说明文件/位置、原因和建议修复方式。
4. 不要修改仓库文件，不要执行 git commit、git reset、git checkout --、删除未确认文件等破坏性命令。
5. 如果没有发现明确问题，请直接说明“未发现明确问题”，并列出剩余风险或测试缺口。
6. 使用中文输出。
7. 审查完成后，必须把最终审查报告以 UTF-8 Markdown 写入下面的审查结果文件，覆盖原内容；这是唯一允许写入的文件。

当前分支：${options.branch?.trim() || 'unknown'}

审查结果文件：
${options.resultFilePath}

变更文件：
${fileList || '(无)'}

<git-diff>
${options.diff}
</git-diff>`
}

function buildReviewFixPrompt(options: {
  branch?: string | null
  diff: string
  files: GitFileStatus[]
  review: string
}): string {
  const fileList = options.files
    .map((file) => `- ${file.staged ? 'staged' : 'unstaged'} ${file.status} ${normalizeGitPath(file.path)}`)
    .join('\n')

  return `你现在在一个 AI Review Fix 会话中执行一次代码审查修复任务。

目标：根据下面的代码审查报告和当前 Git diff，自动修复真实存在的问题。

执行规则：
1. 必须先阅读相关文件，再修改。用户需要看到修改过程，所以工具调用要清晰。
2. 只修复审查报告指出、且能从当前 diff 或源码中确认的问题；不要做无关重构。
3. 保持改动最小，不要改变未提到的行为。
4. 不要执行 git commit、git reset、git checkout --、删除未确认文件等破坏性命令。
5. 不要暂存文件。
6. 如果审查报告里没有可修复的问题，请说明原因，不要改文件。
7. 修改完成后用中文总结：已修复的问题、修改过的文件、未处理项和建议用户验证的点。

当前分支：${options.branch?.trim() || 'unknown'}

变更文件：
${fileList || '(无)'}

<review-report>
${options.review}
</review-report>

<git-diff>
${options.diff}
</git-diff>`
}

function createMutableDirectory(name: string, path: string): MutableGitTreeDirectory {
  return { name, path, count: 0, directories: new Map(), files: [] }
}

function buildGitTree(files: GitFileStatus[]): GitTreeDirectory {
  const root = createMutableDirectory('', '')

  for (const file of files) {
    const normalizedPath = normalizeGitPath(file.path)
    const parts = normalizedPath.split('/').filter(Boolean)
    if (parts.length === 0) continue

    let current = root
    current.count += 1

    for (const part of parts.slice(0, -1)) {
      const childPath = current.path ? `${current.path}/${part}` : part
      let next = current.directories.get(part)
      if (!next) {
        next = createMutableDirectory(part, childPath)
        current.directories.set(part, next)
      }
      next.count += 1
      current = next
    }

    current.files.push({
      type: 'file',
      name: parts.at(-1) ?? normalizedPath,
      path: normalizedPath,
      file,
    })
  }

  function finalizeDirectory(directory: MutableGitTreeDirectory): GitTreeDirectory {
    const directories = Array.from(directory.directories.values())
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
      .map(finalizeDirectory)
    const childFiles = [...directory.files]
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))

    return {
      type: 'directory',
      name: directory.name,
      path: directory.path,
      count: directory.count,
      children: [...directories, ...childFiles],
    }
  }

  return finalizeDirectory(root)
}

export function GitChanges(): JSX.Element {
  const selectedProject = useProjectsStore((s) => s.projects.find((p) => p.id === s.selectedProjectId))
  const selectedProjectId = useProjectsStore((s) => s.selectedProjectId)
  const selectedWorktree = useWorktreesStore((s) => s.worktrees.find((w) => w.id === s.selectedWorktreeId))
  const branchInfo = useGitStore((s) => selectedProjectId ? s.branchInfo[selectedProjectId] : undefined)
  const gitChangesViewMode = useUIStore((s) => s.settings.gitChangesViewMode)
  const gitReviewMode = useUIStore((s) => s.settings.gitReviewMode)
  const customSessionDefinitions = useUIStore((s) => s.settings.customSessionDefinitions)
  const updateSettings = useUIStore((s) => s.updateSettings)
  const addToast = useUIStore((s) => s.addToast)
  const projectPath = selectedWorktree?.path ?? selectedProject?.path
  const editorWorktreeId = selectedWorktree && !selectedWorktree.isMain ? selectedWorktree.id : undefined

  const [files, setFiles] = useState<GitFileStatus[]>([])
  const [loading, setLoading] = useState(false)
  const [commitMsg, setCommitMsg] = useState('')
  const [committing, setCommitting] = useState(false)
  const [stagedCollapsed, setStagedCollapsed] = useState(false)
  const [changesCollapsed, setChangesCollapsed] = useState(false)
  const [collapsedTreeDirs, setCollapsedTreeDirs] = useState<Set<string>>(() => new Set())
  const [activeTab, setActiveTab] = useState<'review' | 'changes'>('changes')
  const [fixRequestId, setFixRequestId] = useState<string | null>(null)
  const [reviewRunnerMenu, setReviewRunnerMenu] = useState<{ x: number; y: number } | null>(null)
  const reviewRecord = useGitReviewStore((s) => projectPath ? s.reviewsByCwd[projectPath] : undefined)
  const clearReview = useGitReviewStore((s) => s.clearReview)

  const fetchStatus = useCallback(async () => {
    if (!projectPath) return
    setLoading(true)
    try {
      const result: GitFileStatus[] = await window.api.git.status(projectPath)
      setFiles(result)
    } catch { setFiles([]) }
    setLoading(false)
  }, [projectPath])

  // Initial fetch + auto-refresh every 5 seconds
  useEffect(() => {
    fetchStatus()
    const timer = setInterval(fetchStatus, 1500)
    const handleFocus = () => { void fetchStatus() }
    const handleFileSaved = () => { void fetchStatus() }
    window.addEventListener('focus', handleFocus)
    window.addEventListener('fastagents:file-saved', handleFileSaved as EventListener)
    return () => {
      clearInterval(timer)
      window.removeEventListener('focus', handleFocus)
      window.removeEventListener('fastagents:file-saved', handleFileSaved as EventListener)
    }
  }, [fetchStatus])

  const staged = useMemo(() => files.filter((f) => f.staged), [files])
  const unstaged = useMemo(() => files.filter((f) => !f.staged), [files])
  const filesSignature = useMemo(() => files
    .map((file) => `${file.staged ? 'S' : 'W'}:${file.status}:${file.path}`)
    .sort()
    .join('|'), [files])
  const reviewHtml = useMemo(
    () => reviewRecord?.content ? renderMarkdown(reviewRecord.content) : '',
    [reviewRecord?.content],
  )
  const reviewRunnerOptions = useMemo(
    () => buildReviewRunnerOptions(customSessionDefinitions),
    [customSessionDefinitions],
  )
  const selectedReviewRunner = useMemo<ReviewRunnerOption>(
    () => reviewRunnerOptions.find((option) => option.id === gitReviewMode)
      ?? reviewRunnerOptions.find((option) => option.id === 'claude-gui')
      ?? reviewRunnerOptions[0]!,
    [gitReviewMode, reviewRunnerOptions],
  )
  const selectedReviewRunnerIcon = getReviewRunnerIconProps(selectedReviewRunner)

  useEffect(() => {
    if (!reviewRunnerMenu) return
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setReviewRunnerMenu(null)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [reviewRunnerMenu])

  const toggleTreeDirectory = useCallback((key: string) => {
    setCollapsedTreeDirs((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])

  const handleOpenFile = useCallback((filePath: string) => {
    if (!projectPath) return
    const fullPath = `${projectPath}/${filePath}`
    const tabId = useEditorsStore.getState().openFile(fullPath, {
      projectId: selectedProjectId,
      worktreeId: editorWorktreeId,
    })
    const ps = usePanesStore.getState()
    ps.addSessionToPane(ps.activePaneId, tabId)
    ps.setPaneActiveSession(ps.activePaneId, tabId)
  }, [projectPath, selectedProjectId, editorWorktreeId])

  const handleOpenDiff = useCallback(async (filePath: string) => {
    if (!projectPath) return
    try {
      const original = await window.api.git.showHead(projectPath, filePath)
      const fullPath = `${projectPath}/${filePath}`
      const tabId = useEditorsStore.getState().openDiff(fullPath, original, {
        projectId: selectedProjectId, worktreeId: editorWorktreeId,
      })
      const ps = usePanesStore.getState()
      ps.addSessionToPane(ps.activePaneId, tabId)
      ps.setPaneActiveSession(ps.activePaneId, tabId)
    } catch {
      handleOpenFile(filePath)
    }
  }, [projectPath, selectedProjectId, editorWorktreeId, handleOpenFile])

  const handleStage = useCallback(async (filePath: string) => {
    if (!projectPath) return
    await window.api.git.stage(projectPath, filePath)
    fetchStatus()
  }, [projectPath, fetchStatus])

  const handleUnstage = useCallback(async (filePath: string) => {
    if (!projectPath) return
    await window.api.git.unstage(projectPath, filePath)
    fetchStatus()
  }, [projectPath, fetchStatus])

  const handleDiscard = useCallback(async (filePath: string) => {
    if (!projectPath) return
    await window.api.git.discard(projectPath, filePath)
    fetchStatus()
  }, [projectPath, fetchStatus])

  const handleStageAll = useCallback(async () => {
    if (!projectPath) return
    await window.api.git.stage(projectPath, '.')
    fetchStatus()
  }, [projectPath, fetchStatus])

  const handleUnstageAll = useCallback(async () => {
    if (!projectPath) return
    for (const f of staged) await window.api.git.unstage(projectPath, f.path)
    fetchStatus()
  }, [projectPath, staged, fetchStatus])

  const handleCommit = useCallback(async () => {
    if (!projectPath || !commitMsg.trim()) return
    setCommitting(true)
    try {
      await window.api.git.commit(projectPath, commitMsg.trim())
      setCommitMsg('')
      fetchStatus()
      if (selectedProjectId) useGitStore.getState().fetchStatus(selectedProjectId, projectPath)
    } catch { /* ignore */ }
    setCommitting(false)
  }, [projectPath, commitMsg, fetchStatus, selectedProjectId])

  const openReviewRunnerMenu = useCallback((event: ReactMouseEvent<HTMLButtonElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    setReviewRunnerMenu({
      x: Math.max(8, Math.min(rect.left, window.innerWidth - REVIEW_RUNNER_MENU_WIDTH - 8)),
      y: Math.min(rect.bottom + 4, window.innerHeight - 280),
    })
  }, [])

  const selectReviewRunner = useCallback((runnerId: string) => {
    updateSettings({ gitReviewMode: runnerId as GitReviewMode })
    setReviewRunnerMenu(null)
  }, [updateSettings])

  const handleReviewDiff = useCallback(async () => {
    if (!projectPath || files.length === 0) return

    const reviewStore = useGitReviewStore.getState()
    try {
      const diff = await window.api.git.reviewDiff(projectPath)
      const normalizedDiff = diff.trim()
      if (!normalizedDiff) {
        reviewStore.failReview(projectPath, '当前没有可审查的 Git diff。')
        return
      }

      reviewStore.startReview(projectPath, hashString(normalizedDiff), filesSignature)
      const reviewRunner = selectedReviewRunner
      if (reviewRunner.kind !== 'claude-gui') {
        if (!selectedProjectId) throw new Error('未选择项目，无法创建 AI Review 会话。')

        const sessionsStore = useSessionsStore.getState()
        const panesStore = usePanesStore.getState()
        const sessionType = reviewRunner.type ?? 'terminal'
        const sessionId = sessionsStore.addSession(
          selectedProjectId,
          sessionType,
          editorWorktreeId,
          'AI Review',
          reviewRunner.kind === 'custom'
            ? {
                customSessionDefinitionId: reviewRunner.customSessionDefinitionId,
                customSessionLabel: reviewRunner.label,
                customSessionIcon: reviewRunner.icon,
                customSessionCommand: reviewRunner.customSessionCommand,
                customSessionArgs: reviewRunner.customSessionArgs,
              }
            : undefined,
        )

        sessionsStore.updateSession(sessionId, { name: 'AI Review', label: '审查' })
        sessionsStore.setActive(sessionId)
        panesStore.addSessionToPane(panesStore.activePaneId, sessionId)
        panesStore.setActivePaneId(panesStore.activePaneId)
        panesStore.setPaneActiveSession(panesStore.activePaneId, sessionId)

        addToast({
          title: '已创建审查标签页',
          body: `${reviewRunner.label} 会收到当前 Git diff 的审查任务。`,
          type: 'info',
          sessionId,
          projectId: selectedProjectId,
          duration: 5000,
        })

        const resultFilePath = await window.api.fs.writeTempFile(
          'fastagents-ai-review-result',
          REVIEW_RESULT_PENDING_MARKER,
          'md',
        )
        const reviewPrompt = buildReviewPrompt({
          branch: branchInfo?.current ?? null,
          diff: normalizedDiff,
          files,
          resultFilePath,
        })
        const taskFilePath = await window.api.fs.writeTempFile(
          'fastagents-ai-review',
          reviewPrompt,
          'md',
        )
        const cliPrompt = [
          '请先完整读取并严格执行这个代码审查任务文件：',
          taskFilePath,
          '',
          '要求：',
          '1. 不要依赖当前终端里可能被截断的内容，必须先读取这个文件。',
          `2. 审查完成后，必须把最终审查报告写入这个结果文件：${resultFilePath}`,
          '3. 只审查当前 Git diff，不要修改仓库文件。',
          '4. 不要修改这个临时任务文件本身。',
          '5. 用中文输出审查结论；如果没有明确问题，请直接说明未发现明确问题。',
        ].join('\n')
        const ptyId = await waitForSessionPty(sessionId)
        const submitDelayMs = getTaskSubmitDelayMs(reviewRunner)
        if (submitDelayMs >= CODEX_TASK_SUBMIT_DELAY_MS) {
          addToast({
            title: '等待 Codex 启动',
            body: 'Codex 需要完成 MCP 启动，10 秒后会自动提交审查任务。',
            type: 'info',
            sessionId,
            projectId: selectedProjectId,
            duration: 6000,
          })
        }
        await delay(submitDelayMs)
        const submitted = await window.api.session.submit(ptyId, cliPrompt, true)
        if (!submitted) throw new Error('AI 审查任务发送失败，请检查审查会话是否仍在运行。')

        addToast({
          title: '已发送审查任务',
          body: `等待 ${reviewRunner.label} 写入审查结果。`,
          type: 'info',
          sessionId,
          projectId: selectedProjectId,
          duration: 5000,
        })

        const reviewContent = await waitForReviewResult(resultFilePath, ptyId)
        reviewStore.completeReview(projectPath, reviewContent)
        addToast({
          title: 'AI 审查完成',
          body: '审查报告已写回 Git 面板，修复按钮会使用这份报告。',
          type: 'success',
          sessionId,
          projectId: selectedProjectId,
          duration: 7000,
        })
        return
      }

      const result = await window.api.claudeGui.reviewDiff({
        cwd: projectPath,
        diff: normalizedDiff,
        files,
        branch: branchInfo?.current ?? null,
      })
      reviewStore.completeReview(projectPath, result.content)
    } catch (err) {
      reviewStore.failReview(projectPath, err instanceof Error ? err.message : String(err))
    }
  }, [addToast, branchInfo?.current, editorWorktreeId, files, filesSignature, projectPath, selectedProjectId, selectedReviewRunner])

  const handleFixReview = useCallback(async () => {
    if (!projectPath || !selectedProjectId || !reviewRecord?.content || files.length === 0 || fixRequestId) return

    const requestId = `claude-req-${generateId()}`
    let conversationId: string | null = null
    let unsubscribe: (() => void) | null = null

    try {
      const diff = (await window.api.git.reviewDiff(projectPath)).trim()
      if (!diff) {
        addToast({
          title: '没有可修复的 diff',
          body: '当前工作区没有可用于自动修复的 Git diff。',
          type: 'warning',
          duration: 5000,
        })
        return
      }

      const effectiveText = buildReviewFixPrompt({
        branch: branchInfo?.current ?? null,
        diff,
        files,
        review: reviewRecord.content,
      })

      const reviewRunner = selectedReviewRunner
      if (reviewRunner.kind !== 'claude-gui') {
        setFixRequestId(requestId)
        const sessionsStore = useSessionsStore.getState()
        const panesStore = usePanesStore.getState()
        const sessionType = reviewRunner.type ?? 'terminal'
        const sessionId = sessionsStore.addSession(
          selectedProjectId,
          sessionType,
          editorWorktreeId,
          'AI Review Fix',
          reviewRunner.kind === 'custom'
            ? {
                customSessionDefinitionId: reviewRunner.customSessionDefinitionId,
                customSessionLabel: reviewRunner.label,
                customSessionIcon: reviewRunner.icon,
                customSessionCommand: reviewRunner.customSessionCommand,
                customSessionArgs: reviewRunner.customSessionArgs,
              }
            : undefined,
        )

        try {
          sessionsStore.updateSession(sessionId, { name: 'AI Review Fix', label: '修复' })
          sessionsStore.setActive(sessionId)
          panesStore.addSessionToPane(panesStore.activePaneId, sessionId)
          panesStore.setActivePaneId(panesStore.activePaneId)
          panesStore.setPaneActiveSession(panesStore.activePaneId, sessionId)

          addToast({
            title: '已创建修复标签页',
            body: `${reviewRunner.label} 会收到当前审查报告和 Git diff。`,
            type: 'info',
            sessionId,
            projectId: selectedProjectId,
            duration: 5000,
          })

          const taskFilePath = await window.api.fs.writeTempFile(
            'fastagents-ai-review-fix',
            effectiveText,
            'md',
          )
          const cliPrompt = [
            '请先完整读取并严格执行这个代码审查修复任务文件：',
            taskFilePath,
            '',
            '要求：',
            '1. 不要依赖当前终端里可能被截断的内容，必须先读取这个文件。',
            '2. 根据文件中的审查报告和 git diff 修复当前仓库。',
            '3. 不要修改这个临时任务文件本身。',
            '4. 完成后用中文总结已修复的问题、修改的文件、未处理项和建议验证点。',
          ].join('\n')
          const ptyId = await waitForSessionPty(sessionId)
          const submitDelayMs = getTaskSubmitDelayMs(reviewRunner)
          if (submitDelayMs >= CODEX_TASK_SUBMIT_DELAY_MS) {
            addToast({
              title: '等待 Codex 启动',
              body: 'Codex 需要完成 MCP 启动，10 秒后会自动提交修复任务。',
              type: 'info',
              sessionId,
              projectId: selectedProjectId,
              duration: 6000,
            })
          }
          await delay(submitDelayMs)
          const submitted = await window.api.session.submit(ptyId, cliPrompt, true)
          if (!submitted) throw new Error('AI 修复任务发送失败，请检查修复会话是否仍在运行。')

          const offExit = window.api.session.onExit((event) => {
            if (event.ptyId !== ptyId) return
            offExit()
            void fetchStatus()
            void useGitStore.getState().fetchStatus(selectedProjectId, projectPath)
            addToast({
              title: event.exitCode === 0 ? 'AI 修复完成' : 'AI 修复未正常完成',
              body: event.exitCode === 0
                ? `${reviewRunner.label} 修复会话已结束，请检查 Git 更改。`
                : `${reviewRunner.label} 修复会话退出码 ${event.exitCode}，请查看修复标签页。`,
              type: event.exitCode === 0 ? 'success' : 'error',
              sessionId,
              projectId: selectedProjectId,
              duration: 8000,
            })
          })

          addToast({
            title: '已发送审查报告',
            body: `AI Review Fix 标签页已收到任务，请在 ${reviewRunner.label} 会话里查看修改过程。`,
            type: 'success',
            sessionId,
            projectId: selectedProjectId,
            duration: 7000,
          })
        } finally {
          setFixRequestId((current) => (current === requestId ? null : current))
        }

        return
      }

      const preferences: ClaudeGuiPreferences = {
        selectedModel: CLAUDE_REVIEW_FIX_MODEL,
        computeMode: 'max',
        permissionMode: 'default',
        planMode: false,
        thinkingMode: true,
        messageTextSize: 'lg',
        includeEditorContext: true,
        languageMode: true,
        language: 'zh',
        onlyCommunicate: false,
      }
      const worktreeId = editorWorktreeId ?? null
      const sessionsStore = useSessionsStore.getState()
      const panesStore = usePanesStore.getState()
      const claudeStore = useClaudeGuiStore.getState()
      const sessionId = sessionsStore.addSession(selectedProjectId, 'claude-gui', editorWorktreeId)
      const scopeKey = getClaudeSessionScopeKey(sessionId)
      conversationId = claudeStore.createConversation({
        projectId: selectedProjectId,
        worktreeId,
        cwd: projectPath,
        scopeKey,
        title: 'AI Review Fix',
      })
      const displayText = '修复当前代码审查报告中的问题'

      sessionsStore.updateSession(sessionId, { name: 'AI Review Fix', label: '修复' })
      sessionsStore.setActive(sessionId)
      panesStore.addSessionToPane(panesStore.activePaneId, sessionId)
      panesStore.setActivePaneId(panesStore.activePaneId)
      panesStore.setPaneActiveSession(panesStore.activePaneId, sessionId)
      claudeStore.selectConversation(scopeKey, conversationId)
      claudeStore.updateConversationPreferences(conversationId, preferences)
      claudeStore.beginRequest(conversationId, {
        requestId,
        text: displayText,
        attachments: [],
        meta: { source: 'git-review-fix' },
      })
      claudeStore.registerRequestPayload({
        requestId,
        conversationId,
        cwd: projectPath,
        displayText,
        effectiveText,
        attachments: [],
        images: [],
        preferences,
        createdAt: Date.now(),
      })

      let lastError: string | null = null
      unsubscribe = window.api.claudeGui.onEvent((event) => {
        if (event.requestId !== requestId) return
        if (event.type === 'error') {
          lastError = event.error
          return
        }
        if (event.type !== 'closed') return

        unsubscribe?.()
        setFixRequestId((current) => (current === requestId ? null : current))
        void fetchStatus()
        void useGitStore.getState().fetchStatus(selectedProjectId, projectPath)
        addToast({
          title: event.exitCode === 0 ? 'AI 修复完成' : 'AI 修复未正常完成',
          body: event.exitCode === 0
            ? '修复过程已在 Claude GUI 标签页完成，请检查 Git 更改。'
            : lastError ?? `Claude 进程退出码 ${event.exitCode}，请查看修复标签页。`,
          type: event.exitCode === 0 ? 'success' : 'error',
          sessionId,
          projectId: selectedProjectId,
          duration: 8000,
        })
      })

      setFixRequestId(requestId)
      addToast({
        title: '已创建修复标签页',
        body: 'Claude GUI 会实时显示 Opus 的工具调用和修改过程。',
        type: 'info',
        sessionId,
        projectId: selectedProjectId,
        duration: 5000,
      })

      await window.api.claudeGui.start({
        requestId,
        conversationId,
        cwd: projectPath,
        text: effectiveText,
        sessionId: null,
        model: CLAUDE_REVIEW_FIX_MODEL,
        computeMode: preferences.computeMode,
        planMode: preferences.planMode,
        thinkingMode: preferences.thinkingMode,
        languageMode: preferences.languageMode,
        language: preferences.language,
        onlyCommunicate: preferences.onlyCommunicate,
        images: [],
      })
    } catch (err) {
      unsubscribe?.()
      setFixRequestId((current) => (current === requestId ? null : current))
      const message = err instanceof Error ? err.message : String(err)
      if (conversationId) {
        const claudeStore = useClaudeGuiStore.getState()
        claudeStore.applyEvent({ requestId, conversationId, type: 'error', error: message })
        claudeStore.applyEvent({ requestId, conversationId, type: 'processing', active: false })
      }
      addToast({
        title: '启动 AI 修复失败',
        body: message,
        type: 'error',
        duration: 8000,
      })
    }
  }, [
    addToast,
    branchInfo?.current,
    editorWorktreeId,
    fetchStatus,
    files,
    fixRequestId,
    projectPath,
    reviewRecord?.content,
    selectedProjectId,
    selectedReviewRunner,
  ])

  const branch = branchInfo?.current
  const isDirty = branchInfo?.isDirty ?? false
  const reviewRunning = reviewRecord?.status === 'running'
  const reviewIsStale = Boolean(reviewRecord?.filesSignature && reviewRecord.filesSignature !== filesSignature)
  const fixingReview = Boolean(fixRequestId)
  const canFixReview = Boolean(reviewRecord?.status === 'done' && reviewRecord.content && files.length > 0)
  const changeCount = staged.length + unstaged.length

  if (!projectPath) {
    return (
      <div className="flex h-full items-center justify-center p-4">
        <span className="text-[var(--ui-font-xs)] text-[var(--color-text-tertiary)]">未选择项目</span>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* Branch + refresh */}
      <div className="shrink-0 px-3 py-2 border-b border-[var(--color-border)]">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <GitBranch size={13} className="text-[var(--color-text-tertiary)]" />
            <span className="text-[var(--ui-font-xs)] font-medium text-[var(--color-text-primary)]">{branch ?? 'no branch'}</span>
            {isDirty && <Circle size={6} fill="var(--color-warning)" className="text-[var(--color-warning)]" />}
          </div>
          <div className="flex items-center gap-1.5">
            <button
              onClick={fetchStatus}
              className={cn(HEADER_ICON_BUTTON, loading && 'animate-spin')}
              title="刷新"
            >
              <RefreshCw size={14} />
            </button>
          </div>
        </div>
      </div>

      <div className="flex shrink-0 gap-1 border-b border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-2 py-1.5">
        <button
          type="button"
          onClick={() => setActiveTab('review')}
          className={cn(
            GIT_TAB_BUTTON,
            activeTab === 'review'
              ? 'bg-[var(--color-accent-muted)] text-[var(--color-accent)]'
              : 'text-[var(--color-text-tertiary)] hover:bg-[var(--color-bg-tertiary)] hover:text-[var(--color-text-secondary)]',
          )}
        >
          <SessionIconView
            {...selectedReviewRunnerIcon}
            className="h-[13px] w-[13px]"
            imageClassName="h-[13px] w-[13px] object-contain"
          />
          审查
          {reviewRunning && <Loader2 size={12} className="animate-spin" />}
          {reviewIsStale && <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-warning)]" title="diff 已变化" />}
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('changes')}
          className={cn(
            GIT_TAB_BUTTON,
            activeTab === 'changes'
              ? 'bg-[var(--color-accent-muted)] text-[var(--color-accent)]'
              : 'text-[var(--color-text-tertiary)] hover:bg-[var(--color-bg-tertiary)] hover:text-[var(--color-text-secondary)]',
          )}
        >
          Git 更改
          <span className="rounded-full bg-[var(--color-bg-surface)] px-1.5 py-0.5 text-[9px] text-[var(--color-text-tertiary)]">{changeCount}</span>
        </button>
      </div>

      {activeTab === 'review' && (
        <div className="min-h-0 flex-1 overflow-y-auto bg-[var(--color-bg-secondary)] p-3">
          <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 text-[var(--ui-font-xs)] font-semibold text-[var(--color-text-primary)]">
                {reviewRunning ? (
                  <Loader2 size={13} className="shrink-0 animate-spin text-[var(--color-accent)]" />
                ) : (
                  <SessionIconView
                    {...selectedReviewRunnerIcon}
                    className="h-[13px] w-[13px]"
                    imageClassName="h-[13px] w-[13px] object-contain"
                  />
                )}
                AI Code Review
                {reviewRecord?.reviewedAt && (
                  <span className="text-[9px] font-normal text-[var(--color-text-tertiary)]">
                    {formatReviewTime(reviewRecord.reviewedAt)}
                  </span>
                )}
              </div>
              {reviewIsStale && (
                <div className="mt-1 text-[10px] text-[var(--color-warning)]">当前 diff 已变化，建议重新审查。</div>
              )}
            </div>
            <div className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-1.5">
              <button
                type="button"
                onClick={openReviewRunnerMenu}
                className={cn(REVIEW_RUNNER_BUTTON, 'max-w-[138px]')}
                title={`审查 AI：${selectedReviewRunner.label}`}
              >
                <SessionIconView
                  {...selectedReviewRunnerIcon}
                  className="h-[13px] w-[13px]"
                  imageClassName="h-[13px] w-[13px] object-contain"
                />
                <span className="min-w-0 truncate">{selectedReviewRunner.label}</span>
                <ChevronDown size={12} className="shrink-0 text-[var(--color-text-tertiary)]" />
              </button>
              {canFixReview && (
                <button
                  type="button"
                  onClick={handleFixReview}
                  disabled={fixingReview}
                  className={GIT_FLOW_BUTTON}
                  title={`使用 ${selectedReviewRunner.label} 自动修复审查结果`}
                >
                  {fixingReview
                    ? <Loader2 size={13} className="animate-spin" />
                    : <Wrench size={13} />}
                  修复
                </button>
              )}
              {reviewRecord && (
                <button
                  type="button"
                  onClick={() => clearReview(projectPath)}
                  className={cn(GIT_FLOW_BUTTON, 'hover:border-[var(--color-error)] hover:text-[var(--color-error)]')}
                  title="清除审查结果"
                >
                  <Trash2 size={13} />
                  清除
                </button>
              )}
              <button
                type="button"
                onClick={handleReviewDiff}
                disabled={reviewRunning || files.length === 0}
                className={GIT_FLOW_BUTTON}
                title={selectedReviewRunner.kind === 'claude-gui'
                  ? 'AI 审查当前 Git diff'
                  : `使用 ${selectedReviewRunner.label} 审查当前 Git diff`}
              >
                {reviewRunning
                  ? <Loader2 size={13} className="animate-spin" />
                  : (
                    <SessionIconView
                      {...selectedReviewRunnerIcon}
                      className="h-[13px] w-[13px]"
                      imageClassName="h-[13px] w-[13px] object-contain"
                    />
                  )}
                AI Review
              </button>
            </div>
          </div>

          {!reviewRecord && (
            <div className="rounded-[var(--radius-lg)] border border-dashed border-[var(--color-border)] bg-[var(--color-bg-primary)] px-3 py-8 text-center">
              <div className="text-[var(--ui-font-sm)] font-semibold text-[var(--color-text-secondary)]">还没有审查结果</div>
              <div className="mt-1 text-[var(--ui-font-xs)] text-[var(--color-text-tertiary)]">
                点击 AI Review 审查当前 Git diff。
              </div>
            </div>
          )}

          {reviewRecord?.status === 'running' && (
            <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg-primary)] px-2.5 py-2 text-[var(--ui-font-xs)] text-[var(--color-text-secondary)]">
              正在审查当前 diff...
            </div>
          )}

          {reviewRecord?.status === 'error' && reviewRecord.error && (
            <div className="rounded-[var(--radius-md)] border border-[var(--color-error)]/40 bg-[var(--color-error)]/10 px-2.5 py-2 text-[var(--ui-font-xs)] text-[var(--color-error)]">
              {reviewRecord.error}
            </div>
          )}

          {reviewHtml && (
            <div className="overflow-auto rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg-primary)]">
              <div
                className="ai-summary-content px-3 py-2 text-[var(--ui-font-xs)] leading-relaxed text-[var(--color-text-secondary)]"
                dangerouslySetInnerHTML={{ __html: reviewHtml }}
              />
            </div>
          )}
        </div>
      )}

      {/* Commit input — always visible when there are staged files */}
      {activeTab === 'changes' && staged.length > 0 && (
        <div className="shrink-0 px-3 py-2 border-b border-[var(--color-border)]">
          <input
            value={commitMsg}
            onChange={(e) => setCommitMsg(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && commitMsg.trim()) handleCommit() }}
            placeholder={`消息 (Ctrl+Enter 在"${branch}"提交)`}
            className="w-full rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-bg-primary)] px-2 py-1.5 text-[var(--ui-font-xs)] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-tertiary)] outline-none mb-1.5"
          />
          <button
            onClick={handleCommit}
            disabled={!commitMsg.trim() || committing}
            className="flex w-full items-center justify-center gap-1.5 rounded-[var(--radius-sm)] bg-[var(--color-accent)] px-3 py-1.5 text-[var(--ui-font-xs)] text-white hover:opacity-90 disabled:opacity-40"
          >
            <Check size={12} /> {committing ? '提交中...' : '提交'}
          </button>
        </div>
      )}

      {/* File lists */}
      {activeTab === 'changes' && (
      <div className="flex-1 overflow-y-auto">
        {files.length === 0 && (
          <div className="text-center py-8 text-[var(--ui-font-xs)] text-[var(--color-text-tertiary)]">
            {loading ? '加载中...' : '工作区干净'}
          </div>
        )}

        {/* Staged changes */}
        {staged.length > 0 && (
          <div>
            <button
              onClick={() => setStagedCollapsed(!stagedCollapsed)}
              className="flex w-full items-center justify-between px-3 py-1.5 hover:bg-[var(--color-bg-tertiary)] transition-colors"
            >
              <div className="flex items-center gap-1">
                {stagedCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                <span className="text-[11px] font-semibold text-[var(--color-text-secondary)]">暂存的更改</span>
                <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--color-success)]/15 px-1 text-[9px] font-medium text-[var(--color-success)]">{staged.length}</span>
              </div>
              <div className="flex gap-0.5" onClick={(e) => e.stopPropagation()}>
                <button onClick={handleUnstageAll} className={cn(HEADER_ICON_BUTTON, 'hover:text-[var(--color-warning)]')} title="全部取消暂存">
                  <Minus size={14} />
                </button>
              </div>
            </button>
            {!stagedCollapsed && (
              gitChangesViewMode === 'tree'
                ? (
                    <GitFileTree
                      files={staged}
                      sectionId="staged"
                      collapsedDirs={collapsedTreeDirs}
                      onToggleDir={toggleTreeDirectory}
                      renderFile={(f, depth) => (
                        <FileRow
                          key={`s-${f.path}`}
                          file={f}
                          depth={depth}
                          showDirectory={false}
                          onClick={() => handleOpenDiff(f.path)}
                          actions={
                            <>
                              <button onClick={(e) => { e.stopPropagation(); handleOpenFile(f.path) }} className={cn(ROW_ICON_BUTTON, 'hover:text-[var(--color-text-secondary)]')} title="打开文件">
                                <ExternalLink size={13} />
                              </button>
                              <button onClick={(e) => { e.stopPropagation(); handleUnstage(f.path) }} className={cn(ROW_ICON_BUTTON, 'hover:text-[var(--color-warning)]')} title="取消暂存">
                                <Minus size={13} />
                              </button>
                            </>
                          }
                        />
                      )}
                    />
                  )
                : staged.map((f) => (
                    <FileRow
                      key={`s-${f.path}`}
                      file={f}
                      onClick={() => handleOpenDiff(f.path)}
                      actions={
                        <>
                          <button onClick={(e) => { e.stopPropagation(); handleOpenFile(f.path) }} className={cn(ROW_ICON_BUTTON, 'hover:text-[var(--color-text-secondary)]')} title="打开文件">
                            <ExternalLink size={13} />
                          </button>
                          <button onClick={(e) => { e.stopPropagation(); handleUnstage(f.path) }} className={cn(ROW_ICON_BUTTON, 'hover:text-[var(--color-warning)]')} title="取消暂存">
                            <Minus size={13} />
                          </button>
                        </>
                      }
                    />
                  ))
            )}
          </div>
        )}

        {/* Unstaged changes */}
        {unstaged.length > 0 && (
          <div>
            <button
              onClick={() => setChangesCollapsed(!changesCollapsed)}
              className="flex w-full items-center justify-between px-3 py-1.5 hover:bg-[var(--color-bg-tertiary)] transition-colors"
            >
              <div className="flex items-center gap-1">
                {changesCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                <span className="text-[11px] font-semibold text-[var(--color-text-secondary)]">更改</span>
                <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--color-bg-surface)] px-1 text-[9px] font-medium text-[var(--color-text-tertiary)]">{unstaged.length}</span>
              </div>
              <div className="flex gap-0.5" onClick={(e) => e.stopPropagation()}>
                <button onClick={() => { for (const f of unstaged) if (f.status !== '?') handleDiscard(f.path) }}
                  className={cn(HEADER_ICON_BUTTON, 'hover:text-[var(--color-error)]')} title="放弃所有更改">
                  <Undo2 size={14} />
                </button>
                <button onClick={handleStageAll} className={cn(HEADER_ICON_BUTTON, 'hover:text-[var(--color-success)]')} title="暂存所有更改">
                  <Plus size={14} />
                </button>
              </div>
            </button>
            {!changesCollapsed && (
              gitChangesViewMode === 'tree'
                ? (
                    <GitFileTree
                      files={unstaged}
                      sectionId="unstaged"
                      collapsedDirs={collapsedTreeDirs}
                      onToggleDir={toggleTreeDirectory}
                      renderFile={(f, depth) => (
                        <FileRow
                          key={`u-${f.path}`}
                          file={f}
                          depth={depth}
                          showDirectory={false}
                          onClick={() => handleOpenDiff(f.path)}
                          actions={
                            <>
                              <button onClick={(e) => { e.stopPropagation(); handleOpenFile(f.path) }} className={cn(ROW_ICON_BUTTON, 'hover:text-[var(--color-text-secondary)]')} title="打开文件">
                                <ExternalLink size={13} />
                              </button>
                              {f.status !== '?' && (
                                <button onClick={(e) => { e.stopPropagation(); handleDiscard(f.path) }} className={cn(ROW_ICON_BUTTON, 'hover:text-[var(--color-error)]')} title="放弃更改">
                                  <Undo2 size={13} />
                                </button>
                              )}
                              <button onClick={(e) => { e.stopPropagation(); handleStage(f.path) }} className={cn(ROW_ICON_BUTTON, 'hover:text-[var(--color-success)]')} title="暂存更改">
                                <Plus size={13} />
                              </button>
                            </>
                          }
                        />
                      )}
                    />
                  )
                : unstaged.map((f) => (
                    <FileRow
                      key={`u-${f.path}`}
                      file={f}
                      onClick={() => handleOpenDiff(f.path)}
                      actions={
                        <>
                          <button onClick={(e) => { e.stopPropagation(); handleOpenFile(f.path) }} className={cn(ROW_ICON_BUTTON, 'hover:text-[var(--color-text-secondary)]')} title="打开文件">
                            <ExternalLink size={13} />
                          </button>
                          {f.status !== '?' && (
                            <button onClick={(e) => { e.stopPropagation(); handleDiscard(f.path) }} className={cn(ROW_ICON_BUTTON, 'hover:text-[var(--color-error)]')} title="放弃更改">
                              <Undo2 size={13} />
                            </button>
                          )}
                          <button onClick={(e) => { e.stopPropagation(); handleStage(f.path) }} className={cn(ROW_ICON_BUTTON, 'hover:text-[var(--color-success)]')} title="暂存更改">
                            <Plus size={13} />
                          </button>
                        </>
                      }
                    />
                  ))
            )}
          </div>
        )}
      </div>
      )}
      {reviewRunnerMenu && createPortal(
        <>
          <div
            className="fixed inset-0"
            style={{ zIndex: 9998 }}
            onClick={() => setReviewRunnerMenu(null)}
            onContextMenu={(event) => {
              event.preventDefault()
              setReviewRunnerMenu(null)
            }}
          />
          <div
            className="fixed max-h-[320px] overflow-y-auto rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg-tertiary)] p-1 shadow-lg shadow-black/30"
            style={{
              top: Math.max(8, Math.min(reviewRunnerMenu.y, window.innerHeight - 328)),
              left: Math.max(8, Math.min(reviewRunnerMenu.x, window.innerWidth - REVIEW_RUNNER_MENU_WIDTH - 8)),
              width: REVIEW_RUNNER_MENU_WIDTH,
              zIndex: 9999,
            }}
          >
            {reviewRunnerOptions.map((option) => {
              const selected = option.id === selectedReviewRunner.id
              return (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => selectReviewRunner(option.id)}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-[var(--radius-sm)] px-2 py-1.5 text-left transition-colors',
                    selected
                      ? 'bg-[var(--color-accent-muted)] text-[var(--color-accent)]'
                      : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-surface)] hover:text-[var(--color-text-primary)]',
                  )}
                >
                  <SessionIconView
                    {...getReviewRunnerIconProps(option)}
                    className="h-4 w-4"
                    imageClassName="h-4 w-4 object-contain"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[var(--ui-font-xs)] font-semibold">{option.label}</span>
                    <span className="block truncate text-[10px] text-[var(--color-text-tertiary)]">{option.description}</span>
                  </span>
                  {selected && <Check size={13} className="shrink-0" />}
                </button>
              )
            })}
          </div>
        </>,
        document.body,
      )}
    </div>
  )
}

function GitFileTree({
  files,
  sectionId,
  collapsedDirs,
  onToggleDir,
  renderFile,
}: {
  files: GitFileStatus[]
  sectionId: string
  collapsedDirs: Set<string>
  onToggleDir: (key: string) => void
  renderFile: (file: GitFileStatus, depth: number) => React.ReactNode
}): JSX.Element {
  const tree = useMemo(() => buildGitTree(files), [files])

  function renderNode(node: GitTreeNode, depth: number): React.ReactNode {
    if (node.type === 'file') return renderFile(node.file, depth)

    const key = `${sectionId}:${node.path}`
    const collapsed = collapsedDirs.has(key)

    return (
      <div key={key}>
        <button
          type="button"
          onClick={() => onToggleDir(key)}
          className="group flex w-full items-center gap-1.5 py-[3px] pr-3 text-[var(--ui-font-xs)] text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-bg-tertiary)]"
          style={{ paddingLeft: `${18 + depth * 14}px` }}
          title={node.path}
        >
          {collapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
          {collapsed ? (
            <Folder size={13} className="shrink-0 text-[var(--color-text-tertiary)]" />
          ) : (
            <FolderOpen size={13} className="shrink-0 text-[var(--color-text-tertiary)]" />
          )}
          <span className="flex-1 truncate text-left">{node.name}</span>
          <span className="rounded-full bg-[var(--color-bg-surface)] px-1.5 py-0.5 text-[9px] text-[var(--color-text-tertiary)]">{node.count}</span>
        </button>
        {!collapsed && node.children.map((child) => renderNode(child, depth + 1))}
      </div>
    )
  }

  return (
    <>
      {tree.children.map((node) => renderNode(node, 0))}
    </>
  )
}

function FileTypeIcon({ name }: { name: string }): JSX.Element {
  const iconInfo = FILE_ICONS[detectLanguage(name)]

  if (!iconInfo) {
    return <File size={13} className="shrink-0 text-[var(--color-text-tertiary)]" />
  }

  return (
    <span
      className="inline-flex h-4 min-w-4 shrink-0 items-center justify-center rounded px-1 text-[9px] font-semibold leading-none"
      style={{
        color: iconInfo.color,
        backgroundColor: `${iconInfo.color}18`,
        border: `1px solid ${iconInfo.color}33`,
      }}
    >
      {iconInfo.icon}
    </span>
  )
}

function FileRow({
  file,
  onClick,
  actions,
  depth,
  showDirectory = true,
}: {
  file: GitFileStatus
  onClick: () => void
  actions?: React.ReactNode
  depth?: number
  showDirectory?: boolean
}): JSX.Element {
  const color = STATUS_COLORS[file.status] ?? 'text-[var(--color-text-tertiary)]'
  const label = STATUS_LABELS[file.status] ?? file.status
  const normalizedPath = normalizeGitPath(file.path)
  const fileName = normalizedPath.split('/').pop() ?? normalizedPath
  const dirName = normalizedPath.includes('/') ? normalizedPath.slice(0, normalizedPath.lastIndexOf('/')) : ''

  return (
    <div
      onClick={onClick}
      className="group flex w-full cursor-pointer items-center gap-1.5 py-[3px] pr-3 text-[var(--ui-font-xs)] transition-colors hover:bg-[var(--color-bg-tertiary)]"
      style={{ paddingLeft: `${depth === undefined ? 28 : 22 + depth * 14}px` }}
    >
      <FileTypeIcon name={fileName} />
      <span className="flex-1 truncate text-[var(--color-text-secondary)] text-left">
        {fileName}
        {showDirectory && dirName && <span className="ml-1.5 text-[var(--color-text-tertiary)] text-[10px]">{dirName}</span>}
      </span>
      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
        {actions}
      </div>
      <span className={cn('shrink-0 w-4 text-center text-[10px] font-mono font-bold', color)}>{label}</span>
    </div>
  )
}
