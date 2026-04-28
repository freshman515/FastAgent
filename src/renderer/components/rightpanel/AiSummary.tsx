import { Bot, Check, Copy, FileCode, FileDown, Send, Settings, Sparkles, Trash2, User } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import { useUIStore } from '@/stores/ui'
import { useProjectsStore } from '@/stores/projects'
import { useSessionsStore } from '@/stores/sessions'
import { type EditorCursorInfo, type EditorTab, useEditorsStore } from '@/stores/editors'
import { usePanesStore } from '@/stores/panes'
import { getTerminalBufferText } from '@/hooks/useXterm'
import { renderMarkdown as renderSafeMarkdown } from '@/lib/markdown'
import { applyGeneratedCodeToEditor, getOpenEditorContent } from '@/components/session/EditorView'

function stripThinkTags(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim()
}

function renderMarkdown(text: string): string {
  return renderSafeMarkdown(stripThinkTags(text))
}

// Extract the largest code block from AI response
function extractCodeBlock(text: string): { code: string; lang: string } | null {
  const cleaned = stripThinkTags(text)
  const regex = /```(\w*)\n([\s\S]*?)```/g
  let best: { code: string; lang: string } | null = null
  let match: RegExpExecArray | null
  while ((match = regex.exec(cleaned)) !== null) {
    const code = match[2].trim()
    if (!best || code.length > best.code.length) {
      best = { code, lang: match[1] || '' }
    }
  }
  return best
}

interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: number
  tokens?: number
  context?: string // what context was attached
  applyTarget?: ApplyTarget
}

interface ApplyTarget {
  editorTabId: string
  filePath: string
  fileName: string
  selection: EditorCursorInfo['selection']
}

async function callAIChat(messages: Array<{ role: string; content: string }>): Promise<{ content: string; tokens?: number }> {
  const { aiProvider, aiBaseUrl, aiApiKey, aiModel } = useUIStore.getState().settings
  if (!aiApiKey) throw new Error('请先在 Settings → AI 中配置 API Key')

  const result = await window.api.ai.chat({
    baseUrl: aiBaseUrl, apiKey: aiApiKey, model: aiModel, provider: aiProvider,
    messages,
  })
  if (result.error) throw new Error(result.error)
  return { content: result.content, tokens: result.tokens }
}

function buildSystemPrompt(projectName: string | undefined, projectPath: string | undefined): string {
  const customPrompt = useUIStore.getState().settings.aiSystemPrompt
  return `${customPrompt}

You are an AI coding assistant embedded in FastAgents IDE.
${projectName ? `Current project: ${projectName} (${projectPath})` : ''}

IMPORTANT rules:
- When the user asks you to modify, add, or change code and the context includes a [Selected Range], you MUST output ONLY the replacement code for that selected range in a single code block. Do NOT rewrite the whole file in that case.
- When the user asks you to modify, add, or change code and there is no [Selected Range], you MUST output the COMPLETE modified file content wrapped in a code block with the language tag, e.g. \`\`\`html ... \`\`\`.
- When analyzing code or terminal output, be concise and actionable.
- Always respond in 简体中文 (Simplified Chinese). Code and technical terms stay in English.`
}

function positionToOffset(content: string, line: number, column: number): number {
  if (line <= 1 && column <= 1) return 0

  let currentLine = 1
  let currentColumn = 1

  for (let i = 0; i < content.length; i++) {
    if (currentLine === line && currentColumn === column) return i

    const char = content[i]
    if (char === '\r') {
      if (content[i + 1] === '\n') i++
      currentLine++
      currentColumn = 1
      continue
    }
    if (char === '\n') {
      currentLine++
      currentColumn = 1
      continue
    }

    currentColumn++
  }

  return content.length
}

function replaceSelectionInContent(
  content: string,
  selection: {
    startLine: number
    startColumn: number
    endLine: number
    endColumn: number
  },
  replacement: string,
): string {
  const startOffset = positionToOffset(content, selection.startLine, selection.startColumn)
  const endOffset = positionToOffset(content, selection.endLine, selection.endColumn)
  return content.slice(0, startOffset) + replacement + content.slice(endOffset)
}

function cloneSelection(selection: EditorCursorInfo['selection']): EditorCursorInfo['selection'] {
  return selection ? { ...selection } : null
}

function buildApplyTarget(tab: EditorTab, selection: EditorCursorInfo['selection']): ApplyTarget {
  return {
    editorTabId: tab.id,
    filePath: tab.filePath,
    fileName: tab.fileName,
    selection: cloneSelection(selection),
  }
}

async function applyCodeToTarget(target: ApplyTarget, code: string): Promise<void> {
  const appliedInEditor = await applyGeneratedCodeToEditor(target.editorTabId, code, target.selection)
  if (appliedInEditor) return

  const fileContent = await window.api.fs.readFile(target.filePath)
  if (target.selection && !target.selection.isEmpty) {
    const nextContent = replaceSelectionInContent(fileContent, target.selection, code)
    await window.api.fs.writeFile(target.filePath, nextContent)
  } else {
    await window.api.fs.writeFile(target.filePath, code)
  }

  window.dispatchEvent(new CustomEvent('fastagents:file-saved', {
    detail: { filePath: target.filePath },
  }))
}

function ApplyCodeButton({ content, applyTarget }: { content: string; applyTarget?: ApplyTarget }): JSX.Element | null {
  const [applied, setApplied] = useState(false)
  const codeBlock = extractCodeBlock(content)

  const addToast = useUIStore((s) => s.addToast)
  const activeSessionId = usePanesStore((s) => s.paneActiveSession[s.activePaneId] ?? null)
  const activeEditorTab = useEditorsStore((s) =>
    activeSessionId?.startsWith('editor-') ? s.tabs.find((tab) => tab.id === activeSessionId) : undefined,
  )
  const applyTargetEditorTab = useEditorsStore((s) =>
    applyTarget ? s.tabs.find((tab) => tab.id === applyTarget.editorTabId) : undefined,
  )
  const cursorInfo = useEditorsStore((s) => s.cursorInfo)
  const editorTab = applyTarget ? applyTargetEditorTab : activeEditorTab
  const fallbackTarget = activeEditorTab ? buildApplyTarget(activeEditorTab, cursorInfo?.selection ?? null) : undefined
  const finalTarget = applyTarget ?? fallbackTarget
  const displayTarget = finalTarget ?? (editorTab ? buildApplyTarget(editorTab, null) : undefined)
  const isSelectionApply = Boolean(displayTarget?.selection && !displayTarget.selection.isEmpty)

  const handleApply = async (): Promise<void> => {
    if (!finalTarget || !codeBlock) return
    try {
      await applyCodeToTarget(finalTarget, codeBlock.code)
      setApplied(true)
      setTimeout(() => setApplied(false), 2000)
    } catch (error) {
      addToast({
        type: 'error',
        title: '应用代码失败',
        body: error instanceof Error ? error.message : '无法把 AI 结果写入文件',
      })
    }
  }

  if (!codeBlock || !displayTarget) return null

  return (
    <div className="flex gap-1.5 mt-1.5">
      <button
        onClick={handleApply}
        disabled={applied}
        className={cn(
          'flex items-center gap-1 rounded-[var(--radius-sm)] px-2 py-1 text-[10px] transition-colors',
          applied
            ? 'bg-[var(--color-success)]/15 text-[var(--color-success)]'
            : 'bg-[var(--color-accent)]/10 text-[var(--color-accent)] hover:bg-[var(--color-accent)]/20',
        )}
      >
        {applied
          ? <><Check size={10} /> {isSelectionApply ? '已应用到选区' : `已应用到 ${displayTarget.fileName}`}</>
          : <><FileDown size={10} /> {isSelectionApply ? '应用到当前选区' : `应用到 ${displayTarget.fileName}`}</>}
      </button>
      <button
        onClick={() => navigator.clipboard.writeText(codeBlock.code)}
        className="flex items-center gap-1 rounded-[var(--radius-sm)] px-2 py-1 text-[10px] bg-[var(--color-bg-surface)] text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]"
      >
        <Copy size={10} /> 复制代码
      </button>
    </div>
  )
}

// Per-project message history cache
const projectMessages = new Map<string, ChatMessage[]>()

export function AiSummary(): JSX.Element {
  const apiKey = useUIStore((s) => s.settings.aiApiKey)
  const selectedProjectId = useProjectsStore((s) => s.selectedProjectId)
  const selectedProject = useProjectsStore((s) => s.projects.find((p) => p.id === s.selectedProjectId))
  const projectKey = selectedProjectId ?? '__none__'

  const [messages, setMessagesRaw] = useState<ChatMessage[]>(() => projectMessages.get(projectKey) ?? [])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [attachContext, setAttachContext] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // Sync messages to cache and restore on project switch
  const setMessages = useCallback((updater: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[])) => {
    setMessagesRaw((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : updater
      projectMessages.set(projectKey, next)
      return next
    })
  }, [projectKey])

  const prevKeyRef = useRef(projectKey)
  useEffect(() => {
    if (prevKeyRef.current !== projectKey) {
      // Save current messages before switching
      setMessagesRaw((prev) => { projectMessages.set(prevKeyRef.current, prev); return prev })
      // Restore target project messages
      setMessagesRaw(projectMessages.get(projectKey) ?? [])
      prevKeyRef.current = projectKey
    }
  }, [projectKey])

  const activeSessionId = usePanesStore((s) => s.paneActiveSession[s.activePaneId] ?? null)
  const activeSession = useSessionsStore((s) => s.sessions.find((x) => x.id === activeSessionId))
  const cursorInfo = useEditorsStore((s) => s.cursorInfo)
  const activeEditorTab = useEditorsStore((s) =>
    activeSessionId?.startsWith('editor-') ? s.tabs.find((t) => t.id === activeSessionId) : undefined,
  )

  // Auto-scroll to bottom
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages])

  // Gather current context
  const getContext = useCallback((): { text: string; label: string } | null => {
    // Editor selection
    if (activeEditorTab && cursorInfo?.selection) {
      return null
    }
    // Terminal output
    if (activeSession && activeSessionId && !activeSessionId.startsWith('editor-')) {
      const text = getTerminalBufferText(activeSessionId, 80)
      if (text.trim()) return { text: text.slice(-4000), label: `Terminal: ${activeSession.name}` }
    }
    return null
  }, [activeSession, activeSessionId, activeEditorTab, cursorInfo])

  const handleSend = useCallback(async () => {
    const text = input.trim()
    if (!text || loading) return
    setInput('')

    // Build context attachment — only when user explicitly enables it
    let contextLabel = ''
    let contextContent = ''
    let applyTarget: ApplyTarget | undefined

    if (attachContext) {
      if (activeEditorTab) {
        contextLabel = `📄 ${activeEditorTab.fileName}`
        if (cursorInfo?.selection) {
          contextLabel += ` (L${cursorInfo.selection.startLine}-${cursorInfo.selection.endLine}, ${cursorInfo.selection.chars} chars selected)`
        }
        applyTarget = buildApplyTarget(activeEditorTab, cursorInfo?.selection ?? null)
        try {
          const fileContent = getOpenEditorContent(activeEditorTab.id)
            ?? await window.api.fs.readFile(activeEditorTab.filePath)
          if (cursorInfo?.selection && fileContent) {
            const lines = fileContent.split('\n')
            const start = Math.max(0, cursorInfo.selection.startLine - 11)
            const end = Math.min(lines.length, cursorInfo.selection.endLine + 10)
            contextContent = [
              `File: ${activeEditorTab.filePath}`,
              `Language: ${activeEditorTab.language}`,
              `[Selected Range] L${cursorInfo.selection.startLine}:C${cursorInfo.selection.startColumn} - L${cursorInfo.selection.endLine}:C${cursorInfo.selection.endColumn}`,
              '',
              `Selected code:`,
              `\`\`\`${activeEditorTab.language}`,
              cursorInfo.selection.text,
              '```',
              '',
              'Nearby context:',
              `\`\`\`${activeEditorTab.language}`,
              lines.slice(start, end).join('\n'),
              '```',
              '',
              'IMPORTANT: If you suggest a code modification, return only the replacement for the selected code block.',
            ].join('\n')
          } else {
            contextContent = `File: ${activeEditorTab.filePath}\nLanguage: ${activeEditorTab.language}\n\n\`\`\`${activeEditorTab.language}\n${fileContent.slice(0, 6000)}\n\`\`\``
          }
        } catch { /* ignore */ }
      } else {
        const ctx = getContext()
        if (ctx) {
          contextLabel = ctx.label
          contextContent = `Terminal output:\n\`\`\`\n${ctx.text}\n\`\`\``
        }
      }
      // Turn off after sending so next message doesn't auto-attach
      setAttachContext(false)
    }

    const userMsg: ChatMessage = {
      id: `msg-${Date.now()}`,
      role: 'user',
      content: text,
      timestamp: Date.now(),
      context: contextLabel || undefined,
    }
    setMessages((prev) => [...prev, userMsg])
    setLoading(true)

    try {
      // Build message history for API
      const systemPrompt = buildSystemPrompt(selectedProject?.name, selectedProject?.path)
      const apiMessages: Array<{ role: string; content: string }> = [
        { role: 'system', content: systemPrompt },
      ]

      // Add previous messages (last 10)
      const recentMsgs = [...messages, userMsg].slice(-10)
      for (const m of recentMsgs) {
        if (m.role === 'user') {
          apiMessages.push({ role: 'user', content: m.content })
        } else {
          apiMessages.push({ role: 'assistant', content: m.content })
        }
      }

      // If there's context, prepend to the last user message
      if (contextContent) {
        const lastIdx = apiMessages.length - 1
        apiMessages[lastIdx].content = `[Context]\n${contextContent}\n\n[Question]\n${text}`
      }

      const result = await callAIChat(apiMessages)

      const assistantMsg: ChatMessage = {
        id: `msg-${Date.now()}-a`,
        role: 'assistant',
        content: result.content,
        timestamp: Date.now(),
        tokens: result.tokens,
        applyTarget,
      }
      setMessages((prev) => [...prev, assistantMsg])
    } catch (err) {
      const errorMsg: ChatMessage = {
        id: `msg-${Date.now()}-e`,
        role: 'assistant',
        content: `❌ ${err instanceof Error ? err.message : String(err)}`,
        timestamp: Date.now(),
      }
      setMessages((prev) => [...prev, errorMsg])
    }

    setLoading(false)
    setTimeout(() => inputRef.current?.focus(), 50)
  }, [input, loading, messages, activeEditorTab, activeSession, activeSessionId, cursorInfo, getContext, selectedProject])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }, [handleSend])

  if (!apiKey) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 p-6 text-center">
        <Bot size={32} className="text-[var(--color-text-tertiary)]" />
        <p className="text-[var(--ui-font-sm)] text-[var(--color-text-secondary)]">AI 助手未配置</p>
        <p className="text-[var(--ui-font-xs)] text-[var(--color-text-tertiary)]">前往 Settings → AI 配置 API Key</p>
        <button
          onClick={() => useUIStore.getState().openSettings()}
          className="flex items-center gap-1.5 rounded-[var(--radius-md)] border border-[var(--color-accent)] px-3 py-1.5 text-[var(--ui-font-xs)] text-[var(--color-accent)] hover:bg-[var(--color-accent-muted)] transition-colors"
        >
          <Settings size={12} /> 打开设置
        </button>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        {messages.length === 0 && (
          <div className="flex flex-col items-center gap-3 p-6 pt-10 text-center">
            <Bot size={28} className="text-[var(--color-accent)]" />
            <p className="text-[var(--ui-font-sm)] text-[var(--color-text-secondary)]">AI 助手</p>
            <p className="text-[var(--ui-font-xs)] text-[var(--color-text-tertiary)] leading-relaxed">
              在下方输入你的问题。<br />
              会自动附带当前编辑器文件或终端输出作为上下文。
            </p>
            {/* Quick actions */}
            <div className="flex flex-col gap-1.5 w-full mt-2">
              {activeSession && !activeSessionId?.startsWith('editor-') && (
                <button
                  onClick={() => { setAttachContext(true); setInput('总结一下当前终端的输出'); setTimeout(handleSend, 100) }}
                  className="flex items-center gap-2 rounded-[var(--radius-md)] border border-[var(--color-border)] px-3 py-2 text-[var(--ui-font-xs)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-tertiary)] transition-colors text-left"
                >
                  <Sparkles size={12} className="text-[var(--color-accent)] shrink-0" />
                  总结当前终端输出
                </button>
              )}
              {activeEditorTab && (
                <button
                  onClick={() => { setAttachContext(true); setInput('解释一下这个文件的代码'); setTimeout(handleSend, 100) }}
                  className="flex items-center gap-2 rounded-[var(--radius-md)] border border-[var(--color-border)] px-3 py-2 text-[var(--ui-font-xs)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-tertiary)] transition-colors text-left"
                >
                  <FileCode size={12} className="text-[var(--color-info)] shrink-0" />
                  解释当前文件
                </button>
              )}
            </div>
          </div>
        )}

        {messages.map((msg) => (
          <div key={msg.id} className={cn('px-3 py-2', msg.role === 'user' ? 'bg-[var(--color-bg-primary)]' : '')}>
            {/* Header */}
            <div className="flex items-center gap-1.5 mb-1">
              {msg.role === 'user' ? (
                <User size={12} className="text-[var(--color-text-secondary)]" />
              ) : (
                <Bot size={12} className="text-[var(--color-accent)]" />
              )}
              <span className="text-[10px] text-[var(--color-text-tertiary)]">
                {msg.role === 'user' ? 'You' : 'AI'}
                {' · '}
                {new Date(msg.timestamp).toLocaleTimeString()}
                {msg.tokens && ` · ${msg.tokens} tok`}
              </span>
              {msg.role === 'assistant' && (
                <button
                  onClick={() => navigator.clipboard.writeText(stripThinkTags(msg.content))}
                  className="ml-auto p-0.5 text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]"
                  title="Copy"
                >
                  <Copy size={10} />
                </button>
              )}
            </div>

            {/* Context badge */}
            {msg.context && (
              <div className="flex items-center gap-1 mb-1 px-1.5 py-0.5 rounded bg-[var(--color-bg-surface)] w-fit">
                <FileCode size={10} className="text-[var(--color-text-tertiary)]" />
                <span className="text-[9px] text-[var(--color-text-tertiary)]">{msg.context}</span>
              </div>
            )}

            {/* Content */}
            {msg.role === 'user' ? (
              <p className="text-[var(--ui-font-xs)] text-[var(--color-text-primary)] whitespace-pre-wrap">{msg.content}</p>
            ) : (
              <>
                <div
                  className="ai-summary-content text-[var(--ui-font-xs)] text-[var(--color-text-secondary)] leading-relaxed"
                  dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.content) }}
                />
                <ApplyCodeButton content={msg.content} applyTarget={msg.applyTarget} />
              </>
            )}
          </div>
        ))}

        {/* Loading indicator */}
        {loading && (
          <div className="px-3 py-2 flex items-center gap-2">
            <Bot size={12} className="text-[var(--color-accent)] animate-pulse" />
            <span className="text-[var(--ui-font-xs)] text-[var(--color-text-tertiary)]">思考中...</span>
          </div>
        )}
      </div>

      {/* Context toggle */}
      {(activeEditorTab || (activeSession && !activeSessionId?.startsWith('editor-'))) && (
        <div className="shrink-0 px-3 py-1 border-t border-[var(--color-border)] bg-[var(--color-bg-primary)]">
          <button
            onClick={() => setAttachContext(!attachContext)}
            className={cn(
              'flex items-center gap-1.5 rounded px-1.5 py-0.5 transition-colors',
              attachContext
                ? 'bg-[var(--color-accent-muted)] text-[var(--color-accent)]'
                : 'text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]',
            )}
          >
            <FileCode size={10} />
            <span className="text-[9px] truncate">
              {attachContext ? '✓ ' : ''}
              {activeEditorTab
                ? `${activeEditorTab.fileName}${cursorInfo?.selection ? ` · ${cursorInfo.selection.chars} selected` : ''}`
                : `Terminal: ${activeSession?.name}`}
            </span>
          </button>
        </div>
      )}

      {/* Input area */}
      <div className="shrink-0 border-t border-[var(--color-border)] p-2">
        <div className="flex gap-1.5">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="输入消息... (Enter 发送, Shift+Enter 换行)"
            rows={2}
            className={cn(
              'flex-1 resize-none rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg-primary)]',
              'px-2.5 py-1.5 text-[var(--ui-font-xs)] text-[var(--color-text-primary)]',
              'placeholder:text-[var(--color-text-tertiary)] outline-none',
              'focus:border-[var(--color-accent)] transition-colors',
            )}
          />
          <div className="flex flex-col gap-1">
            <button
              onClick={handleSend}
              disabled={loading || !input.trim()}
              className={cn(
                'flex h-full items-center justify-center rounded-[var(--radius-md)] px-2',
                'bg-[var(--color-accent)] text-white hover:opacity-90 disabled:opacity-30',
                'transition-colors',
              )}
              title="发送"
            >
              <Send size={13} />
            </button>
          </div>
        </div>
        {messages.length > 0 && (
          <button
            onClick={() => setMessages([])}
            className="flex items-center gap-1 mt-1 text-[9px] text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]"
          >
            <Trash2 size={9} /> 清空对话
          </button>
        )}
      </div>
    </div>
  )
}
