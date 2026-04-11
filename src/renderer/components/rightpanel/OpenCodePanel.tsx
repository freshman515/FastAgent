import { Bot, CheckCircle2, Copy, FileCode2, FolderTree, LoaderCircle, PauseCircle, Plus, RefreshCw, Send, Sparkles, Wrench, XCircle } from 'lucide-react'
import { marked } from 'marked'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import { useEditorsStore } from '@/stores/editors'
import { usePanesStore } from '@/stores/panes'
import { useProjectsStore } from '@/stores/projects'
import { useUIStore } from '@/stores/ui'
import { useWorktreesStore } from '@/stores/worktrees'

interface OpencodeSessionInfo {
  id: string
  directory: string
  title: string
  time: {
    created: number
    updated: number
  }
  summary?: {
    additions: number
    deletions: number
    files: number
  }
}

interface OpencodeMessageInfo {
  id: string
  sessionID: string
  role: 'user' | 'assistant'
  time: {
    created: number
    completed?: number
  }
  modelID?: string
  providerID?: string
  mode?: string
  cost?: number
  tokens?: {
    input: number
    output: number
    reasoning: number
    cache?: {
      read: number
      write: number
    }
  }
  error?: {
    name?: string
    data?: {
      message?: string
    }
  }
}

interface BasePart {
  id: string
  messageID: string
  sessionID: string
  type: string
}

interface TextPart extends BasePart {
  type: 'text'
  text: string
}

interface ReasoningPart extends BasePart {
  type: 'reasoning'
  text: string
}

interface ToolPart extends BasePart {
  type: 'tool'
  tool: string
  callID: string
  state: {
    status: 'pending' | 'running' | 'completed' | 'error'
    title?: string
    raw?: string
    output?: string
    error?: string
  }
}

interface FilePart extends BasePart {
  type: 'file'
  filename?: string
  url: string
  source?: {
    path?: string
  }
}

interface PatchPart extends BasePart {
  type: 'patch'
  files: string[]
}

interface AgentPart extends BasePart {
  type: 'agent'
  name: string
}

type OpencodePart = TextPart | ReasoningPart | ToolPart | FilePart | PatchPart | AgentPart | BasePart

interface OpencodeMessage {
  info: OpencodeMessageInfo
  parts: OpencodePart[]
}

interface OpencodePermission {
  id: string
  sessionID: string
  messageID: string
  title: string
  type: string
  metadata?: Record<string, unknown>
  time?: {
    created: number
  }
}

interface OpencodeDiff {
  file: string
  additions: number
  deletions: number
}

interface SessionStatusState {
  type: 'idle' | 'busy' | 'retry'
  attempt?: number
  message?: string
}

interface AttachedEditorContext {
  tab: ReturnType<typeof useEditorsStore.getState>['tabs'][number]
  cursorInfo: ReturnType<typeof useEditorsStore.getState>['cursorInfo']
}

interface PromptPayload {
  text: string
  system?: string
}

const selectedSessionByDirectory = new Map<string, string>()
const selectedModelByDirectory = new Map<string, string>()
const MODEL_STORAGE_PREFIX = 'fastagents:opencode:model:'
const CARD = 'rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg-primary)]'

function formatTime(timestamp?: number): string {
  if (!timestamp) return '—'
  return new Date(timestamp).toLocaleTimeString()
}

function formatRelative(timestamp?: number): string {
  if (!timestamp) return '刚刚'
  const diff = Date.now() - timestamp
  const seconds = Math.max(0, Math.floor(diff / 1000))
  if (seconds < 5) return '刚刚'
  if (seconds < 60) return `${seconds}s 前`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m 前`
  const hours = Math.floor(minutes / 60)
  return `${hours}h 前`
}

function renderMarkdown(text: string): string {
  return marked.parse(text, { async: false }) as string
}

function summarizeParts(parts: OpencodePart[]): string {
  const text = parts.find((part): part is TextPart => part.type === 'text' && typeof (part as TextPart).text === 'string')
  if (text?.text.trim()) return text.text.trim()

  const reasoning = parts.find((part): part is ReasoningPart => part.type === 'reasoning' && typeof (part as ReasoningPart).text === 'string')
  if (reasoning?.text.trim()) return reasoning.text.trim()

  const tool = parts.find((part): part is ToolPart => part.type === 'tool')
  if (tool) return `${tool.tool} · ${tool.state.status}`

  return '无可显示内容'
}

function upsertSession(list: OpencodeSessionInfo[], session: OpencodeSessionInfo): OpencodeSessionInfo[] {
  const next = list.some((item) => item.id === session.id)
    ? list.map((item) => (item.id === session.id ? session : item))
    : [session, ...list]
  return next.sort((a, b) => b.time.updated - a.time.updated)
}

function upsertMessage(list: OpencodeMessage[], message: OpencodeMessage): OpencodeMessage[] {
  const next = list.some((item) => item.info.id === message.info.id)
    ? list.map((item) => (item.info.id === message.info.id ? { ...item, info: message.info, parts: item.parts.length > 0 ? item.parts : message.parts } : item))
    : [...list, message]
  return next.sort((a, b) => a.info.time.created - b.info.time.created)
}

function upsertPart(list: OpencodeMessage[], part: OpencodePart): OpencodeMessage[] {
  return list.map((message) => {
    if (message.info.id !== part.messageID) return message
    const parts = message.parts.some((item) => item.id === part.id)
      ? message.parts.map((item) => (item.id === part.id ? { ...item, ...part } : item))
      : [...message.parts, part]
    return { ...message, parts }
  })
}

function removePart(list: OpencodeMessage[], messageID: string, partID: string): OpencodeMessage[] {
  return list.map((message) => (
    message.info.id === messageID
      ? { ...message, parts: message.parts.filter((part) => part.id !== partID) }
      : message
  ))
}

function buildPromptPayload(
  activeEditorTab: ReturnType<typeof useEditorsStore.getState>['tabs'][number] | undefined,
  cursorInfo: ReturnType<typeof useEditorsStore.getState>['cursorInfo'],
  text: string,
): PromptPayload {
  if (!activeEditorTab) return { text }

  const selection = cursorInfo?.selection
  if (!selection || selection.isEmpty) {
    return {
      text,
      system: [
        `Active file: ${activeEditorTab.filePath}`,
        `Language: ${activeEditorTab.language}`,
        'Use the active file as context when relevant.',
      ].join('\n'),
    }
  }

  return {
    text,
    system: [
      `Active file: ${activeEditorTab.filePath}`,
      `Language: ${activeEditorTab.language}`,
      `Selected range: L${selection.startLine}:C${selection.startColumn} - L${selection.endLine}:C${selection.endColumn}`,
      'The user selected the code below. Prioritize changes to this selection or necessary nearby code. Avoid unrelated edits unless explicitly requested.',
      '',
      'Selected code:',
      `\`\`\`${activeEditorTab.language}`,
      selection.text,
      '```',
    ].join('\n'),
  }
}

function parseModelSelection(model?: string): { providerID: string; modelID: string } | undefined {
  const value = model?.trim()
  if (!value) return undefined
  const slash = value.indexOf('/')
  if (slash <= 0 || slash === value.length - 1) return undefined
  return {
    providerID: value.slice(0, slash),
    modelID: value.slice(slash + 1),
  }
}

function isUsageLikeText(text: string): boolean {
  if (text.length < 120) return false
  const normalized = text.toLowerCase()
  return normalized.includes('cost')
    && normalized.includes('input')
    && normalized.includes('output')
    && (normalized.includes('cache') || normalized.includes('model') || normalized.includes('tokens'))
}

function shortToolOutput(output: string): string {
  const normalized = output.replace(/\s+/g, ' ').trim()
  if (!normalized) return '无输出'
  return normalized.length > 80 ? `${normalized.slice(0, 80)}...` : normalized
}

function MessageBody({ message }: { message: OpencodeMessage }): JSX.Element {
  return (
    <div className="mt-2 flex flex-col gap-2">
      {message.parts.map((part) => {
        if (part.type === 'text') {
          if (isUsageLikeText(part.text)) {
            return (
              <details key={part.id} className="rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-2.5 py-2">
                <summary className="cursor-pointer text-[10px] uppercase tracking-[0.16em] text-[var(--color-text-tertiary)]">
                  用量详情
                </summary>
                <pre className="mt-2 max-h-36 overflow-auto whitespace-pre-wrap text-[10px] leading-5 text-[var(--color-text-tertiary)]">
                  {part.text}
                </pre>
              </details>
            )
          }

          return (
            <div
              key={part.id}
              className="ai-summary-content max-w-full overflow-hidden text-[var(--ui-font-xs)] leading-6 text-[var(--color-text-secondary)]"
              dangerouslySetInnerHTML={{ __html: renderMarkdown(part.text) }}
            />
          )
        }

        if (part.type === 'reasoning') {
          return (
            <details key={part.id} className="rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-2.5 py-2">
              <summary className="cursor-pointer text-[10px] uppercase tracking-[0.16em] text-[var(--color-text-tertiary)]">
                Thinking
              </summary>
              <pre className="mt-2 whitespace-pre-wrap text-[11px] leading-5 text-[var(--color-text-tertiary)]">
                {part.text}
              </pre>
            </details>
          )
        }

        if (part.type === 'tool') {
          const tone = part.state.status === 'completed'
            ? 'text-[var(--color-success)]'
            : part.state.status === 'error'
              ? 'text-[var(--color-error)]'
              : 'text-[var(--color-accent)]'
          return (
            <div key={part.id} className="rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-2.5 py-2">
              <div className="flex items-center gap-2">
                <Wrench size={12} className={tone} />
                <span className="text-[var(--ui-font-xs)] font-medium text-[var(--color-text-primary)]">{part.tool}</span>
                <span className={cn('ml-auto text-[10px] uppercase tracking-[0.12em]', tone)}>{part.state.status}</span>
              </div>
              {part.state.title && (
                <div className="mt-1 text-[11px] text-[var(--color-text-secondary)]">{part.state.title}</div>
              )}
              {part.state.output && (
                <details className="mt-2 rounded-[var(--radius-sm)] bg-[var(--color-bg-primary)] px-2 py-1.5">
                  <summary className="cursor-pointer truncate text-[10px] text-[var(--color-text-tertiary)]">
                    输出: {shortToolOutput(part.state.output)}
                  </summary>
                  <pre className="mt-2 max-h-36 overflow-auto whitespace-pre-wrap text-[10px] leading-5 text-[var(--color-text-tertiary)]">
                    {part.state.output}
                  </pre>
                </details>
              )}
              {part.state.error && (
                <div className="mt-2 text-[11px] text-[var(--color-error)]">{part.state.error}</div>
              )}
            </div>
          )
        }

        if (part.type === 'file') {
          return (
            <div key={part.id} className="flex items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-2.5 py-2 text-[11px] text-[var(--color-text-secondary)]">
              <FileCode2 size={12} className="text-[var(--color-info)]" />
              <span className="truncate">{part.filename ?? part.source?.path ?? part.url}</span>
            </div>
          )
        }

        if (part.type === 'patch') {
          return (
            <div key={part.id} className="rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-2.5 py-2">
              <div className="text-[10px] uppercase tracking-[0.16em] text-[var(--color-text-tertiary)]">Patch</div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {part.files.map((file) => (
                  <span key={file} className="rounded bg-[var(--color-bg-primary)] px-1.5 py-1 text-[10px] text-[var(--color-text-secondary)]">
                    {file}
                  </span>
                ))}
              </div>
            </div>
          )
        }

        if (part.type === 'agent') {
          return (
            <div key={part.id} className="flex items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-2.5 py-2 text-[11px] text-[var(--color-text-secondary)]">
              <Sparkles size={12} className="text-[var(--color-accent)]" />
              <span>Agent: {part.name}</span>
            </div>
          )
        }

        return (
          <div key={part.id} className="rounded-[var(--radius-sm)] border border-dashed border-[var(--color-border)] px-2.5 py-2 text-[10px] text-[var(--color-text-tertiary)]">
            {part.type}
          </div>
        )
      })}
    </div>
  )
}

export function OpenCodePanel(): JSX.Element {
  const addToast = useUIStore((state) => state.addToast)
  const selectedProjectId = useProjectsStore((state) => state.selectedProjectId)
  const selectedProject = useProjectsStore((state) => state.projects.find((project) => project.id === selectedProjectId))
  const selectedWorktreeId = useWorktreesStore((state) => state.selectedWorktreeId)
  const selectedWorktree = useWorktreesStore((state) => state.worktrees.find((worktree) => worktree.id === selectedWorktreeId))
  const activeTabId = usePanesStore((state) => state.paneActiveSession[state.activePaneId] ?? null)
  const activeEditorTab = useEditorsStore((state) => (
    activeTabId?.startsWith('editor-') ? state.tabs.find((tab) => tab.id === activeTabId) : undefined
  ))
  const cursorInfo = useEditorsStore((state) => state.cursorInfo)

  const directory = selectedWorktree?.path ?? selectedProject?.path ?? null

  const [sessions, setSessions] = useState<OpencodeSessionInfo[]>([])
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [models, setModels] = useState<string[]>([])
  const [selectedModel, setSelectedModel] = useState('')
  const [modelDirectory, setModelDirectory] = useState<string | null>(null)
  const [modelLoading, setModelLoading] = useState(false)
  const [modelError, setModelError] = useState<string | null>(null)
  const [messages, setMessages] = useState<OpencodeMessage[]>([])
  const [permissions, setPermissions] = useState<OpencodePermission[]>([])
  const [diffs, setDiffs] = useState<OpencodeDiff[]>([])
  const [status, setStatus] = useState<SessionStatusState>({ type: 'idle' })
  const [input, setInput] = useState('')
  const [attachSelection, setAttachSelection] = useState(false)
  const [attachedContext, setAttachedContext] = useState<AttachedEditorContext | null>(null)
  const [loading, setLoading] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [refreshTick, setRefreshTick] = useState(0)
  const scrollRef = useRef<HTMLDivElement>(null)
  const unsubscribeRef = useRef<null | (() => void)>(null)

  const currentSession = useMemo(
    () => sessions.find((session) => session.id === sessionId) ?? null,
    [sessionId, sessions],
  )
  const activeModel = selectedModel.trim() || undefined
  const effectiveContext = attachedContext ?? (activeEditorTab ? { tab: activeEditorTab, cursorInfo } : null)

  useEffect(() => {
    if (!directory) {
      setSelectedModel('')
      setModelDirectory(null)
      return
    }
    const stored = selectedModelByDirectory.get(directory)
      ?? window.localStorage.getItem(`${MODEL_STORAGE_PREFIX}${directory}`)
      ?? ''
    setSelectedModel(stored)
    setModelDirectory(directory)
  }, [directory])

  useEffect(() => {
    if (!directory) return
    let disposed = false
    setModelLoading(true)
    setModelError(null)
    window.api.opencode.listModels(directory)
      .then((list) => {
        if (disposed) return
        setModels(Array.isArray(list) ? list : [])
      })
      .catch((err) => {
        if (disposed) return
        setModels([])
        setModelError(err instanceof Error ? err.message : String(err))
      })
      .finally(() => {
        if (!disposed) setModelLoading(false)
      })

    return () => {
      disposed = true
    }
  }, [directory, refreshTick])

  const refreshMessages = useCallback(async (targetSessionId: string, targetDirectory: string): Promise<void> => {
    const result = await window.api.opencode.request({
      directory: targetDirectory,
      model: activeModel,
      method: 'GET',
      path: `/session/${targetSessionId}/message`,
      query: { limit: 200 },
    }) as Array<OpencodeMessage>
    setMessages(Array.isArray(result) ? result.sort((a, b) => a.info.time.created - b.info.time.created) : [])
  }, [activeModel])

  const refreshDiffs = useCallback(async (targetSessionId: string, targetDirectory: string): Promise<void> => {
    const result = await window.api.opencode.request({
      directory: targetDirectory,
      model: activeModel,
      method: 'GET',
      path: `/session/${targetSessionId}/diff`,
    }) as OpencodeDiff[] | null
    setDiffs(Array.isArray(result) ? result : [])
  }, [activeModel])

  const initializeSession = useCallback(async (targetDirectory: string): Promise<void> => {
    setLoading(true)
    setError(null)
    setPermissions([])
    try {
      const listedSessions = await window.api.opencode.request({
        directory: targetDirectory,
        model: activeModel,
        method: 'GET',
        path: '/session',
      }) as OpencodeSessionInfo[]

      const normalizedSessions = Array.isArray(listedSessions)
        ? [...listedSessions].sort((a, b) => b.time.updated - a.time.updated)
        : []
      setSessions(normalizedSessions)

      const preferredId = selectedSessionByDirectory.get(targetDirectory)
      let nextSession = normalizedSessions.find((session) => session.id === preferredId) ?? normalizedSessions[0]

      if (!nextSession) {
        nextSession = await window.api.opencode.request({
          directory: targetDirectory,
          model: activeModel,
          method: 'POST',
          path: '/session',
          body: { title: selectedProject?.name ?? 'FastAgents' },
        }) as OpencodeSessionInfo
        setSessions((current) => upsertSession(current, nextSession))
      }

      selectedSessionByDirectory.set(targetDirectory, nextSession.id)
      setSessionId(nextSession.id)
      await Promise.all([
        refreshMessages(nextSession.id, targetDirectory),
        refreshDiffs(nextSession.id, targetDirectory),
      ])

      const statuses = await window.api.opencode.request({
        directory: targetDirectory,
        model: activeModel,
        method: 'GET',
        path: '/session/status',
      }) as Record<string, SessionStatusState> | null
      setStatus(statuses?.[nextSession.id] ?? { type: 'idle' })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [activeModel, refreshDiffs, refreshMessages, selectedProject?.name])

  useEffect(() => {
    if (!directory || modelDirectory !== directory) return
    void initializeSession(directory)
  }, [directory, initializeSession, modelDirectory, refreshTick])

  useEffect(() => {
    if (!directory || modelDirectory !== directory) return
    let disposed = false
    unsubscribeRef.current?.()
    unsubscribeRef.current = null

    void window.api.opencode.subscribe(
      { directory, model: activeModel },
      (payload) => {
        if (disposed) return

        if (payload.type === 'error') {
          setError(payload.error ?? 'OpenCode 事件流已断开')
          return
        }

        const event = payload.event as { type?: string; properties?: Record<string, unknown> }
        if (!event?.type) return

        if (event.type === 'message.updated') {
          const info = event.properties?.info as OpencodeMessageInfo | undefined
          if (!info || info.sessionID !== sessionId) return
          setMessages((current) => upsertMessage(current, {
            info,
            parts: current.find((item) => item.info.id === info.id)?.parts ?? [],
          }))
          return
        }

        if (event.type === 'message.part.updated') {
          const part = event.properties?.part as OpencodePart | undefined
          if (!part || part.sessionID !== sessionId) return
          setMessages((current) => upsertPart(current, part))
          return
        }

        if (event.type === 'message.part.removed') {
          const partMessageId = event.properties?.messageID as string | undefined
          const partId = event.properties?.partID as string | undefined
          if (!partMessageId || !partId) return
          setMessages((current) => removePart(current, partMessageId, partId))
          return
        }

        if (event.type === 'permission.updated') {
          const permission = event.properties as OpencodePermission
          if (permission.sessionID !== sessionId) return
          setPermissions((current) => current.some((item) => item.id === permission.id)
            ? current.map((item) => (item.id === permission.id ? permission : item))
            : [...current, permission])
          return
        }

        if (event.type === 'permission.replied') {
          const permissionId = event.properties?.permissionID as string | undefined
          if (!permissionId) return
          setPermissions((current) => current.filter((item) => item.id !== permissionId))
          return
        }

        if (event.type === 'session.status') {
          const nextSessionId = event.properties?.sessionID as string | undefined
          if (nextSessionId !== sessionId) return
          setStatus((event.properties?.status as SessionStatusState | undefined) ?? { type: 'idle' })
          return
        }

        if (event.type === 'session.idle') {
          const nextSessionId = event.properties?.sessionID as string | undefined
          if (nextSessionId !== sessionId) return
          setStatus({ type: 'idle' })
          return
        }

        if (event.type === 'session.created' || event.type === 'session.updated') {
          const info = event.properties?.info as OpencodeSessionInfo | undefined
          if (!info) return
          setSessions((current) => upsertSession(current, info))
          return
        }

        if (event.type === 'session.deleted') {
          const info = event.properties?.info as OpencodeSessionInfo | undefined
          if (!info) return
          setSessions((current) => current.filter((item) => item.id !== info.id))
          if (info.id === sessionId) {
            selectedSessionByDirectory.delete(directory)
            setRefreshTick((tick) => tick + 1)
          }
          return
        }

        if (event.type === 'session.diff') {
          const nextSessionId = event.properties?.sessionID as string | undefined
          if (nextSessionId !== sessionId) return
          setDiffs(Array.isArray(event.properties?.diff) ? event.properties.diff as OpencodeDiff[] : [])
          return
        }

        if (event.type === 'session.error') {
          const nextSessionId = event.properties?.sessionID as string | undefined
          if (nextSessionId && nextSessionId !== sessionId) return
          const message = (event.properties?.error as { data?: { message?: string } } | undefined)?.data?.message ?? 'OpenCode 执行失败'
          setError(message)
          addToast({ type: 'error', title: 'OpenCode', body: message })
          return
        }

        if (event.type === 'file.edited') {
          const file = event.properties?.file
          if (typeof file === 'string') {
            window.dispatchEvent(new CustomEvent('fastagents:file-saved', {
              detail: { filePath: file },
            }))
          }
        }
      },
    ).then((unsubscribe) => {
      if (disposed) {
        unsubscribe()
        return
      }
      unsubscribeRef.current = unsubscribe
    }).catch((err) => {
      if (!disposed) {
        setError(err instanceof Error ? err.message : String(err))
      }
    })

    return () => {
      disposed = true
      unsubscribeRef.current?.()
      unsubscribeRef.current = null
    }
  }, [activeModel, addToast, directory, modelDirectory, sessionId])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, permissions.length])

  useEffect(() => {
    if (!attachedContext || activeEditorTab?.id === attachedContext.tab.id) return
    setAttachSelection(false)
    setAttachedContext(null)
  }, [activeEditorTab?.id, attachedContext])

  const handleCreateSession = useCallback(async (): Promise<void> => {
    if (!directory) return
    try {
      const session = await window.api.opencode.request({
        directory,
        model: activeModel,
        method: 'POST',
        path: '/session',
        body: { title: selectedProject?.name ?? 'FastAgents' },
      }) as OpencodeSessionInfo
      selectedSessionByDirectory.set(directory, session.id)
      setSessionId(session.id)
      setSessions((current) => upsertSession(current, session))
      setMessages([])
      setDiffs([])
      setPermissions([])
      setStatus({ type: 'idle' })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [activeModel, directory, selectedProject?.name])

  const handleSessionSwitch = useCallback(async (nextSessionId: string): Promise<void> => {
    if (!directory) return
    selectedSessionByDirectory.set(directory, nextSessionId)
    setSessionId(nextSessionId)
    setPermissions([])
    setError(null)
    try {
      await Promise.all([
        refreshMessages(nextSessionId, directory),
        refreshDiffs(nextSessionId, directory),
      ])
      const statuses = await window.api.opencode.request({
        directory,
        model: activeModel,
        method: 'GET',
        path: '/session/status',
      }) as Record<string, SessionStatusState> | null
      setStatus(statuses?.[nextSessionId] ?? { type: 'idle' })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [activeModel, directory, refreshDiffs, refreshMessages])

  const handleInterrupt = useCallback(async (): Promise<void> => {
    if (!directory || !sessionId) return
    await window.api.opencode.request({
      directory,
      model: activeModel,
      method: 'POST',
      path: `/session/${sessionId}/abort`,
    })
    setStatus({ type: 'idle' })
  }, [activeModel, directory, sessionId])

  const handlePermission = useCallback(async (permissionId: string, response: 'once' | 'always' | 'reject'): Promise<void> => {
    if (!directory || !sessionId) return
    await window.api.opencode.request({
      directory,
      model: activeModel,
      method: 'POST',
      path: `/session/${sessionId}/permissions/${permissionId}`,
      body: { response },
    })
    setPermissions((current) => current.filter((item) => item.id !== permissionId))
  }, [activeModel, directory, sessionId])

  const handleSend = useCallback(async (): Promise<void> => {
    const text = input.trim()
    if (!directory || !sessionId || !text || sending) return
    setSending(true)
    setError(null)
    try {
      const prompt = attachSelection
        ? buildPromptPayload(effectiveContext?.tab, effectiveContext?.cursorInfo ?? null, text)
        : { text }
      const model = parseModelSelection(activeModel)
      await window.api.opencode.request({
        directory,
        model: activeModel,
        method: 'POST',
        path: `/session/${sessionId}/prompt_async`,
        body: {
          ...(model ? { model } : {}),
          ...(prompt.system ? { system: prompt.system } : {}),
          parts: [{ type: 'text', text: prompt.text }],
        },
      })
      setInput('')
      setAttachSelection(false)
      setAttachedContext(null)
      await refreshMessages(sessionId, directory)
      setStatus({ type: 'busy' })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSending(false)
    }
  }, [activeModel, attachSelection, directory, effectiveContext, input, refreshMessages, sending, sessionId])

  const handleModelChange = useCallback((model: string): void => {
    if (!directory) return
    setSelectedModel(model)
    selectedModelByDirectory.set(directory, model)
    const storageKey = `${MODEL_STORAGE_PREFIX}${directory}`
    if (model) window.localStorage.setItem(storageKey, model)
    else window.localStorage.removeItem(storageKey)
    setError(null)
  }, [directory])

  const handleAttachContext = useCallback((): void => {
    if (attachSelection) {
      setAttachSelection(false)
      setAttachedContext(null)
      return
    }
    if (!activeEditorTab) return
    const latestCursorInfo = useEditorsStore.getState().cursorInfo
    setAttachSelection(true)
    setAttachedContext({ tab: activeEditorTab, cursorInfo: latestCursorInfo })
  }, [activeEditorTab, attachSelection])

  const handleKeyDown = useCallback((event: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      void handleSend()
    }
  }, [handleSend])

  const selectedModelMissing = Boolean(activeModel && !models.includes(activeModel))

  if (!directory) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
        <Bot size={28} className="text-[var(--color-text-tertiary)]" />
        <div className="text-[var(--ui-font-sm)] text-[var(--color-text-secondary)]">先选择一个项目</div>
        <div className="text-[var(--ui-font-xs)] text-[var(--color-text-tertiary)]">
          OpenCode 面板会绑定当前项目或当前 worktree
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-[var(--color-border)] p-3">
        <div className="flex items-start gap-2">
          <div className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-[var(--radius-md)] bg-[var(--color-accent-muted)] text-[var(--color-accent)]">
            <Bot size={16} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="truncate text-[var(--ui-font-sm)] font-semibold text-[var(--color-text-primary)]">
                {currentSession?.title ?? 'OpenCode'}
              </span>
              <span className={cn(
                'rounded-full px-2 py-0.5 text-[10px] uppercase tracking-[0.12em]',
                status.type === 'busy'
                  ? 'bg-[var(--color-warning)]/10 text-[var(--color-warning)]'
                  : status.type === 'retry'
                    ? 'bg-[var(--color-info)]/10 text-[var(--color-info)]'
                    : 'bg-[var(--color-success)]/10 text-[var(--color-success)]',
              )}>
                {status.type}
              </span>
            </div>
            <div className="mt-1 flex items-center gap-2 text-[10px] text-[var(--color-text-tertiary)]">
              <FolderTree size={11} />
              <span className="truncate">{directory}</span>
            </div>
            {currentSession && (
              <div className="mt-1 text-[10px] text-[var(--color-text-tertiary)]">
                更新于 {formatRelative(currentSession.time.updated)} · 创建于 {formatTime(currentSession.time.created)}
              </div>
            )}
          </div>
        </div>

        <div className="mt-3 flex items-center gap-2">
          <select
            value={sessionId ?? ''}
            onChange={(event) => { void handleSessionSwitch(event.target.value) }}
            className="min-w-0 flex-1 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-bg-primary)] px-2.5 py-1.5 text-[var(--ui-font-xs)] text-[var(--color-text-primary)] outline-none focus:border-[var(--color-accent)]"
          >
            {sessions.map((session) => (
              <option key={session.id} value={session.id}>
                {session.title}
              </option>
            ))}
          </select>
          <button
            onClick={() => { void handleCreateSession() }}
            className="flex h-8 w-8 items-center justify-center rounded-[var(--radius-sm)] border border-[var(--color-border)] text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-bg-tertiary)] hover:text-[var(--color-text-primary)]"
            title="新建会话"
          >
            <Plus size={14} />
          </button>
          <button
            onClick={() => setRefreshTick((tick) => tick + 1)}
            className="flex h-8 w-8 items-center justify-center rounded-[var(--radius-sm)] border border-[var(--color-border)] text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-bg-tertiary)] hover:text-[var(--color-text-primary)]"
            title="刷新"
          >
            <RefreshCw size={14} />
          </button>
          <button
            onClick={() => { void handleInterrupt() }}
            disabled={!sessionId || status.type !== 'busy'}
            className="flex h-8 w-8 items-center justify-center rounded-[var(--radius-sm)] border border-[var(--color-border)] text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-bg-tertiary)] hover:text-[var(--color-text-primary)] disabled:opacity-35"
            title="打断当前会话"
          >
            <PauseCircle size={14} />
          </button>
        </div>

        <div className="mt-2 flex items-center gap-2">
          <select
            value={selectedModel}
            onChange={(event) => handleModelChange(event.target.value)}
            className="min-w-0 flex-1 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-bg-primary)] px-2.5 py-1.5 text-[var(--ui-font-xs)] text-[var(--color-text-primary)] outline-none focus:border-[var(--color-accent)]"
            title="选择 OpenCode 模型"
          >
            <option value="">OpenCode 默认模型</option>
            {selectedModelMissing && activeModel && (
              <option value={activeModel}>{activeModel}</option>
            )}
            {models.map((model) => (
              <option key={model} value={model}>{model}</option>
            ))}
          </select>
          <button
            onClick={() => setRefreshTick((tick) => tick + 1)}
            className="flex h-8 w-8 items-center justify-center rounded-[var(--radius-sm)] border border-[var(--color-border)] text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-bg-tertiary)] hover:text-[var(--color-text-primary)]"
            title="刷新模型列表"
          >
            {modelLoading ? <LoaderCircle size={14} className="animate-spin" /> : <RefreshCw size={14} />}
          </button>
        </div>
        {modelError && (
          <div className="mt-1 truncate text-[10px] text-[var(--color-warning)]" title={modelError}>
            模型列表读取失败，可继续使用 OpenCode 默认模型
          </div>
        )}
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-3">
        {loading && (
          <div className="flex items-center gap-2 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg-primary)] px-3 py-2 text-[var(--ui-font-xs)] text-[var(--color-text-tertiary)]">
            <LoaderCircle size={13} className="animate-spin" />
            正在连接 OpenCode...
          </div>
        )}

        {error && (
          <div className="mb-3 rounded-[var(--radius-md)] border border-[var(--color-error)]/35 bg-[var(--color-error)]/8 px-3 py-2.5">
            <div className="flex items-start gap-2">
              <XCircle size={14} className="mt-0.5 text-[var(--color-error)]" />
              <div className="min-w-0 flex-1">
                <div className="text-[var(--ui-font-xs)] font-medium text-[var(--color-error)]">OpenCode 连接失败</div>
                <div className="mt-1 whitespace-pre-wrap text-[11px] leading-5 text-[var(--color-text-secondary)]">{error}</div>
                <div className="mt-2 flex gap-2">
                  <button
                    onClick={() => setRefreshTick((tick) => tick + 1)}
                    className="rounded-[var(--radius-sm)] border border-[var(--color-border)] px-2 py-1 text-[10px] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-tertiary)]"
                  >
                    重试
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {permissions.length > 0 && (
          <div className="mb-3 flex flex-col gap-2">
            {permissions.map((permission) => (
              <div key={permission.id} className={cn(CARD, 'p-3')}>
                <div className="flex items-center gap-2">
                  <Wrench size={13} className="text-[var(--color-warning)]" />
                  <span className="text-[var(--ui-font-xs)] font-semibold text-[var(--color-text-primary)]">{permission.title}</span>
                  <span className="ml-auto text-[10px] uppercase tracking-[0.12em] text-[var(--color-text-tertiary)]">{permission.type}</span>
                </div>
                {permission.metadata && (
                  <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded-[var(--radius-sm)] bg-[var(--color-bg-secondary)] p-2 text-[10px] leading-5 text-[var(--color-text-tertiary)]">
                    {JSON.stringify(permission.metadata, null, 2)}
                  </pre>
                )}
                <div className="mt-2 flex gap-2">
                  <button onClick={() => { void handlePermission(permission.id, 'once') }} className="rounded-[var(--radius-sm)] bg-[var(--color-accent)]/12 px-2.5 py-1 text-[10px] text-[var(--color-accent)] hover:bg-[var(--color-accent)]/18">本次允许</button>
                  <button onClick={() => { void handlePermission(permission.id, 'always') }} className="rounded-[var(--radius-sm)] bg-[var(--color-success)]/12 px-2.5 py-1 text-[10px] text-[var(--color-success)] hover:bg-[var(--color-success)]/18">永久允许</button>
                  <button onClick={() => { void handlePermission(permission.id, 'reject') }} className="rounded-[var(--radius-sm)] bg-[var(--color-error)]/12 px-2.5 py-1 text-[10px] text-[var(--color-error)] hover:bg-[var(--color-error)]/18">拒绝</button>
                </div>
              </div>
            ))}
          </div>
        )}

        {diffs.length > 0 && (
          <div className={cn(CARD, 'mb-3 p-3')}>
            <div className="text-[10px] uppercase tracking-[0.16em] text-[var(--color-text-tertiary)]">最近修改</div>
            <div className="mt-2 flex flex-col gap-1.5">
              {diffs.map((diff) => (
                <div key={diff.file} className="flex items-center gap-2 rounded-[var(--radius-sm)] bg-[var(--color-bg-secondary)] px-2.5 py-2 text-[11px]">
                  <FileCode2 size={12} className="text-[var(--color-info)]" />
                  <span className="min-w-0 flex-1 truncate text-[var(--color-text-primary)]">{diff.file}</span>
                  <span className="text-[var(--color-success)]">+{diff.additions}</span>
                  <span className="text-[var(--color-error)]">-{diff.deletions}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {!loading && messages.length === 0 && !error && (
          <div className="flex flex-col items-center gap-3 py-10 text-center">
            <Bot size={28} className="text-[var(--color-accent)]" />
            <div className="text-[var(--ui-font-sm)] text-[var(--color-text-secondary)]">OpenCode 已就绪</div>
            <div className="max-w-[260px] text-[var(--ui-font-xs)] leading-6 text-[var(--color-text-tertiary)]">
              这里是你自己的 OpenCode 前端，不是嵌入终端。直接发送需求，它会自己读写项目文件。
            </div>
          </div>
        )}

        {messages.map((message) => {
          const isAssistant = message.info.role === 'assistant'
          const summary = summarizeParts(message.parts)
          return (
            <div key={message.info.id} className={cn('mb-3 rounded-[var(--radius-md)] border p-3', isAssistant ? 'border-[var(--color-border)] bg-[var(--color-bg-primary)]' : 'border-[var(--color-border)] bg-[var(--color-bg-secondary)]')}>
              <div className="flex items-start gap-2">
                <div className={cn(
                  'mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full',
                  isAssistant ? 'bg-[var(--color-accent)]/12 text-[var(--color-accent)]' : 'bg-[var(--color-bg-primary)] text-[var(--color-text-secondary)]',
                )}>
                  {isAssistant ? <Bot size={12} /> : <Sparkles size={12} />}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-[var(--ui-font-xs)] font-semibold text-[var(--color-text-primary)]">
                      {isAssistant ? 'OpenCode' : '你'}
                    </span>
                    <span className="text-[10px] text-[var(--color-text-tertiary)]">
                      {formatTime(message.info.time.created)}
                    </span>
                    {isAssistant && message.info.modelID && (
                      <span className="rounded bg-[var(--color-bg-secondary)] px-1.5 py-0.5 text-[10px] text-[var(--color-text-tertiary)]">
                        {message.info.modelID}
                      </span>
                    )}
                    {isAssistant && typeof message.info.cost === 'number' && message.info.cost > 0 && (
                      <span className="rounded bg-[var(--color-bg-secondary)] px-1.5 py-0.5 text-[10px] text-[var(--color-text-tertiary)]">
                        ${message.info.cost.toFixed(4)}
                      </span>
                    )}
                    <button
                      onClick={() => navigator.clipboard.writeText(summary)}
                      className="ml-auto text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]"
                      title="复制摘要"
                    >
                      <Copy size={12} />
                    </button>
                  </div>
                  {message.info.error?.data?.message && (
                    <div className="mt-2 rounded-[var(--radius-sm)] bg-[var(--color-error)]/8 px-2 py-1.5 text-[11px] text-[var(--color-error)]">
                      {message.info.error.data.message}
                    </div>
                  )}
                  <MessageBody message={message} />
                </div>
              </div>
            </div>
          )
        })}
      </div>

      <div className="border-t border-[var(--color-border)] p-3">
        {activeEditorTab && (
          <button
            onClick={handleAttachContext}
            className={cn(
              'mb-2 flex items-center gap-1.5 rounded-[var(--radius-sm)] px-2 py-1 text-[10px] transition-colors',
              attachSelection
                ? 'bg-[var(--color-accent-muted)] text-[var(--color-accent)]'
                : 'text-[var(--color-text-tertiary)] hover:bg-[var(--color-bg-tertiary)] hover:text-[var(--color-text-secondary)]',
            )}
          >
            <FileCode2 size={10} />
            <span>
              {attachSelection ? '✓ ' : ''}
              {effectiveContext?.tab.fileName ?? activeEditorTab.fileName}
              {effectiveContext?.cursorInfo?.selection && !effectiveContext.cursorInfo.selection.isEmpty ? ` · ${effectiveContext.cursorInfo.selection.chars} chars` : ''}
            </span>
          </button>
        )}

        <div className="flex gap-2">
          <textarea
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="输入你的需求... (Enter 发送, Shift+Enter 换行)"
            rows={3}
            className="min-h-[72px] flex-1 resize-none rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg-primary)] px-3 py-2 text-[var(--ui-font-xs)] text-[var(--color-text-primary)] outline-none placeholder:text-[var(--color-text-tertiary)] focus:border-[var(--color-accent)]"
          />
          <button
            onClick={() => { void handleSend() }}
            disabled={!input.trim() || sending || !sessionId}
            className="flex w-10 shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-[var(--color-accent)] text-white transition-opacity hover:opacity-90 disabled:opacity-35"
            title="发送"
          >
            {sending ? <LoaderCircle size={15} className="animate-spin" /> : <Send size={15} />}
          </button>
        </div>

        <div className="mt-2 flex items-center justify-between text-[10px] text-[var(--color-text-tertiary)]">
          <span>
            模型: {activeModel ?? 'OpenCode 默认'}
          </span>
          {currentSession?.summary && (
            <span className="flex items-center gap-1">
              <CheckCircle2 size={10} className="text-[var(--color-success)]" />
              {currentSession.summary.files} files · +{currentSession.summary.additions} / -{currentSession.summary.deletions}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}
