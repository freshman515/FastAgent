import { TitleBar } from '@/components/layout/TitleBar'
import { LeftPanel } from '@/components/layout/LeftPanel'
import { MainPanel } from '@/components/layout/MainPanel'
import { StatusBar } from '@/components/layout/StatusBar'
import { RightPanel } from '@/components/layout/RightPanel'
import { ToastContainer } from '@/components/notification/ToastContainer'
import { SessionNamePromptDialog } from '@/components/session/SessionNamePromptDialog'
import {
  buildNewSessionOptions,
  type NewSessionOption,
} from '@/components/session/NewSessionMenu'
import { SessionIconView } from '@/components/session/SessionIconView'
import { SettingsDialog } from '@/components/settings/SettingsDialog'
import { QuickSwitcher } from '@/components/QuickSwitcher'
import { PermissionDialog } from '@/components/permission/PermissionDialog'
import { UpdateDialog } from '@/components/update/UpdateDialog'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { DetachedApp } from '@/DetachedApp'
import { focusSessionTarget } from '@/lib/focusSessionTarget'
import { focusOpenEditorSoon } from '@/components/session/EditorView'
import { focusTerminalInputSoon, scrollTerminalToLatest } from '@/hooks/useXterm'
import { getDefaultWorktreeIdForProject, switchProjectContext } from '@/lib/project-context'
import { createSessionWithPrompt } from '@/lib/createSession'
import { getPaneElementRects, getPaneLeafIds, usePanesStore, type PaneElementRect } from '@/stores/panes'
import { useCanvasStore } from '@/stores/canvas'
import { useUIStore } from '@/stores/ui'
import { useGroupsStore } from '@/stores/groups'
import { useSessionGroupsStore } from '@/stores/sessionGroups'
import { useProjectsStore } from '@/stores/projects'
import { useSessionsStore } from '@/stores/sessions'
import { useTemplatesStore } from '@/stores/templates'
import { useTasksStore } from '@/stores/tasks'
import { useInfiniteTasksStore } from '@/stores/infiniteTasks'
import { useWorktreesStore } from '@/stores/worktrees'
import { detectLanguage, type EditorTab, sanitizeEditorTab, useEditorsStore } from '@/stores/editors'
import { useLaunchesStore } from '@/stores/launches'
import { useClaudeGuiStore } from '@/stores/claudeGui'
import { useActivityMonitor } from '@/hooks/useActivityMonitor'
import { useMcpBridge } from '@/hooks/useMcpBridge'
import { updateAgentStatus } from '@/components/rightpanel/agentRuntime'
import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { isClaudeCodeType, SESSION_TYPE_CONFIG, type ClaudeGuiEvent, type Session } from '@shared/types'
import { toggleCurrentSessionFullscreen } from '@/lib/currentSessionFullscreen'
import { playTaskCompleteSound } from '@/lib/notificationSound'
import { cn } from '@/lib/utils'

interface EditorPathContext {
  projectId: string
  worktreeId?: string
  path: string
}

interface PaneCommandCloseTarget {
  paneId: string
  sessionId: string
  sessionName: string
  ptyId?: string
}

interface PaneCommandProjectContext {
  projectId: string
  worktreeId: string | null
}

type PaneCommandTabGroup = 'terminal' | 'claude' | 'codex' | 'gemini' | 'opencode' | 'browser' | 'file' | 'other'

const LEGACY_ANONYMOUS_PROJECT_ID = '__anonymous_project__'

const PANE_COMMAND_GROUP_ORDER: PaneCommandTabGroup[] = ['terminal', 'claude', 'codex', 'gemini', 'opencode', 'browser', 'file', 'other']
const PANE_COMMAND_SHORTCUTS: Array<{ key: string; label: string }> = [
  { key: 'h/j/k/l', label: '切换 pane' },
  { key: 'Alt+h/l/←/→', label: '切换标签' },
  { key: 'Ctrl+hjkl/方向', label: '调整大小' },
  { key: 'i', label: '编辑输入' },
  { key: 'n', label: '新建会话' },
  { key: 'w', label: '关闭会话' },
  { key: 'p', label: '切换项目' },
  { key: 'Tab', label: '上一个项目' },
  { key: '[/]', label: '最近项目' },
  { key: ':', label: '输入命令' },
  { key: '?', label: '帮助' },
  { key: 'r', label: '重命名' },
  { key: 'd', label: '弹出窗口' },
  { key: 'f', label: '切换标签' },
  { key: 'b', label: '返回' },
  { key: 'g', label: '跳转' },
  { key: 'u', label: '滚动到底部' },
  { key: 'Shift+hjkl', label: '移动标签' },
  { key: 'o', label: '只保留当前 pane' },
  { key: 'c', label: '复制路径' },
  { key: '1-9', label: '跳到 pane' },
  { key: 'z', label: '放大/恢复' },
  { key: 'e', label: '等分' },
  { key: 't', label: '按类型分屏' },
  { key: 'v', label: '垂直分屏' },
  { key: 's', label: '水平分屏' },
  { key: 'x', label: '关闭 pane' },
  { key: 'm', label: '合并全部' },
]

function getPaneCommandGroupForSession(type: string): PaneCommandTabGroup {
  if (type === 'terminal' || type === 'terminal-wsl') return 'terminal'
  if (type === 'browser') return 'browser'
  if (type.startsWith('claude')) return 'claude'
  if (type.startsWith('codex')) return 'codex'
  if (type.startsWith('gemini')) return 'gemini'
  if (type.startsWith('opencode')) return 'opencode'
  return 'other'
}

function getPaneCommandSplitKey(tabId: string): string | null {
  if (tabId.startsWith('editor-')) return 'file'
  const session = useSessionsStore.getState().sessions.find((item) => item.id === tabId)
  if (!session) return null
  const group = getPaneCommandGroupForSession(session.type)
  return group === 'other' ? `session:${session.type}` : group
}

function smartSplitPanesByType(activeTabId: string | null): void {
  const paneStore = usePanesStore.getState()
  const orderedIds = getPaneLeafIds(paneStore.root).flatMap((paneId) => paneStore.paneSessions[paneId] ?? [])
  const groupRank = new Map(PANE_COMMAND_GROUP_ORDER.map((group, index) => [group, index]))
  const buckets = new Map<string, { group: PaneCommandTabGroup; firstIndex: number; ids: string[] }>()

  orderedIds.forEach((id, index) => {
    const key = getPaneCommandSplitKey(id)
    if (!key) return
    const group = id.startsWith('editor-')
      ? 'file'
      : getPaneCommandGroupForSession(useSessionsStore.getState().sessions.find((item) => item.id === id)?.type ?? '')
    const existing = buckets.get(key)
    if (existing) {
      existing.ids.push(id)
      return
    }
    buckets.set(key, { group, firstIndex: index, ids: [id] })
  })

  const groups = [...buckets.values()]
    .sort((a, b) => {
      const rankDiff = (groupRank.get(a.group) ?? PANE_COMMAND_GROUP_ORDER.length)
        - (groupRank.get(b.group) ?? PANE_COMMAND_GROUP_ORDER.length)
      return rankDiff || a.firstIndex - b.firstIndex
    })
    .map((bucket) => bucket.ids)

  if (groups.length > 0) paneStore.applyPaneGroups(groups, activeTabId)
}

function activatePaneAndSession(paneId: string): void {
  const paneStore = usePanesStore.getState()
  paneStore.setActivePaneId(paneId)
  const paneSessions = paneStore.paneSessions[paneId] ?? []
  const activeTabId = paneStore.paneActiveSession[paneId] && paneSessions.includes(paneStore.paneActiveSession[paneId]!)
    ? paneStore.paneActiveSession[paneId]
    : (paneSessions[0] ?? null)
  if (activeTabId && !activeTabId.startsWith('editor-')) {
    useSessionsStore.getState().setActive(activeTabId)
  }
}

function switchActivePaneTab(offset: -1 | 1): boolean {
  const paneStore = usePanesStore.getState()
  const paneId = paneStore.activePaneId
  const tabIds = paneStore.paneSessions[paneId] ?? []
  if (tabIds.length < 2) return false

  const activeTabId = paneStore.paneActiveSession[paneId]
  const activeIndex = activeTabId ? tabIds.indexOf(activeTabId) : -1
  const currentIndex = activeIndex >= 0 ? activeIndex : 0
  const nextIndex = (currentIndex + offset + tabIds.length) % tabIds.length
  paneStore.setPaneActiveSession(paneId, tabIds[nextIndex])
  return true
}

function isPlainTextEditingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.closest('.xterm')) return false
  const tagName = target.tagName
  return tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT' || target.isContentEditable
}

function PaneCommandOverlay({
  rects,
  activePaneId,
  editing,
}: {
  rects: PaneElementRect[]
  activePaneId: string
  editing: boolean
}): JSX.Element {
  return (
    <div className="pointer-events-none fixed inset-0 z-[9400]">
      <div className="absolute bottom-3 left-1/2 z-20 h-8 w-max max-w-[calc(100vw-40px)] -translate-x-1/2 rounded-[var(--radius-lg)] border border-[var(--color-accent)]/25 bg-[var(--color-bg-tertiary)]/80 px-3 shadow-2xl shadow-black/35 backdrop-blur-md">
        <div className="flex h-full items-center gap-x-3 overflow-hidden whitespace-nowrap">
          <span className="rounded-[var(--radius-sm)] bg-[var(--color-accent)]/16 px-2 py-1 text-[11px] font-bold text-[var(--color-accent)]">
            {editing ? 'Edit Mode' : 'Pane Mode'}
          </span>
          <span className="text-[11px] text-[var(--color-text-secondary)]">
            {editing ? 'Esc 返回命令模式' : 'p 项目 · Tab 上个项目 · u 底部 · f 标签 · g 跳转 · : 命令 · ? 帮助 · Esc 退出'}
          </span>
        </div>
      </div>

      {rects.map((rect, index) => {
        const active = rect.paneId === activePaneId
        return (
          <div
            key={rect.paneId}
            className={cn(
              'fixed z-10 rounded-[var(--radius-md)] border',
              active
                ? 'border-[var(--color-accent)]/40 bg-transparent shadow-[0_0_0_1px_var(--color-accent-muted),0_0_22px_rgba(168,85,247,0.22)]'
                : 'border-transparent bg-transparent shadow-none',
            )}
            style={{
              left: rect.left,
              top: rect.top,
              width: rect.width,
              height: rect.height,
            }}
          >
            <div className={cn(
              'absolute left-2 top-2 flex h-7 min-w-7 items-center justify-center rounded-[var(--radius-sm)] px-2 text-[12px] font-bold shadow-lg',
              active
                ? 'bg-[var(--color-accent)]/80 text-white'
                : 'border border-[var(--color-accent)]/35 bg-[var(--color-bg-tertiary)]/90 text-[var(--color-accent)]',
            )}>
              {index + 1}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function normalizePaneCommandQuery(value: string): string {
  return value.trim().toLowerCase().replace(/[\s_-]+/g, '')
}

function scoreNewSessionOption(option: NewSessionOption, query: string): number {
  if (!query) return 1
  const fields = [
    option.label,
    option.id,
    option.type ?? '',
    option.customSessionDefinitionId ?? '',
  ].map(normalizePaneCommandQuery).filter(Boolean)

  if (fields.some((field) => field === query)) return 100
  if (fields.some((field) => field.startsWith(query))) return 80
  if (fields.some((field) => field.includes(query))) return 40
  return 0
}

function getPaneCommandProjectContextKey(projectId: string, worktreeId?: string | null): string {
  return `${projectId}::${worktreeId ?? 'main'}`
}

function parsePaneCommandProjectContextKey(key: string): PaneCommandProjectContext | null {
  const [projectId, worktreePart] = key.split('::')
  if (!projectId) return null
  return {
    projectId,
    worktreeId: worktreePart && worktreePart !== 'main' ? worktreePart : null,
  }
}

function usePaneCommandSearchPanelKeyboardCapture({
  panelRef,
  inputRef,
  query,
  onBack,
  onArrowDown,
  onArrowUp,
  onEnter,
  setQuery,
}: {
  panelRef: { current: HTMLDivElement | null }
  inputRef: { current: HTMLInputElement | null }
  query: string
  onBack: () => void
  onArrowDown: () => void
  onArrowUp: () => void
  onEnter: () => void
  setQuery: Dispatch<SetStateAction<string>>
}): void {
  useEffect(() => {
    const handleWindowKeyDown = (event: KeyboardEvent): void => {
      const panel = panelRef.current
      if (!panel) return

      const targetInsidePanel = event.target instanceof Node && panel.contains(event.target)
      if (targetInsidePanel && isPlainTextEditingTarget(event.target)) return
      if (targetInsidePanel && ['Escape', 'ArrowDown', 'ArrowUp', 'Enter'].includes(event.key)) return

      const shouldHandleText = event.key === 'Backspace'
        || (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey)
      if (targetInsidePanel && !shouldHandleText) return

      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
      inputRef.current?.focus({ preventScroll: true })

      if (event.key === 'Escape') {
        onBack()
        return
      }
      if (event.key === 'ArrowDown') {
        onArrowDown()
        return
      }
      if (event.key === 'ArrowUp') {
        onArrowUp()
        return
      }
      if (event.key === 'Enter') {
        onEnter()
        return
      }
      if (event.key === 'Backspace') {
        setQuery((current) => current.slice(0, -1))
        return
      }
      if (event.key.length !== 1 || event.ctrlKey || event.metaKey || event.altKey) return
      setQuery((current) => current + event.key)
    }

    window.addEventListener('keydown', handleWindowKeyDown, true)
    return () => window.removeEventListener('keydown', handleWindowKeyDown, true)
  }, [inputRef, onArrowDown, onArrowUp, onBack, onEnter, panelRef, query, setQuery])
}

interface PaneCommandInputCommand {
  id: string
  label: string
  detail: string
  aliases: string[]
  run: () => void
}

function scorePaneCommandInputCommand(command: PaneCommandInputCommand, query: string): number {
  if (!query) return 1
  const fields = [command.label, command.detail, command.id, ...command.aliases]
    .map(normalizePaneCommandQuery)
    .filter(Boolean)

  if (fields.some((field) => field === query)) return 100
  if (fields.some((field) => field.startsWith(query))) return 80
  if (fields.some((field) => field.includes(query))) return 40
  return 0
}

function PaneCommandInputDialog({
  commands,
  onBack,
}: {
  commands: PaneCommandInputCommand[]
  onBack: () => void
}): JSX.Element {
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)

  const visibleCommands = useMemo(() => {
    const normalizedQuery = normalizePaneCommandQuery(query)
    return commands
      .map((command, index) => ({
        command,
        index,
        score: scorePaneCommandInputCommand(command, normalizedQuery),
      }))
      .filter((item) => !normalizedQuery || item.score > 0)
      .sort((a, b) => b.score - a.score || a.index - b.index)
      .map((item) => item.command)
      .slice(0, 12)
  }, [commands, query])

  useEffect(() => {
    setSelectedIndex(0)
  }, [query])

  useEffect(() => {
    window.requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true }))
  }, [])

  useEffect(() => {
    if (selectedIndex >= visibleCommands.length) {
      setSelectedIndex(Math.max(0, visibleCommands.length - 1))
    }
  }, [selectedIndex, visibleCommands.length])

  const selectPrevious = useCallback(() => {
    setSelectedIndex((current) => Math.max(0, current - 1))
  }, [])
  const selectNext = useCallback(() => {
    setSelectedIndex((current) => Math.min(current + 1, Math.max(0, visibleCommands.length - 1)))
  }, [visibleCommands.length])
  const runCommand = useCallback((command: PaneCommandInputCommand | null) => {
    if (!command) return
    command.run()
  }, [])
  const confirmSelected = useCallback(() => {
    runCommand(visibleCommands[selectedIndex] ?? null)
  }, [runCommand, selectedIndex, visibleCommands])

  usePaneCommandSearchPanelKeyboardCapture({
    panelRef,
    inputRef,
    query,
    onBack,
    onArrowDown: selectNext,
    onArrowUp: selectPrevious,
    onEnter: confirmSelected,
    setQuery,
  })

  return (
    <div
      className="fixed inset-0 z-[9600] flex items-start justify-center bg-black/30 px-4 pt-16 backdrop-blur-[1px]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onBack()
      }}
    >
      <div
        ref={panelRef}
        className="w-[min(560px,calc(100vw-32px))] overflow-hidden rounded-[var(--radius-xl)] border border-[var(--color-border)] bg-[var(--color-bg-secondary)] shadow-2xl shadow-black/45"
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            event.stopPropagation()
            onBack()
            return
          }
          if (event.key === 'ArrowDown') {
            event.preventDefault()
            event.stopPropagation()
            selectNext()
            return
          }
          if (event.key === 'ArrowUp') {
            event.preventDefault()
            event.stopPropagation()
            selectPrevious()
            return
          }
          if (event.key === 'Enter') {
            event.preventDefault()
            event.stopPropagation()
            confirmSelected()
          }
        }}
      >
        <div className="border-b border-[var(--color-border)] px-4 py-3">
          <div className="mb-2 flex items-center justify-between gap-3">
            <div className="text-[var(--ui-font-sm)] font-semibold text-[var(--color-text-primary)]">命令</div>
            <div className="text-[10px] text-[var(--color-text-tertiary)]">Esc 返回 Pane Mode</div>
          </div>
          <div className="flex h-10 items-center rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg-primary)] px-3">
            <span className="mr-2 font-mono text-[var(--ui-font-sm)] font-bold text-[var(--color-accent)]">:</span>
            <input
              ref={inputRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              spellCheck={false}
              placeholder="输入命令，例如 project、tab、rename"
              className="h-full min-w-0 flex-1 bg-transparent text-[var(--ui-font-sm)] text-[var(--color-text-primary)] outline-none placeholder:text-[var(--color-text-tertiary)]"
            />
          </div>
        </div>
        <div className="max-h-[420px] overflow-y-auto p-1.5">
          {visibleCommands.length === 0 ? (
            <div className="px-3 py-6 text-center text-[var(--ui-font-sm)] text-[var(--color-text-tertiary)]">
              没有匹配的命令
            </div>
          ) : visibleCommands.map((command, index) => (
            <button
              key={command.id}
              type="button"
              onClick={() => runCommand(command)}
              className={cn(
                'flex min-h-11 w-full items-center gap-3 rounded-[var(--radius-md)] px-3 py-2 text-left transition-colors',
                index === selectedIndex
                  ? 'bg-[var(--color-accent)]/16 text-[var(--color-text-primary)]'
                  : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-tertiary)]',
              )}
            >
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-bg-primary)] font-mono text-[10px] font-bold text-[var(--color-text-secondary)]">
                :
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[var(--ui-font-sm)] font-medium">{command.label}</span>
                <span className="block truncate text-[11px] text-[var(--color-text-tertiary)]">{command.detail}</span>
              </span>
              {index === selectedIndex && (
                <span className="shrink-0 text-[10px] text-[var(--color-text-tertiary)]">Enter</span>
              )}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

function PaneCommandNewSessionDialog({
  onClose,
  onAfterNamePromptClose,
}: {
  onClose: () => void
  onAfterNamePromptClose: () => void
}): JSX.Element {
  const selectedProjectId = useProjectsStore((s) => s.selectedProjectId)
  const customSessionDefinitions = useUIStore((s) => s.settings.customSessionDefinitions)
  const hiddenNewSessionOptionIds = useUIStore((s) => s.settings.hiddenNewSessionOptionIds)
  const newSessionOptionOrder = useUIStore((s) => s.settings.newSessionOptionOrder)
  const setSessionNamePrompt = useUIStore((s) => s.setSessionNamePrompt)
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)

  const options = useMemo(
    () => buildNewSessionOptions(customSessionDefinitions, hiddenNewSessionOptionIds, newSessionOptionOrder),
    [customSessionDefinitions, hiddenNewSessionOptionIds, newSessionOptionOrder],
  )
  const filteredOptions = useMemo(() => {
    const normalizedQuery = normalizePaneCommandQuery(query)
    return options
      .map((option, index) => ({ option, index, score: scoreNewSessionOption(option, normalizedQuery) }))
      .filter((item) => !normalizedQuery || item.score > 0)
      .sort((a, b) => b.score - a.score || a.index - b.index)
      .map((item) => item.option)
  }, [options, query])
  const selectedOption = filteredOptions[selectedIndex] ?? null

  useEffect(() => {
    setSelectedIndex(0)
  }, [query])

  useEffect(() => {
    window.requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true }))
  }, [])

  const openNamePrompt = useCallback((option: NewSessionOption) => {
    if (!selectedProjectId) return
    const projectId = selectedProjectId
    const paneId = usePanesStore.getState().activePaneId
    const worktreeId = getDefaultWorktreeIdForProject(projectId)
    const defaultName = option.customSessionDefinitionId
      ? useSessionsStore.getState().generateDefaultSessionName(projectId, 'terminal', option.label)
      : useSessionsStore.getState().generateDefaultSessionName(projectId, option.type ?? 'terminal')
    const createInActivePane = (name: string): void => {
      createSessionWithPrompt({
        projectId,
        type: option.type,
        customSessionDefinitionId: option.customSessionDefinitionId,
        worktreeId,
        forceName: name,
      }, (sessionId) => {
        const paneStore = usePanesStore.getState()
        paneStore.addSessionToPane(paneId, sessionId)
        paneStore.setActivePaneId(paneId)
        useSessionsStore.getState().setActive(sessionId)
      })
    }

    onClose()
    setSessionNamePrompt({
      defaultName,
      title: `新建 ${option.label}`,
      description: '输入会话名称，回车后在当前 pane 创建。',
      sessionType: option.type,
      onSubmit: (name) => {
        createInActivePane(name)
        onAfterNamePromptClose()
      },
      onUseDefault: () => {
        createInActivePane(defaultName)
        onAfterNamePromptClose()
      },
      onCancel: onAfterNamePromptClose,
    })
  }, [onAfterNamePromptClose, onClose, selectedProjectId, setSessionNamePrompt])

  const selectPrevious = useCallback(() => {
    setSelectedIndex((current) => Math.max(0, current - 1))
  }, [])
  const selectNext = useCallback(() => {
    setSelectedIndex((current) => Math.min(current + 1, Math.max(0, filteredOptions.length - 1)))
  }, [filteredOptions.length])
  const confirmSelected = useCallback(() => {
    if (selectedOption) openNamePrompt(selectedOption)
  }, [openNamePrompt, selectedOption])

  usePaneCommandSearchPanelKeyboardCapture({
    panelRef,
    inputRef,
    query,
    onBack: onClose,
    onArrowDown: selectNext,
    onArrowUp: selectPrevious,
    onEnter: confirmSelected,
    setQuery,
  })

  return (
    <div
      className="fixed inset-0 z-[9600] flex items-start justify-center bg-black/30 px-4 pt-20 backdrop-blur-[1px]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        ref={panelRef}
        className={cn(
          'w-[min(520px,calc(100vw-32px))] overflow-hidden rounded-[var(--radius-xl)]',
          'border border-[var(--color-border)] bg-[var(--color-bg-secondary)] shadow-2xl shadow-black/45',
        )}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            onClose()
            return
          }
          if (event.key === 'ArrowDown') {
            event.preventDefault()
            selectNext()
            return
          }
          if (event.key === 'ArrowUp') {
            event.preventDefault()
            selectPrevious()
            return
          }
          if (event.key === 'Enter') {
            event.preventDefault()
            confirmSelected()
          }
        }}
      >
        <div className="border-b border-[var(--color-border)] px-4 py-3">
          <div className="mb-2 text-[var(--ui-font-sm)] font-semibold text-[var(--color-text-primary)]">
            新建会话
          </div>
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            spellCheck={false}
            placeholder="输入类型，例如 co、claude、t"
            className={cn(
              'h-10 w-full rounded-[var(--radius-md)] border border-[var(--color-border)]',
              'bg-[var(--color-bg-primary)] px-3 text-[var(--ui-font-sm)] text-[var(--color-text-primary)]',
              'placeholder:text-[var(--color-text-tertiary)] outline-none',
              'focus:border-[var(--color-accent)] focus:ring-2 focus:ring-[var(--color-accent)]/20',
            )}
          />
        </div>
        <div className="max-h-[360px] overflow-y-auto p-1.5">
          {!selectedProjectId ? (
            <div className="px-3 py-6 text-center text-[var(--ui-font-sm)] text-[var(--color-text-tertiary)]">
              请先选择一个项目
            </div>
          ) : filteredOptions.length === 0 ? (
            <div className="px-3 py-6 text-center text-[var(--ui-font-sm)] text-[var(--color-text-tertiary)]">
              没有匹配的会话类型
            </div>
          ) : filteredOptions.map((option, index) => (
            <button
              key={option.id}
              type="button"
              onClick={() => openNamePrompt(option)}
              className={cn(
                'flex h-10 w-full items-center gap-3 rounded-[var(--radius-md)] px-3 text-left transition-colors',
                index === selectedIndex
                  ? 'bg-[var(--color-accent)]/16 text-[var(--color-text-primary)]'
                  : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-tertiary)] hover:text-[var(--color-text-primary)]',
              )}
            >
              <SessionIconView
                icon={option.customSessionDefinitionId ? option.icon : undefined}
                fallbackSrc={option.customSessionDefinitionId ? undefined : option.icon}
                className="h-5 w-5 shrink-0"
                imageClassName="h-4 w-4 object-contain"
              />
              <span className="min-w-0 flex-1 truncate text-[var(--ui-font-sm)] font-medium">
                {option.label}
              </span>
              {index === selectedIndex && (
                <span className="text-[10px] text-[var(--color-text-tertiary)]">Enter</span>
              )}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

interface PaneCommandProjectSwitchItem {
  id: string
  projectId: string
  worktreeId: string | null
  kind: 'project' | 'worktree'
  title: string
  subtitle: string
  groupName: string | null
  groupColor: string | null
  searchText: string
  priority: number
  isCurrent: boolean
  badge: string
}

function PaneCommandProjectSwitcher({
  recentKeys,
  onBack,
  onSelect,
}: {
  recentKeys: string[]
  onBack: () => void
  onSelect: (context: PaneCommandProjectContext) => void
}): JSX.Element {
  const projects = useProjectsStore((s) => s.projects)
  const selectedProjectId = useProjectsStore((s) => s.selectedProjectId)
  const groups = useGroupsStore((s) => s.groups)
  const worktrees = useWorktreesStore((s) => s.worktrees)
  const selectedWorktreeId = useWorktreesStore((s) => s.selectedWorktreeId)
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const visibleItemsRef = useRef<PaneCommandProjectSwitchItem[]>([])
  const selectedIndexRef = useRef(0)

  const groupNameById = useMemo(
    () => new Map(groups.map((group) => [group.id, group.name])),
    [groups],
  )
  const groupColorById = useMemo(
    () => new Map(groups.map((group) => [group.id, group.color])),
    [groups],
  )
  const recentRank = useMemo(
    () => new Map(recentKeys.map((key, index) => [key, index])),
    [recentKeys],
  )
  const selectedWorktree = useMemo(
    () => worktrees.find((item) => item.id === selectedWorktreeId && item.projectId === selectedProjectId),
    [selectedProjectId, selectedWorktreeId, worktrees],
  )
  const effectiveSelectedWorktreeId = selectedWorktree?.isMain ? null : (selectedWorktreeId ?? null)
  const currentContextKey = selectedProjectId
    ? getPaneCommandProjectContextKey(selectedProjectId, effectiveSelectedWorktreeId)
    : null
  const previousContextKey = currentContextKey
    ? (recentKeys.find((key) => key !== currentContextKey) ?? null)
    : null
  const scoreProjectSwitchItem = useCallback((key: string, isCurrent: boolean): number => {
    if (previousContextKey && key === previousContextKey) return 2000
    const rank = recentRank.get(key)
    return (isCurrent ? 1000 : 0) + (rank !== undefined ? 500 - rank * 10 : 0)
  }, [previousContextKey, recentRank])
  const items = useMemo<PaneCommandProjectSwitchItem[]>(() => {
    const result: PaneCommandProjectSwitchItem[] = []

    for (const project of projects) {
      const groupName = groupNameById.get(project.groupId) ?? ''
      const groupColor = groupColorById.get(project.groupId) ?? null
      const mainKey = getPaneCommandProjectContextKey(project.id, null)
      const isCurrentMain = selectedProjectId === project.id && !effectiveSelectedWorktreeId

      result.push({
        id: mainKey,
        projectId: project.id,
        worktreeId: null,
        kind: 'project',
        title: project.name,
        subtitle: project.path,
        groupName: groupName || null,
        groupColor,
        searchText: [project.name, project.path, groupName, 'main'].filter(Boolean).join(' '),
        priority: scoreProjectSwitchItem(mainKey, isCurrentMain),
        isCurrent: isCurrentMain,
        badge: 'Project',
      })

      for (const worktree of worktrees.filter((item) => item.projectId === project.id && !item.isMain)) {
        const key = getPaneCommandProjectContextKey(project.id, worktree.id)
        const isCurrent = selectedProjectId === project.id && effectiveSelectedWorktreeId === worktree.id
        result.push({
          id: key,
          projectId: project.id,
          worktreeId: worktree.id,
          kind: 'worktree',
          title: `${project.name} / ${worktree.branch}`,
          subtitle: worktree.path,
          groupName: groupName || null,
          groupColor,
          searchText: [project.name, project.path, groupName, worktree.branch, worktree.path].filter(Boolean).join(' '),
          priority: scoreProjectSwitchItem(key, isCurrent),
          isCurrent,
          badge: 'Worktree',
        })
      }
    }

    return result.sort((a, b) => b.priority - a.priority || a.title.localeCompare(b.title))
  }, [effectiveSelectedWorktreeId, groupColorById, groupNameById, projects, scoreProjectSwitchItem, selectedProjectId, worktrees])

  const visibleItems = useMemo(() => {
    const normalizedQuery = normalizePaneCommandQuery(query)
    if (!normalizedQuery) return items
    return items.filter((item) => normalizePaneCommandQuery(item.searchText).includes(normalizedQuery))
  }, [items, query])
  visibleItemsRef.current = visibleItems
  selectedIndexRef.current = selectedIndex

  const focusInput = useCallback(() => {
    inputRef.current?.focus({ preventScroll: true })
  }, [])

  const scheduleInputFocus = useCallback(() => {
    window.requestAnimationFrame(focusInput)
    window.setTimeout(focusInput, 40)
    window.setTimeout(focusInput, 160)
  }, [focusInput])

  useEffect(() => {
    setSelectedIndex(0)
  }, [query])

  useEffect(() => {
    scheduleInputFocus()
  }, [scheduleInputFocus])

  useEffect(() => {
    scheduleInputFocus()
  }, [effectiveSelectedWorktreeId, scheduleInputFocus, selectedProjectId])

  useEffect(() => {
    if (visibleItems.length === 0 && selectedIndex !== 0) {
      setSelectedIndex(0)
      return
    }
    if (selectedIndex >= visibleItems.length) {
      setSelectedIndex(Math.max(0, visibleItems.length - 1))
    }
  }, [selectedIndex, visibleItems.length])

  const activateItem = useCallback((item: PaneCommandProjectSwitchItem) => {
    if (!item) return
    onSelect({ projectId: item.projectId, worktreeId: item.worktreeId })
  }, [onSelect])

  const activateSelected = useCallback(() => {
    const item = visibleItemsRef.current[selectedIndexRef.current]
    if (!item) return
    activateItem(item)
  }, [activateItem])

  useEffect(() => {
    const handleWindowKeyDown = (event: KeyboardEvent): void => {
      const panel = panelRef.current
      if (!panel) return
      if (event.target instanceof Node && panel.contains(event.target)) return

      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
      focusInput()

      if (event.key === 'Escape') {
        onBack()
        return
      }
      if (event.key === 'ArrowDown') {
        setSelectedIndex((current) => Math.min(current + 1, Math.max(0, visibleItemsRef.current.length - 1)))
        return
      }
      if (event.key === 'ArrowUp') {
        setSelectedIndex((current) => Math.max(0, current - 1))
        return
      }
      if (event.key === 'Enter') {
        activateSelected()
        return
      }
      if (event.key === 'Backspace') {
        setQuery((current) => current.slice(0, -1))
        return
      }
      if (event.key.length !== 1 || event.ctrlKey || event.metaKey || event.altKey) return
      setQuery((current) => current + event.key)
    }

    window.addEventListener('keydown', handleWindowKeyDown, true)
    return () => window.removeEventListener('keydown', handleWindowKeyDown, true)
  }, [activateSelected, focusInput, onBack, query])

  return (
    <div
      className="fixed inset-0 z-[9600] flex items-start justify-center bg-black/30 px-4 pt-20 backdrop-blur-[1px]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onBack()
      }}
    >
      <div
        ref={panelRef}
        data-pane-command-project-switcher
        className={cn(
          'w-[min(620px,calc(100vw-32px))] overflow-hidden rounded-[var(--radius-xl)]',
          'border border-[var(--color-border)] bg-[var(--color-bg-secondary)] shadow-2xl shadow-black/45',
        )}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            event.stopPropagation()
            onBack()
            return
          }
          if (event.key === 'ArrowDown') {
            event.preventDefault()
            event.stopPropagation()
            setSelectedIndex((current) => Math.min(current + 1, Math.max(0, visibleItems.length - 1)))
            return
          }
          if (event.key === 'ArrowUp') {
            event.preventDefault()
            event.stopPropagation()
            setSelectedIndex((current) => Math.max(0, current - 1))
            return
          }
          if (event.key === 'Enter') {
            event.preventDefault()
            event.stopPropagation()
            activateSelected()
          }
        }}
      >
        <div className="border-b border-[var(--color-border)] px-4 py-3">
          <div className="mb-2 flex items-center justify-between gap-3">
            <div className="text-[var(--ui-font-sm)] font-semibold text-[var(--color-text-primary)]">
              切换项目
            </div>
            <div className="text-[10px] text-[var(--color-text-tertiary)]">
              Esc 返回 Pane Mode
            </div>
          </div>
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            spellCheck={false}
            placeholder="搜索项目、路径、分组或 worktree 分支"
            className={cn(
              'h-10 w-full rounded-[var(--radius-md)] border border-[var(--color-border)]',
              'bg-[var(--color-bg-primary)] px-3 text-[var(--ui-font-sm)] text-[var(--color-text-primary)]',
              'placeholder:text-[var(--color-text-tertiary)] outline-none',
            )}
          />
        </div>
        <div className="max-h-[420px] overflow-y-auto p-1.5">
          {visibleItems.length === 0 ? (
            <div className="px-3 py-6 text-center text-[var(--ui-font-sm)] text-[var(--color-text-tertiary)]">
              没有匹配的项目或 worktree
            </div>
          ) : visibleItems.map((item, index) => (
            <button
              key={item.id}
              type="button"
              onClick={() => activateItem(item)}
              className={cn(
                'flex min-h-12 w-full items-center gap-3 rounded-[var(--radius-md)] px-3 py-2 text-left transition-colors',
                index === selectedIndex
                  ? 'bg-[var(--color-accent)]/16 text-[var(--color-text-primary)]'
                  : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-tertiary)]/70',
              )}
            >
              <div className={cn(
                'flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius-md)] border text-[11px] font-bold',
                item.kind === 'worktree'
                  ? 'border-[var(--color-accent)]/30 bg-[var(--color-accent)]/10 text-[var(--color-accent)]'
                  : 'border-[var(--color-border)] bg-[var(--color-bg-primary)] text-[var(--color-text-secondary)]',
              )}>
                {item.kind === 'worktree' ? 'WT' : 'P'}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="truncate text-[var(--ui-font-sm)] font-medium">{item.title}</span>
                  {item.isCurrent && (
                    <span className="shrink-0 rounded-full bg-[var(--color-accent)]/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.08em] text-[var(--color-accent)]">
                      当前
                    </span>
                  )}
                  {item.kind === 'worktree' && (
                    <span className="shrink-0 rounded-full bg-[var(--color-bg-tertiary)] px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.08em] text-[var(--color-text-tertiary)]">
                      {item.badge}
                    </span>
                  )}
                  {item.groupName && (
                    <span
                      className="shrink-0 rounded-full border px-1.5 py-0.5 text-[9px] font-medium"
                      style={item.groupColor ? {
                        borderColor: `${item.groupColor}55`,
                        backgroundColor: `${item.groupColor}1f`,
                        color: item.groupColor,
                      } : undefined}
                    >
                      {item.groupName}
                    </span>
                  )}
                </div>
                <div className="mt-0.5 truncate text-[11px] text-[var(--color-text-tertiary)]">
                  {item.subtitle}
                </div>
              </div>
              {index === selectedIndex && (
                <span className="shrink-0 text-[10px] text-[var(--color-text-tertiary)]">Enter</span>
              )}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

function PaneCommandHelpPanel({ onClose }: { onClose: () => void }): JSX.Element {
  return (
    <div
      className="fixed inset-0 z-[9600] flex items-start justify-center bg-black/30 px-4 pt-16 backdrop-blur-[1px]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="w-[min(680px,calc(100vw-32px))] overflow-hidden rounded-[var(--radius-xl)] border border-[var(--color-border)] bg-[var(--color-bg-secondary)] shadow-2xl shadow-black/45">
        <div className="flex items-center justify-between border-b border-[var(--color-border)] px-4 py-3">
          <div className="text-[var(--ui-font-sm)] font-semibold text-[var(--color-text-primary)]">Pane Mode 快捷键</div>
          <div className="text-[10px] text-[var(--color-text-tertiary)]">? / Esc 关闭</div>
        </div>
        <div className="grid max-h-[520px] grid-cols-1 gap-1 overflow-y-auto p-2 sm:grid-cols-2">
          {PANE_COMMAND_SHORTCUTS.map((item) => (
            <div key={`${item.key}-${item.label}`} className="flex items-center gap-3 rounded-[var(--radius-md)] px-3 py-2">
              <span className="min-w-24 rounded-[var(--radius-sm)] bg-[var(--color-bg-tertiary)] px-2 py-1 text-center font-mono text-[11px] font-bold text-[var(--color-text-primary)]">
                {item.key}
              </span>
              <span className="text-[var(--ui-font-sm)] text-[var(--color-text-secondary)]">{item.label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function getPaneCommandActiveTab(): { paneId: string; tabId: string | null; tabIds: string[] } {
  const paneStore = usePanesStore.getState()
  const paneId = paneStore.activePaneId
  const tabIds = paneStore.paneSessions[paneId] ?? []
  const tabId = paneStore.paneActiveSession[paneId] && tabIds.includes(paneStore.paneActiveSession[paneId]!)
    ? paneStore.paneActiveSession[paneId]
    : (tabIds[0] ?? null)
  return { paneId, tabId, tabIds }
}

function getPaneCommandTabLabel(tabId: string): string {
  if (tabId.startsWith('editor-')) {
    return useEditorsStore.getState().tabs.find((tab) => tab.id === tabId)?.fileName ?? '文件'
  }
  return useSessionsStore.getState().sessions.find((session) => session.id === tabId)?.name ?? 'Session'
}

function getPaneCommandTabDetail(tabId: string): string {
  if (tabId.startsWith('editor-')) {
    const tab = useEditorsStore.getState().tabs.find((item) => item.id === tabId)
    return tab?.filePath ?? 'Editor'
  }
  const session = useSessionsStore.getState().sessions.find((item) => item.id === tabId)
  return session ? SESSION_TYPE_CONFIG[session.type].label : 'Session'
}

function PaneCommandRenameDialog({
  tabId,
  onBack,
  onRenamed,
}: {
  tabId: string
  onBack: () => void
  onRenamed: () => void
}): JSX.Element {
  const session = useSessionsStore((s) => s.sessions.find((item) => item.id === tabId))
  const updateSession = useSessionsStore((s) => s.updateSession)
  const [value, setValue] = useState(session?.name ?? '')
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    window.requestAnimationFrame(() => inputRef.current?.select())
  }, [])

  return (
    <div
      className="fixed inset-0 z-[9600] flex items-start justify-center bg-black/30 px-4 pt-20 backdrop-blur-[1px]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onBack()
      }}
    >
      <div className="w-[min(460px,calc(100vw-32px))] overflow-hidden rounded-[var(--radius-xl)] border border-[var(--color-border)] bg-[var(--color-bg-secondary)] shadow-2xl shadow-black/45">
        <div className="border-b border-[var(--color-border)] px-4 py-3">
          <div className="mb-2 text-[var(--ui-font-sm)] font-semibold text-[var(--color-text-primary)]">重命名当前会话</div>
          <input
            ref={inputRef}
            value={value}
            onChange={(event) => setValue(event.target.value)}
            spellCheck={false}
            disabled={!session}
            className="h-10 w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg-primary)] px-3 text-[var(--ui-font-sm)] text-[var(--color-text-primary)] outline-none"
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault()
                onBack()
                return
              }
              if (event.key === 'Enter') {
                event.preventDefault()
                const trimmed = value.trim()
                if (session && trimmed) updateSession(session.id, { name: trimmed })
                onRenamed()
              }
            }}
          />
        </div>
        {!session && (
          <div className="px-4 py-3 text-[var(--ui-font-sm)] text-[var(--color-text-tertiary)]">当前 tab 不是会话，不能重命名。</div>
        )}
      </div>
    </div>
  )
}

interface PaneCommandTabSwitchItem {
  id: string
  title: string
  detail: string
  searchText: string
  isCurrent: boolean
  isPrevious: boolean
  priority: number
}

function PaneCommandTabSwitcher({
  onBack,
  onSelect,
}: {
  onBack: () => void
  onSelect: (tabId: string) => void
}): JSX.Element {
  const activePaneId = usePanesStore((s) => s.activePaneId)
  const paneSessions = usePanesStore((s) => s.paneSessions[activePaneId] ?? [])
  const activeTabId = usePanesStore((s) => s.paneActiveSession[activePaneId] ?? null)
  const paneRecentSessions = usePanesStore((s) => s.paneRecentSessions[activePaneId] ?? [])
  const sessions = useSessionsStore((s) => s.sessions)
  const editors = useEditorsStore((s) => s.tabs)
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)

  const recentRank = useMemo(
    () => new Map(paneRecentSessions.map((id, index) => [id, index])),
    [paneRecentSessions],
  )
  const previousTabId = paneRecentSessions.find((id) => id !== activeTabId && paneSessions.includes(id)) ?? null
  const items = useMemo<PaneCommandTabSwitchItem[]>(() => paneSessions.map((id) => {
    const rank = recentRank.get(id)
    const isCurrent = id === activeTabId
    const isPrevious = id === previousTabId
    const priority = isPrevious
      ? 2000
      : (isCurrent ? 1000 : 0) + (rank !== undefined ? 500 - rank * 10 : 0)
    if (id.startsWith('editor-')) {
      const tab = editors.find((item) => item.id === id)
      return {
        id,
        title: tab?.fileName ?? '文件',
        detail: tab?.filePath ?? 'Editor',
        searchText: [tab?.fileName, tab?.filePath, tab?.language].filter(Boolean).join(' '),
        isCurrent,
        isPrevious,
        priority,
      }
    }
    const session = sessions.find((item) => item.id === id)
    return {
      id,
      title: session?.name ?? 'Session',
      detail: session ? SESSION_TYPE_CONFIG[session.type].label : 'Session',
      searchText: [session?.name, session?.type, session?.label].filter(Boolean).join(' '),
      isCurrent,
      isPrevious,
      priority,
    }
  }).sort((a, b) => b.priority - a.priority || a.title.localeCompare(b.title)), [activeTabId, editors, paneSessions, previousTabId, recentRank, sessions])
  const visibleItems = useMemo(() => {
    const normalizedQuery = normalizePaneCommandQuery(query)
    if (!normalizedQuery) return items
    return items.filter((item) => normalizePaneCommandQuery(item.searchText).includes(normalizedQuery))
  }, [items, query])

  useEffect(() => {
    setSelectedIndex(0)
  }, [query])
  useEffect(() => {
    window.requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true }))
  }, [])

  const select = useCallback((index: number) => {
    const item = visibleItems[index]
    if (item) onSelect(item.id)
  }, [onSelect, visibleItems])
  const selectPrevious = useCallback(() => {
    setSelectedIndex((current) => Math.max(0, current - 1))
  }, [])
  const selectNext = useCallback(() => {
    setSelectedIndex((current) => Math.min(current + 1, Math.max(0, visibleItems.length - 1)))
  }, [visibleItems.length])
  const confirmSelected = useCallback(() => {
    select(selectedIndex)
  }, [select, selectedIndex])

  usePaneCommandSearchPanelKeyboardCapture({
    panelRef,
    inputRef,
    query,
    onBack,
    onArrowDown: selectNext,
    onArrowUp: selectPrevious,
    onEnter: confirmSelected,
    setQuery,
  })

  return (
    <div
      className="fixed inset-0 z-[9600] flex items-start justify-center bg-black/30 px-4 pt-20 backdrop-blur-[1px]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onBack()
      }}
    >
      <div
        ref={panelRef}
        className="w-[min(520px,calc(100vw-32px))] overflow-hidden rounded-[var(--radius-xl)] border border-[var(--color-border)] bg-[var(--color-bg-secondary)] shadow-2xl shadow-black/45"
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            event.stopPropagation()
            onBack()
            return
          }
          if (event.key === 'ArrowDown') {
            event.preventDefault()
            event.stopPropagation()
            selectNext()
            return
          }
          if (event.key === 'ArrowUp') {
            event.preventDefault()
            event.stopPropagation()
            selectPrevious()
            return
          }
          if (event.key === 'Enter') {
            event.preventDefault()
            event.stopPropagation()
            confirmSelected()
          }
        }}
      >
        <div className="border-b border-[var(--color-border)] px-4 py-3">
          <div className="mb-2 flex items-center justify-between">
            <div className="text-[var(--ui-font-sm)] font-semibold text-[var(--color-text-primary)]">当前 pane 标签</div>
            <div className="text-[10px] text-[var(--color-text-tertiary)]">Esc 返回 Pane Mode</div>
          </div>
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索当前 pane 内标签"
            className="h-10 w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg-primary)] px-3 text-[var(--ui-font-sm)] text-[var(--color-text-primary)] outline-none placeholder:text-[var(--color-text-tertiary)]"
          />
        </div>
        <div className="max-h-[360px] overflow-y-auto p-1.5">
          {visibleItems.map((item, index) => (
            <button
              key={item.id}
              type="button"
              onClick={() => select(index)}
              className={cn(
                'flex min-h-11 w-full items-center gap-3 rounded-[var(--radius-md)] px-3 py-2 text-left transition-colors',
                index === selectedIndex ? 'bg-[var(--color-accent)]/16 text-[var(--color-text-primary)]' : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-tertiary)]',
              )}
            >
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-bg-primary)] text-[10px] font-bold">
                {item.id.startsWith('editor-') ? 'F' : 'S'}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[var(--ui-font-sm)] font-medium">{item.title}</span>
                <span className="block truncate text-[11px] text-[var(--color-text-tertiary)]">{item.detail}</span>
              </span>
              {item.isPrevious && <span className="text-[10px] text-[var(--color-accent)]">上一个</span>}
              {!item.isPrevious && item.isCurrent && <span className="text-[10px] text-[var(--color-accent)]">当前</span>}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

type PaneCommandJumpKind = 'project' | 'worktree' | 'session' | 'file'

interface PaneCommandJumpItem {
  id: string
  kind: PaneCommandJumpKind
  title: string
  detail: string
  searchText: string
  projectId: string
  worktreeId: string | null
  tabId?: string
  filePath?: string
}

function PaneCommandJumpMenu({
  onBack,
  onSelect,
}: {
  onBack: () => void
  onSelect: (item: PaneCommandJumpItem) => void
}): JSX.Element {
  const projects = useProjectsStore((s) => s.projects)
  const worktrees = useWorktreesStore((s) => s.worktrees)
  const sessions = useSessionsStore((s) => s.sessions)
  const editors = useEditorsStore((s) => s.tabs)
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)

  const projectNameById = useMemo(() => new Map(projects.map((project) => [project.id, project.name])), [projects])
  const items = useMemo<PaneCommandJumpItem[]>(() => {
    const projectItems = projects.map((project) => ({
      id: `project:${project.id}`,
      kind: 'project' as const,
      title: project.name,
      detail: project.path,
      searchText: [project.name, project.path].join(' '),
      projectId: project.id,
      worktreeId: null,
    }))
    const worktreeItems = worktrees.filter((worktree) => !worktree.isMain).map((worktree) => {
      const projectName = projectNameById.get(worktree.projectId) ?? 'Project'
      return {
        id: `worktree:${worktree.id}`,
        kind: 'worktree' as const,
        title: `${projectName} / ${worktree.branch}`,
        detail: worktree.path,
        searchText: [projectName, worktree.branch, worktree.path].join(' '),
        projectId: worktree.projectId,
        worktreeId: worktree.id,
      }
    })
    const sessionItems = sessions.map((session) => ({
      id: `session:${session.id}`,
      kind: 'session' as const,
      title: session.name,
      detail: `${projectNameById.get(session.projectId) ?? 'Project'} · ${SESSION_TYPE_CONFIG[session.type].label}`,
      searchText: [session.name, session.type, session.label, projectNameById.get(session.projectId)].filter(Boolean).join(' '),
      projectId: session.projectId,
      worktreeId: session.worktreeId ?? null,
      tabId: session.id,
    }))
    const fileItems = editors.map((tab) => ({
      id: `file:${tab.id}`,
      kind: 'file' as const,
      title: tab.fileName,
      detail: tab.filePath,
      searchText: [tab.fileName, tab.filePath, tab.language, projectNameById.get(tab.projectId)].filter(Boolean).join(' '),
      projectId: tab.projectId,
      worktreeId: tab.worktreeId ?? null,
      tabId: tab.id,
      filePath: tab.filePath,
    }))
    return [...projectItems, ...worktreeItems, ...sessionItems, ...fileItems]
  }, [editors, projectNameById, projects, sessions, worktrees])
  const visibleItems = useMemo(() => {
    const normalizedQuery = normalizePaneCommandQuery(query)
    const filtered = normalizedQuery
      ? items.filter((item) => normalizePaneCommandQuery(item.searchText).includes(normalizedQuery))
      : items
    return filtered.slice(0, 80)
  }, [items, query])

  useEffect(() => {
    setSelectedIndex(0)
  }, [query])
  useEffect(() => {
    window.requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true }))
  }, [])

  const select = useCallback((index: number) => {
    const item = visibleItems[index]
    if (item) onSelect(item)
  }, [onSelect, visibleItems])
  const selectPrevious = useCallback(() => {
    setSelectedIndex((current) => Math.max(0, current - 1))
  }, [])
  const selectNext = useCallback(() => {
    setSelectedIndex((current) => Math.min(current + 1, Math.max(0, visibleItems.length - 1)))
  }, [visibleItems.length])
  const confirmSelected = useCallback(() => {
    select(selectedIndex)
  }, [select, selectedIndex])

  usePaneCommandSearchPanelKeyboardCapture({
    panelRef,
    inputRef,
    query,
    onBack,
    onArrowDown: selectNext,
    onArrowUp: selectPrevious,
    onEnter: confirmSelected,
    setQuery,
  })

  return (
    <div
      className="fixed inset-0 z-[9600] flex items-start justify-center bg-black/30 px-4 pt-20 backdrop-blur-[1px]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onBack()
      }}
    >
      <div
        ref={panelRef}
        className="w-[min(640px,calc(100vw-32px))] overflow-hidden rounded-[var(--radius-xl)] border border-[var(--color-border)] bg-[var(--color-bg-secondary)] shadow-2xl shadow-black/45"
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            event.stopPropagation()
            onBack()
            return
          }
          if (event.key === 'ArrowDown') {
            event.preventDefault()
            event.stopPropagation()
            selectNext()
            return
          }
          if (event.key === 'ArrowUp') {
            event.preventDefault()
            event.stopPropagation()
            selectPrevious()
            return
          }
          if (event.key === 'Enter') {
            event.preventDefault()
            event.stopPropagation()
            confirmSelected()
          }
        }}
      >
        <div className="border-b border-[var(--color-border)] px-4 py-3">
          <div className="mb-2 flex items-center justify-between">
            <div className="text-[var(--ui-font-sm)] font-semibold text-[var(--color-text-primary)]">跳转</div>
            <div className="text-[10px] text-[var(--color-text-tertiary)]">项目 / worktree / 会话 / 已打开文件</div>
          </div>
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索并跳转"
            className="h-10 w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg-primary)] px-3 text-[var(--ui-font-sm)] text-[var(--color-text-primary)] outline-none placeholder:text-[var(--color-text-tertiary)]"
          />
        </div>
        <div className="max-h-[420px] overflow-y-auto p-1.5">
          {visibleItems.map((item, index) => (
            <button
              key={item.id}
              type="button"
              onClick={() => select(index)}
              className={cn(
                'flex min-h-11 w-full items-center gap-3 rounded-[var(--radius-md)] px-3 py-2 text-left transition-colors',
                index === selectedIndex ? 'bg-[var(--color-accent)]/16 text-[var(--color-text-primary)]' : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-tertiary)]',
              )}
            >
              <span className="flex h-7 min-w-7 shrink-0 items-center justify-center rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-bg-primary)] px-1 text-[9px] font-bold uppercase">
                {item.kind === 'project' ? 'P' : item.kind === 'worktree' ? 'WT' : item.kind === 'session' ? 'S' : 'F'}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[var(--ui-font-sm)] font-medium">{item.title}</span>
                <span className="block truncate text-[11px] text-[var(--color-text-tertiary)]">{item.detail}</span>
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
}

function toRelativePath(filePath: string, rootPath: string): string {
  const normalizedFile = normalizePath(filePath)
  const normalizedRoot = normalizePath(rootPath)
  if (normalizedFile === normalizedRoot) return filePath.split(/[\\/]/).pop() ?? filePath
  if (!normalizedFile.startsWith(`${normalizedRoot}/`)) return filePath
  return filePath.slice(rootPath.length).replace(/^[/\\]/, '') || filePath
}

function isClaudeGuiFileMutatingTool(toolName: string | undefined): boolean {
  return toolName === 'Edit' || toolName === 'Write' || toolName === 'MultiEdit' || toolName === 'NotebookEdit'
}

function collectFilePaths(value: unknown): string[] {
  if (typeof value === 'string') {
    return /^[A-Za-z]:[\\/]/.test(value) || value.startsWith('/') ? [value] : []
  }

  if (Array.isArray(value)) {
    return value.flatMap((item) => collectFilePaths(item))
  }

  if (!value || typeof value !== 'object') return []

  const record = value as Record<string, unknown>
  const directKeys = ['file_path', 'filePath', 'path']
  const nestedKeys = ['files', 'paths', 'edits', 'changes']

  const directMatches = directKeys.flatMap((key) => collectFilePaths(record[key]))
  const nestedMatches = nestedKeys.flatMap((key) => collectFilePaths(record[key]))

  return [...directMatches, ...nestedMatches]
}

function extractClaudeGuiEditedFiles(event: ClaudeGuiEvent, pendingEditedFiles: Map<string, string[]>): string[] {
  if (event.type === 'tool-use') {
    if (!isClaudeGuiFileMutatingTool(event.toolName)) return []
    const filePaths = Array.from(new Set(collectFilePaths(event.rawInput)))
    if (event.toolUseId && filePaths.length > 0) {
      pendingEditedFiles.set(event.toolUseId, filePaths)
    }
    return []
  }

  if (event.type !== 'tool-result' || !event.toolUseId) return []

  const filePaths = pendingEditedFiles.get(event.toolUseId) ?? []
  pendingEditedFiles.delete(event.toolUseId)
  return event.isError ? [] : filePaths
}

function getEditorPathContexts(rawProjects: unknown[], rawWorktrees: unknown[]): EditorPathContext[] {
  const worktreeContexts = (Array.isArray(rawWorktrees) ? rawWorktrees : [])
    .flatMap((entry) => {
      if (!entry || typeof entry !== 'object') return []
      const worktree = entry as Record<string, unknown>
      if (typeof worktree.projectId !== 'string' || typeof worktree.path !== 'string') return []
      return [{
        projectId: worktree.projectId,
        worktreeId: worktree.isMain === true
          ? undefined
          : (typeof worktree.id === 'string' ? worktree.id : undefined),
        path: worktree.path,
      }]
    })

  const existingProjectIds = new Set(worktreeContexts.map((context) => context.projectId))
  const projectContexts = (Array.isArray(rawProjects) ? rawProjects : [])
    .flatMap((entry) => {
      if (!entry || typeof entry !== 'object') return []
      const project = entry as Record<string, unknown>
      if (typeof project.id !== 'string' || typeof project.path !== 'string') return []
      if (existingProjectIds.has(project.id)) return []
      return [{ projectId: project.id, path: project.path }]
    })

  return [...worktreeContexts, ...projectContexts]
    .sort((a, b) => normalizePath(b.path).length - normalizePath(a.path).length)
}

function inferEditorContext(filePath: string, contexts: EditorPathContext[]): { projectId: string; worktreeId?: string } | undefined {
  const normalizedFilePath = normalizePath(filePath)
  const match = contexts.find((context) => {
    const normalizedContextPath = normalizePath(context.path)
    return normalizedFilePath === normalizedContextPath || normalizedFilePath.startsWith(`${normalizedContextPath}/`)
  })

  return match ? { projectId: match.projectId, worktreeId: match.worktreeId } : undefined
}

async function filterExistingEditorTabs(
  raw: unknown[],
  rawProjects: unknown[],
  rawWorktrees: unknown[],
): Promise<{ tabs: EditorTab[]; changed: boolean }> {
  const pathContexts = getEditorPathContexts(rawProjects, rawWorktrees)
  let changed = false
  const sanitizedTabs = raw.flatMap((tab) => {
    if (!tab || typeof tab !== 'object') {
      changed = true
      return []
    }
    const filePath = typeof (tab as { filePath?: unknown }).filePath === 'string'
      ? (tab as { filePath: string }).filePath
      : null
    const sanitized = sanitizeEditorTab(
      tab,
      filePath ? inferEditorContext(filePath, pathContexts) : undefined,
    )
    if (!sanitized) {
      changed = true
      return []
    }
    const rawTab = tab as Record<string, unknown>
    if (
      rawTab.language !== sanitized.language
      || rawTab.projectId !== sanitized.projectId
      || rawTab.worktreeId !== sanitized.worktreeId
    ) {
      changed = true
    }
    return [sanitized]
  })

  const existingTabs = (await Promise.all(
    sanitizedTabs.map(async (tab) => {
      try {
        const stat = await window.api.fs.stat(tab.filePath)
        if (stat.isFile) return tab
        changed = true
        return null
      } catch {
        changed = true
        return null
      }
    }),
  )).filter((tab): tab is EditorTab => tab !== null)

  return {
    tabs: existingTabs,
    changed,
  }
}

function sanitizePaneSessions(
  rawPaneSessions: unknown,
  rawPaneActiveSession: unknown,
  validTabIds: Set<string>,
): {
  paneSessions: Record<string, string[]>
  paneActiveSession: Record<string, string | null>
  changed: boolean
} {
  const paneSessionsInput = rawPaneSessions && typeof rawPaneSessions === 'object'
    ? rawPaneSessions as Record<string, unknown>
    : {}
  const paneActiveInput = rawPaneActiveSession && typeof rawPaneActiveSession === 'object'
    ? rawPaneActiveSession as Record<string, unknown>
    : {}

  const paneSessions: Record<string, string[]> = {}
  const paneActiveSession: Record<string, string | null> = {}
  let changed = false

  for (const [paneId, value] of Object.entries(paneSessionsInput)) {
    const sessionIds = Array.isArray(value)
      ? value.filter((id): id is string => typeof id === 'string')
      : []
    const validSessionIds = sessionIds.filter((id) => validTabIds.has(id))
    const rawActiveSession = paneActiveInput[paneId]
    const activeSession = typeof rawActiveSession === 'string' && validSessionIds.includes(rawActiveSession)
      ? rawActiveSession
      : (validSessionIds[0] ?? null)

    if (!Array.isArray(value) || sessionIds.length !== value.length || validSessionIds.length !== sessionIds.length) {
      changed = true
    }
    if (rawActiveSession !== activeSession) {
      changed = true
    }

    paneSessions[paneId] = validSessionIds
    paneActiveSession[paneId] = activeSession
  }

  return { paneSessions, paneActiveSession, changed }
}

function sanitizePanesConfig(raw: unknown, validTabIds: Set<string>): { panes: Record<string, unknown> | null; changed: boolean } {
  if (!raw || typeof raw !== 'object') return { panes: null, changed: false }
  const panes = raw as Record<string, unknown>
  if (!panes.root || !panes.paneSessions) return { panes: null, changed: false }

  const { paneSessions, paneActiveSession, changed: currentChanged } = sanitizePaneSessions(
    panes.paneSessions,
    panes.paneActiveSession,
    validTabIds,
  )

  const rawProjectLayouts = panes.projectLayouts && typeof panes.projectLayouts === 'object'
    ? panes.projectLayouts as Record<string, unknown>
    : {}
  const projectLayouts: Record<string, unknown> = {}
  let changed = currentChanged

  for (const [layoutKey, layoutValue] of Object.entries(rawProjectLayouts)) {
    if (!layoutValue || typeof layoutValue !== 'object') {
      changed = true
      continue
    }

    const layout = layoutValue as Record<string, unknown>
    const { paneSessions: layoutPaneSessions, paneActiveSession: layoutActiveSession, changed: layoutChanged } = sanitizePaneSessions(
      layout.paneSessions,
      layout.paneActiveSession,
      validTabIds,
    )

    if (layoutChanged) {
      changed = true
    }

    projectLayouts[layoutKey] = {
      ...layout,
      paneSessions: layoutPaneSessions,
      paneActiveSession: layoutActiveSession,
    }
  }

  return {
    panes: {
      ...panes,
      paneSessions,
      paneActiveSession,
      projectLayouts,
    },
    changed,
  }
}

export function App(): JSX.Element {
  // If this window is a detached pop-out, render the detached UI instead
  if (window.api.detach.isDetached) {
    return <DetachedApp />
  }

  return <MainApp />
}

function MainApp(): JSX.Element {
  const [ready, setReady] = useState(false)
  const [paneCommandMode, setPaneCommandMode] = useState(false)
  const [paneCommandEditing, setPaneCommandEditing] = useState(false)
  const [paneCommandNewSessionOpen, setPaneCommandNewSessionOpen] = useState(false)
  const [paneCommandProjectSwitcherOpen, setPaneCommandProjectSwitcherOpen] = useState(false)
  const [paneCommandHelpOpen, setPaneCommandHelpOpen] = useState(false)
  const [paneCommandRenameTargetId, setPaneCommandRenameTargetId] = useState<string | null>(null)
  const [paneCommandTabSwitcherOpen, setPaneCommandTabSwitcherOpen] = useState(false)
  const [paneCommandJumpOpen, setPaneCommandJumpOpen] = useState(false)
  const [paneCommandInputOpen, setPaneCommandInputOpen] = useState(false)
  const [paneCommandRecentProjectKeys, setPaneCommandRecentProjectKeys] = useState<string[]>([])
  const [paneCommandCloseTarget, setPaneCommandCloseTarget] = useState<PaneCommandCloseTarget | null>(null)
  const [paneCommandRects, setPaneCommandRects] = useState<PaneElementRect[]>([])
  const paneCommandModeRef = useRef(false)
  const paneCommandEditingRef = useRef(false)
  const paneCommandInputModeRestorePendingRef = useRef(false)
  const paneCommandProjectSwitcherOpenRef = useRef(false)
  const paneCommandFocusRef = useRef<HTMLDivElement | null>(null)
  const paneCommandPanelOpeningUntilRef = useRef(0)
  const appChromeStyle = useUIStore((s) => s.settings.appChromeStyle)
  const selectedProjectIdForPaneCommand = useProjectsStore((s) => s.selectedProjectId)
  const selectedWorktreeIdForPaneCommand = useWorktreesStore((s) => s.selectedWorktreeId)
  const worktreesForPaneCommand = useWorktreesStore((s) => s.worktrees)
  const paneCommandActivePaneId = usePanesStore((s) => s.activePaneId)
  const paneCommandRoot = usePanesStore((s) => s.root)
  const effectiveSelectedWorktreeIdForPaneCommand = useMemo(() => {
    const selectedWorktree = worktreesForPaneCommand.find((item) =>
      item.id === selectedWorktreeIdForPaneCommand && item.projectId === selectedProjectIdForPaneCommand)
    return selectedWorktree?.isMain ? null : (selectedWorktreeIdForPaneCommand ?? null)
  }, [selectedProjectIdForPaneCommand, selectedWorktreeIdForPaneCommand, worktreesForPaneCommand])
  const refreshPaneCommandRects = useCallback(() => {
    const paneStore = usePanesStore.getState()
    setPaneCommandRects(getPaneElementRects(getPaneLeafIds(paneStore.root)))
  }, [])
  const focusPaneCommandSink = useCallback(() => {
    window.requestAnimationFrame(() => {
      paneCommandFocusRef.current?.focus({ preventScroll: true })
    })
  }, [])
  const guardPaneCommandPanelOpening = useCallback(() => {
    paneCommandPanelOpeningUntilRef.current = Date.now() + 180
  }, [])
  const guardPaneCommandPanelReturn = useCallback(() => {
    paneCommandPanelOpeningUntilRef.current = Date.now() + 220
  }, [])
  useEffect(() => {
    paneCommandModeRef.current = paneCommandMode
  }, [paneCommandMode])
  useEffect(() => {
    paneCommandEditingRef.current = paneCommandEditing
  }, [paneCommandEditing])
  useEffect(() => {
    paneCommandProjectSwitcherOpenRef.current = paneCommandProjectSwitcherOpen
  }, [paneCommandProjectSwitcherOpen])
  const focusPaneCommandActiveTarget = useCallback(() => {
    const { paneId, tabId } = getPaneCommandActiveTab()
    if (!tabId) return
    const paneStore = usePanesStore.getState()
    paneStore.setActivePaneId(paneId)
    paneStore.setPaneActiveSession(paneId, tabId)
    if (tabId.startsWith('editor-')) {
      focusOpenEditorSoon(tabId)
      return
    }
    const sessionStore = useSessionsStore.getState()
    if (!sessionStore.sessions.some((item) => item.id === tabId)) return
    sessionStore.setActive(tabId)
    sessionStore.markAsRead(tabId)
    focusTerminalInputSoon(tabId)
  }, [])
  const restorePaneCommandInputMode = useCallback(() => {
    if (window.api.platform !== 'win32' || !paneCommandInputModeRestorePendingRef.current) return
    paneCommandInputModeRestorePendingRef.current = false
    window.setTimeout(() => {
      void window.api.window.restoreInputMode().catch(() => {})
    }, 30)
  }, [])
  const ensurePaneCommandEnglishInputMode = useCallback(() => {
    if (window.api.platform !== 'win32') return
    paneCommandInputModeRestorePendingRef.current = false
    window.setTimeout(() => {
      void window.api.window.ensureEnglishInputMode()
        .then((result) => {
          if (!result.switched) return
          if (paneCommandModeRef.current && !paneCommandEditingRef.current) {
            paneCommandInputModeRestorePendingRef.current = true
            return
          }
          void window.api.window.restoreInputMode().catch(() => {})
        })
        .catch(() => {})
    }, 30)
  }, [])
  const enterPaneCommandMode = useCallback(() => {
    paneCommandModeRef.current = true
    paneCommandEditingRef.current = false
    setPaneCommandEditing(false)
    setPaneCommandMode(true)
    focusPaneCommandSink()
    ensurePaneCommandEnglishInputMode()
  }, [ensurePaneCommandEnglishInputMode, focusPaneCommandSink])
  const exitPaneCommandMode = useCallback(() => {
    paneCommandModeRef.current = false
    paneCommandEditingRef.current = false
    paneCommandProjectSwitcherOpenRef.current = false
    setPaneCommandMode(false)
    setPaneCommandEditing(false)
    setPaneCommandNewSessionOpen(false)
    setPaneCommandProjectSwitcherOpen(false)
    setPaneCommandHelpOpen(false)
    setPaneCommandRenameTargetId(null)
    setPaneCommandTabSwitcherOpen(false)
    setPaneCommandJumpOpen(false)
    setPaneCommandInputOpen(false)
    setPaneCommandCloseTarget(null)
    focusPaneCommandActiveTarget()
    restorePaneCommandInputMode()
  }, [focusPaneCommandActiveTarget, restorePaneCommandInputMode])
  const enterPaneCommandEditing = useCallback(() => {
    paneCommandEditingRef.current = true
    setPaneCommandEditing(true)
    focusPaneCommandActiveTarget()
    restorePaneCommandInputMode()
  }, [focusPaneCommandActiveTarget, restorePaneCommandInputMode])
  const exitPaneCommandEditing = useCallback(() => {
    paneCommandEditingRef.current = false
    setPaneCommandEditing(false)
    focusPaneCommandSink()
    ensurePaneCommandEnglishInputMode()
  }, [ensurePaneCommandEnglishInputMode, focusPaneCommandSink])
  const closePaneCommandNewSession = useCallback(() => {
    setPaneCommandNewSessionOpen(false)
    focusPaneCommandSink()
  }, [focusPaneCommandSink])
  const closePaneCommandProjectSwitcher = useCallback(() => {
    paneCommandProjectSwitcherOpenRef.current = false
    setPaneCommandProjectSwitcherOpen(false)
    focusPaneCommandSink()
  }, [focusPaneCommandSink])
  const openPaneCommandProjectSwitcher = useCallback(() => {
    guardPaneCommandPanelOpening()
    paneCommandProjectSwitcherOpenRef.current = true
    setPaneCommandProjectSwitcherOpen(true)
  }, [guardPaneCommandPanelOpening])
  const closePaneCommandHelp = useCallback(() => {
    setPaneCommandHelpOpen(false)
    focusPaneCommandSink()
  }, [focusPaneCommandSink])
  const closePaneCommandRename = useCallback(() => {
    setPaneCommandRenameTargetId(null)
    focusPaneCommandSink()
  }, [focusPaneCommandSink])
  const closePaneCommandTabSwitcher = useCallback(() => {
    setPaneCommandTabSwitcherOpen(false)
    guardPaneCommandPanelReturn()
    focusPaneCommandSink()
  }, [focusPaneCommandSink, guardPaneCommandPanelReturn])
  const closePaneCommandJump = useCallback(() => {
    setPaneCommandJumpOpen(false)
    focusPaneCommandSink()
  }, [focusPaneCommandSink])
  const closePaneCommandInput = useCallback(() => {
    setPaneCommandInputOpen(false)
    focusPaneCommandSink()
  }, [focusPaneCommandSink])
  const openPaneCommandInput = useCallback(() => {
    guardPaneCommandPanelOpening()
    setPaneCommandInputOpen(true)
  }, [guardPaneCommandPanelOpening])
  const switchPaneCommandProjectContext = useCallback((context: PaneCommandProjectContext) => {
    paneCommandProjectSwitcherOpenRef.current = false
    switchProjectContext(context.projectId, null, context.worktreeId)
    setPaneCommandProjectSwitcherOpen(false)
    focusPaneCommandSink()
    window.requestAnimationFrame(refreshPaneCommandRects)
    window.setTimeout(refreshPaneCommandRects, 120)
  }, [focusPaneCommandSink, refreshPaneCommandRects])

  const switchRecentPaneCommandProject = useCallback((offset: -1 | 1) => {
    if (!selectedProjectIdForPaneCommand || paneCommandRecentProjectKeys.length < 2) return
    const currentKey = getPaneCommandProjectContextKey(selectedProjectIdForPaneCommand, effectiveSelectedWorktreeIdForPaneCommand)
    const currentIndex = paneCommandRecentProjectKeys.indexOf(currentKey)
    const baseIndex = currentIndex >= 0 ? currentIndex : 0
    const nextKey = paneCommandRecentProjectKeys[
      (baseIndex + offset + paneCommandRecentProjectKeys.length) % paneCommandRecentProjectKeys.length
    ]
    const context = parsePaneCommandProjectContextKey(nextKey)
    if (context) switchPaneCommandProjectContext(context)
  }, [
    paneCommandRecentProjectKeys,
    effectiveSelectedWorktreeIdForPaneCommand,
    selectedProjectIdForPaneCommand,
    switchPaneCommandProjectContext,
  ])
  const switchPreviousPaneCommandProject = useCallback(() => {
    if (!selectedProjectIdForPaneCommand) return
    const currentKey = getPaneCommandProjectContextKey(selectedProjectIdForPaneCommand, effectiveSelectedWorktreeIdForPaneCommand)
    const previousKey = paneCommandRecentProjectKeys.find((key) => key !== currentKey)
    if (!previousKey) return
    const context = parsePaneCommandProjectContextKey(previousKey)
    if (context) switchPaneCommandProjectContext(context)
  }, [
    paneCommandRecentProjectKeys,
    effectiveSelectedWorktreeIdForPaneCommand,
    selectedProjectIdForPaneCommand,
    switchPaneCommandProjectContext,
  ])
  const activatePaneCommandTab = useCallback((tabId: string) => {
    const paneStore = usePanesStore.getState()
    const paneId = paneStore.findPaneForSession(tabId) ?? paneStore.activePaneId
    paneStore.setActivePaneId(paneId)
    paneStore.setPaneActiveSession(paneId, tabId)
    if (!tabId.startsWith('editor-')) {
      useSessionsStore.getState().setActive(tabId)
      useSessionsStore.getState().markAsRead(tabId)
    }
    setPaneCommandTabSwitcherOpen(false)
    setPaneCommandJumpOpen(false)
    guardPaneCommandPanelReturn()
    focusPaneCommandSink()
    window.requestAnimationFrame(refreshPaneCommandRects)
  }, [focusPaneCommandSink, guardPaneCommandPanelReturn, refreshPaneCommandRects])
  const switchPaneCommandBack = useCallback(() => {
    const paneStore = usePanesStore.getState()
    const { paneId, tabId, tabIds } = getPaneCommandActiveTab()
    const previousTabId = (paneStore.paneRecentSessions[paneId] ?? [])
      .find((id) => id !== tabId && tabIds.includes(id))
    if (previousTabId) {
      activatePaneCommandTab(previousTabId)
      return
    }
    switchRecentPaneCommandProject(-1)
  }, [activatePaneCommandTab, switchRecentPaneCommandProject])
  const moveActivePaneCommandTab = useCallback((direction: 'left' | 'right' | 'up' | 'down') => {
    const paneStore = usePanesStore.getState()
    const { paneId, tabId } = getPaneCommandActiveTab()
    if (!tabId) return
    paneStore.navigatePane(direction)
    const targetPaneId = usePanesStore.getState().activePaneId
    if (targetPaneId === paneId) return
    usePanesStore.getState().moveSession(paneId, targetPaneId, tabId)
    if (!tabId.startsWith('editor-')) useSessionsStore.getState().setActive(tabId)
    window.requestAnimationFrame(refreshPaneCommandRects)
  }, [refreshPaneCommandRects])
  const keepOnlyActivePaneCommandPane = useCallback(() => {
    const paneStore = usePanesStore.getState()
    const { paneId, tabId } = getPaneCommandActiveTab()
    const leafIds = getPaneLeafIds(paneStore.root)
    if (leafIds.length <= 1) return
    const activePaneTabs = paneStore.paneSessions[paneId] ?? []
    const otherTabs = leafIds
      .filter((leafId) => leafId !== paneId)
      .flatMap((leafId) => paneStore.paneSessions[leafId] ?? [])
    paneStore.applyPaneGroups([[...activePaneTabs, ...otherTabs]], tabId)
    window.requestAnimationFrame(refreshPaneCommandRects)
  }, [refreshPaneCommandRects])
  const detachActivePaneCommandTab = useCallback(() => {
    const { paneId, tabId } = getPaneCommandActiveTab()
    if (!tabId) return
    const settings = useUIStore.getState().settings
    const pos = settings.popoutPosition === 'center' ? undefined
      : { x: window.screenX + window.innerWidth / 2, y: window.screenY + window.innerHeight / 2 }
    const size = { width: settings.popoutWidth, height: settings.popoutHeight }
    if (tabId.startsWith('editor-')) {
      const tab = useEditorsStore.getState().tabs.find((item) => item.id === tabId)
      if (!tab) return
      usePanesStore.getState().removeSessionFromPane(paneId, tab.id)
      window.api.detach.create(
        [tab.id],
        tab.fileName,
        [],
        [tab],
        { projectId: tab.projectId, worktreeId: tab.worktreeId ?? null },
        pos,
        size,
      )
      return
    }
    const session = useSessionsStore.getState().sessions.find((item) => item.id === tabId)
    if (!session || session.pinned) return
    const project = useProjectsStore.getState().projects.find((item) => item.id === session.projectId)
    usePanesStore.getState().removeSessionFromPane(paneId, session.id)
    window.api.detach.create(
      [session.id],
      project?.name ?? session.name,
      [session],
      [],
      { projectId: session.projectId, worktreeId: session.worktreeId ?? null },
      pos,
      size,
    )
  }, [])
  const copyPaneCommandPath = useCallback(() => {
    const { tabId } = getPaneCommandActiveTab()
    const projects = useProjectsStore.getState().projects
    const worktrees = useWorktreesStore.getState().worktrees
    let value: string | null = null
    if (tabId?.startsWith('editor-')) {
      value = useEditorsStore.getState().tabs.find((tab) => tab.id === tabId)?.filePath ?? null
    } else if (tabId) {
      const session = useSessionsStore.getState().sessions.find((item) => item.id === tabId)
      if (session) {
        const worktree = session.worktreeId
          ? worktrees.find((item) => item.id === session.worktreeId && item.projectId === session.projectId)
          : undefined
        const project = projects.find((item) => item.id === session.projectId)
        value = session.cwd ?? worktree?.path ?? project?.path ?? null
      }
    }
    if (!value && selectedProjectIdForPaneCommand) {
      const worktree = effectiveSelectedWorktreeIdForPaneCommand
        ? worktrees.find((item) => item.id === effectiveSelectedWorktreeIdForPaneCommand)
        : undefined
      const project = projects.find((item) => item.id === selectedProjectIdForPaneCommand)
      value = worktree?.path ?? project?.path ?? null
    }
    if (!value) return
    void navigator.clipboard.writeText(value)
    useUIStore.getState().addToast({ title: '已复制路径', body: value, type: 'success', duration: 1800 })
  }, [effectiveSelectedWorktreeIdForPaneCommand, selectedProjectIdForPaneCommand])
  const scrollActivePaneCommandTerminalToBottom = useCallback(() => {
    const { tabId } = getPaneCommandActiveTab()
    if (!tabId || tabId.startsWith('editor-')) return
    scrollTerminalToLatest(tabId)
  }, [])
  const selectPaneCommandJumpItem = useCallback((item: PaneCommandJumpItem) => {
    if (item.kind === 'project' || item.kind === 'worktree') {
      switchProjectContext(item.projectId, null, item.worktreeId)
      setPaneCommandJumpOpen(false)
      focusPaneCommandSink()
      return
    }
    if (item.kind === 'session' && item.tabId) {
      switchProjectContext(item.projectId, item.tabId, item.worktreeId)
      setPaneCommandJumpOpen(false)
      focusPaneCommandSink()
      return
    }
    if (item.kind === 'file' && item.filePath) {
      switchProjectContext(item.projectId, null, item.worktreeId)
      const tabId = useEditorsStore.getState().openFile(item.filePath, {
        projectId: item.projectId,
        worktreeId: item.worktreeId,
      })
      const paneStore = usePanesStore.getState()
      paneStore.addSessionToPane(paneStore.activePaneId, tabId)
      paneStore.setPaneActiveSession(paneStore.activePaneId, tabId)
      setPaneCommandJumpOpen(false)
      focusPaneCommandSink()
    }
  }, [focusPaneCommandSink])
  const requestPaneCommandCloseSession = useCallback(() => {
    const paneStore = usePanesStore.getState()
    const sessionStore = useSessionsStore.getState()
    const paneId = paneStore.activePaneId
    const tabIds = paneStore.paneSessions[paneId] ?? []
    const sessionId = paneStore.paneActiveSession[paneId] && tabIds.includes(paneStore.paneActiveSession[paneId]!)
      ? paneStore.paneActiveSession[paneId]
      : (tabIds[0] ?? null)
    if (!sessionId || sessionId.startsWith('editor-')) return
    const session = sessionStore.sessions.find((item) => item.id === sessionId)
    if (!session || session.pinned) return
    setPaneCommandCloseTarget({
      paneId,
      sessionId: session.id,
      sessionName: session.name,
      ptyId: session.ptyId ?? undefined,
    })
  }, [])
  const cancelPaneCommandCloseSession = useCallback(() => {
    setPaneCommandCloseTarget(null)
    focusPaneCommandSink()
  }, [focusPaneCommandSink])
  const confirmPaneCommandCloseSession = useCallback(() => {
    const target = paneCommandCloseTarget
    if (!target) return
    if (target.ptyId) void window.api.session.kill(target.ptyId)
    usePanesStore.getState().removeSessionFromPane(target.paneId, target.sessionId)
    useSessionsStore.getState().removeSession(target.sessionId)
    setPaneCommandCloseTarget(null)
    focusPaneCommandSink()
  }, [focusPaneCommandSink, paneCommandCloseTarget])
  const refreshAfterPaneCommandLayout = useCallback(() => {
    window.requestAnimationFrame(refreshPaneCommandRects)
  }, [refreshPaneCommandRects])
  const runPaneCommand = useCallback((key: string): boolean => {
    const paneStore = usePanesStore.getState()
    const normalized = key.length === 1 ? key.toLowerCase() : key

    if (normalized === 'Escape' || normalized === 'Enter') {
      exitPaneCommandMode()
      return true
    }

    if (normalized === 'i') {
      enterPaneCommandEditing()
      return true
    }

    if (normalized === 'n') {
      guardPaneCommandPanelOpening()
      setPaneCommandNewSessionOpen(true)
      return true
    }

    if (normalized === 'w') {
      requestPaneCommandCloseSession()
      return true
    }

    if (normalized === '?') {
      guardPaneCommandPanelOpening()
      setPaneCommandHelpOpen((current) => !current)
      return true
    }

    if (normalized === ':') {
      openPaneCommandInput()
      return true
    }

    if (normalized === 'r') {
      const { tabId } = getPaneCommandActiveTab()
      if (tabId && !tabId.startsWith('editor-')) {
        guardPaneCommandPanelOpening()
        setPaneCommandRenameTargetId(tabId)
      }
      return true
    }

    if (normalized === 'd') {
      detachActivePaneCommandTab()
      return true
    }

    if (normalized === 'f') {
      guardPaneCommandPanelOpening()
      setPaneCommandTabSwitcherOpen(true)
      return true
    }

    if (normalized === 'b') {
      switchPaneCommandBack()
      refreshAfterPaneCommandLayout()
      return true
    }

    if (normalized === 'g') {
      guardPaneCommandPanelOpening()
      setPaneCommandJumpOpen(true)
      return true
    }

    if (normalized === 'o') {
      keepOnlyActivePaneCommandPane()
      refreshAfterPaneCommandLayout()
      return true
    }

    if (normalized === 'c') {
      copyPaneCommandPath()
      return true
    }

    if (normalized === 'u') {
      scrollActivePaneCommandTerminalToBottom()
      return true
    }

    if (normalized === 'p') {
      openPaneCommandProjectSwitcher()
      return true
    }

    if (normalized === 'Tab') {
      switchPreviousPaneCommandProject()
      return true
    }

    if (normalized === '[' || normalized === ']') {
      switchRecentPaneCommandProject(normalized === '[' ? -1 : 1)
      refreshAfterPaneCommandLayout()
      return true
    }

    if (normalized >= '1' && normalized <= '9') {
      const targetPaneId = getPaneLeafIds(paneStore.root)[Number(normalized) - 1]
      if (targetPaneId) {
        activatePaneAndSession(targetPaneId)
        refreshAfterPaneCommandLayout()
      }
      return true
    }

    const direction = normalized === 'h' || normalized === 'ArrowLeft'
      ? 'left'
      : normalized === 'l' || normalized === 'ArrowRight'
        ? 'right'
        : normalized === 'k' || normalized === 'ArrowUp'
          ? 'up'
          : normalized === 'j' || normalized === 'ArrowDown'
            ? 'down'
            : null
    if (direction) {
      paneStore.navigatePane(direction)
      activatePaneAndSession(usePanesStore.getState().activePaneId)
      refreshAfterPaneCommandLayout()
      return true
    }

    if (normalized === 'z') {
      paneStore.togglePaneFullscreen()
      refreshAfterPaneCommandLayout()
      return true
    }

    if (normalized === 'e') {
      paneStore.balanceSplits()
      refreshAfterPaneCommandLayout()
      return true
    }

    if (normalized === 't') {
      const { tabId } = getPaneCommandActiveTab()
      smartSplitPanesByType(tabId)
      refreshAfterPaneCommandLayout()
      return true
    }

    if (normalized === 'm') {
      paneStore.mergeAllPanes()
      activatePaneAndSession(usePanesStore.getState().activePaneId)
      refreshAfterPaneCommandLayout()
      return true
    }

    if (normalized === 'x') {
      const leafIds = getPaneLeafIds(paneStore.root)
      if (leafIds.length > 1) {
        paneStore.mergePane(paneStore.activePaneId)
        activatePaneAndSession(usePanesStore.getState().activePaneId)
        refreshAfterPaneCommandLayout()
      }
      return true
    }

    if (normalized === 'v' || normalized === 's') {
      const { paneId, tabId, tabIds } = getPaneCommandActiveTab()
      if (tabId && tabIds.length > 1) {
        paneStore.splitPane(paneId, normalized === 'v' ? 'right' : 'down', tabId)
        activatePaneAndSession(usePanesStore.getState().activePaneId)
        refreshAfterPaneCommandLayout()
      }
      return true
    }

    return false
  }, [
    copyPaneCommandPath,
    detachActivePaneCommandTab,
    enterPaneCommandEditing,
    exitPaneCommandMode,
    guardPaneCommandPanelOpening,
    keepOnlyActivePaneCommandPane,
    openPaneCommandInput,
    openPaneCommandProjectSwitcher,
    refreshAfterPaneCommandLayout,
    requestPaneCommandCloseSession,
    switchPaneCommandBack,
    switchPreviousPaneCommandProject,
    switchRecentPaneCommandProject,
    scrollActivePaneCommandTerminalToBottom,
  ])
  const runPaneCommandFromInput = useCallback((key: string) => {
    setPaneCommandInputOpen(false)
    runPaneCommand(key)
  }, [runPaneCommand])
  const paneCommandInputCommands = useMemo<PaneCommandInputCommand[]>(() => [
    {
      id: 'project',
      label: '切换项目',
      detail: '打开项目 / worktree 切换面板',
      aliases: ['p', 'project', 'projects', 'switch project', '项目'],
      run: () => runPaneCommandFromInput('p'),
    },
    {
      id: 'tabs',
      label: '切换标签',
      detail: '搜索当前 pane 内的标签',
      aliases: ['f', 'tab', 'tabs', 'find tab', '标签'],
      run: () => runPaneCommandFromInput('f'),
    },
    {
      id: 'jump',
      label: '跳转',
      detail: '统一搜索项目、worktree、会话和文件',
      aliases: ['g', 'go', 'jump', 'goto', '跳转'],
      run: () => runPaneCommandFromInput('g'),
    },
    {
      id: 'new-session',
      label: '新建会话',
      detail: '在当前 pane 新建会话',
      aliases: ['n', 'new', 'session', 'new session', '新建'],
      run: () => runPaneCommandFromInput('n'),
    },
    {
      id: 'rename',
      label: '重命名当前会话',
      detail: '重命名当前 active session',
      aliases: ['r', 'rename', 'name', '重命名'],
      run: () => runPaneCommandFromInput('r'),
    },
    {
      id: 'detach',
      label: '弹出独立窗口',
      detail: '把当前 tab detach 到独立窗口',
      aliases: ['d', 'detach', 'popout', 'window', '弹出'],
      run: () => runPaneCommandFromInput('d'),
    },
    {
      id: 'close-session',
      label: '关闭当前会话',
      detail: '请求关闭当前 active session',
      aliases: ['w', 'close', 'close session', 'kill', '关闭'],
      run: () => runPaneCommandFromInput('w'),
    },
    {
      id: 'back',
      label: '返回上一个 tab / 项目',
      detail: '优先回到上一个 tab，否则切换最近项目',
      aliases: ['b', 'back', 'previous', 'prev', '返回'],
      run: () => runPaneCommandFromInput('b'),
    },
    {
      id: 'copy-path',
      label: '复制路径',
      detail: '复制当前会话、文件或项目路径',
      aliases: ['c', 'copy', 'copy path', 'path', '复制'],
      run: () => runPaneCommandFromInput('c'),
    },
    {
      id: 'only-pane',
      label: '只保留当前 pane',
      detail: '合并其他 pane 到当前 pane',
      aliases: ['o', 'only', 'only pane', 'keep current', '只保留'],
      run: () => runPaneCommandFromInput('o'),
    },
    {
      id: 'help',
      label: '快捷键帮助',
      detail: '打开 Pane Mode 快捷键帮助',
      aliases: ['?', 'help', 'shortcuts', '帮助'],
      run: () => runPaneCommandFromInput('?'),
    },
    {
      id: 'edit-input',
      label: '回到会话输入',
      detail: '临时把键盘输入交还给当前会话',
      aliases: ['i', 'input', 'edit', 'terminal', '输入'],
      run: () => runPaneCommandFromInput('i'),
    },
    {
      id: 'zoom',
      label: '放大 / 恢复 pane',
      detail: '切换当前 pane 的 fullscreen 状态',
      aliases: ['z', 'zoom', 'fullscreen', '放大'],
      run: () => runPaneCommandFromInput('z'),
    },
    {
      id: 'balance',
      label: '等分布局',
      detail: '平衡当前分屏比例',
      aliases: ['e', 'equal', 'balance', '等分'],
      run: () => runPaneCommandFromInput('e'),
    },
    {
      id: 'smart-split',
      label: '按类型整理分屏',
      detail: '按 tab 类型重新整理 pane',
      aliases: ['t', 'type', 'smart split', 'layout', '整理'],
      run: () => runPaneCommandFromInput('t'),
    },
    {
      id: 'merge-all',
      label: '合并全部 pane',
      detail: '把所有 pane 合并为一个 pane',
      aliases: ['m', 'merge', 'merge all', '合并'],
      run: () => runPaneCommandFromInput('m'),
    },
    {
      id: 'close-pane',
      label: '关闭当前 pane',
      detail: '将当前 pane 合并到相邻 pane',
      aliases: ['x', 'close pane', 'remove pane', '关闭pane'],
      run: () => runPaneCommandFromInput('x'),
    },
    {
      id: 'split-right',
      label: '向右分屏',
      detail: '把当前 tab 拆到右侧 pane',
      aliases: ['v', 'vertical', 'split right', 'right', '右分屏'],
      run: () => runPaneCommandFromInput('v'),
    },
    {
      id: 'split-down',
      label: '向下分屏',
      detail: '把当前 tab 拆到下方 pane',
      aliases: ['s', 'horizontal', 'split down', 'down', '下分屏'],
      run: () => runPaneCommandFromInput('s'),
    },
    {
      id: 'move-tab-left',
      label: '移动 tab 到左侧 pane',
      detail: '等同 Shift+H',
      aliases: ['move left', 'shift h', 'left tab', '左移'],
      run: () => {
        setPaneCommandInputOpen(false)
        moveActivePaneCommandTab('left')
      },
    },
    {
      id: 'move-tab-right',
      label: '移动 tab 到右侧 pane',
      detail: '等同 Shift+L',
      aliases: ['move right', 'shift l', 'right tab', '右移'],
      run: () => {
        setPaneCommandInputOpen(false)
        moveActivePaneCommandTab('right')
      },
    },
    {
      id: 'move-tab-up',
      label: '移动 tab 到上方 pane',
      detail: '等同 Shift+K',
      aliases: ['move up', 'shift k', 'up tab', '上移'],
      run: () => {
        setPaneCommandInputOpen(false)
        moveActivePaneCommandTab('up')
      },
    },
    {
      id: 'move-tab-down',
      label: '移动 tab 到下方 pane',
      detail: '等同 Shift+J',
      aliases: ['move down', 'shift j', 'down tab', '下移'],
      run: () => {
        setPaneCommandInputOpen(false)
        moveActivePaneCommandTab('down')
      },
    },
    {
      id: 'return-pane-mode',
      label: '返回 Pane Mode',
      detail: '关闭命令输入框，保留命令模式',
      aliases: ['return', 'back to pane mode', '返回命令模式'],
      run: closePaneCommandInput,
    },
    {
      id: 'exit-pane-mode',
      label: '退出命令模式',
      detail: '关闭 Pane Mode 并恢复原焦点',
      aliases: ['esc', 'exit', 'quit', '退出'],
      run: () => runPaneCommandFromInput('Escape'),
    },
  ], [
    closePaneCommandInput,
    moveActivePaneCommandTab,
    runPaneCommandFromInput,
  ])

  useEffect(() => {
    if (!selectedProjectIdForPaneCommand) return
    const key = getPaneCommandProjectContextKey(selectedProjectIdForPaneCommand, effectiveSelectedWorktreeIdForPaneCommand)
    setPaneCommandRecentProjectKeys((current) => [key, ...current.filter((item) => item !== key)].slice(0, 12))
  }, [effectiveSelectedWorktreeIdForPaneCommand, selectedProjectIdForPaneCommand])

  // Load config from file on startup
  useEffect(() => {
    let disposed = false

    void (async () => {
      const data = await window.api.config.read()
      const rawProjects = Array.isArray(data.projects) ? data.projects : []
      const sanitizedProjects = rawProjects.filter((project) =>
        !(project && typeof project === 'object' && (project as { id?: unknown }).id === LEGACY_ANONYMOUS_PROJECT_ID),
      )
      const removedLegacyAnonymousProjects = sanitizedProjects.length !== rawProjects.length
      const validProjectIds = new Set(
        sanitizedProjects
          .map((project) => (project && typeof project === 'object' && typeof (project as { id?: unknown }).id === 'string')
            ? (project as { id: string }).id
            : null)
          .filter((id): id is string => id !== null),
      )

      const allRawWorktrees = (data as Record<string, unknown>).worktrees as unknown[] ?? []
      const rawWorktrees = (Array.isArray(allRawWorktrees) ? allRawWorktrees : []).filter((worktree) =>
        worktree
        && typeof worktree === 'object'
        && (worktree as { projectId?: unknown }).projectId !== LEGACY_ANONYMOUS_PROJECT_ID
        && typeof (worktree as { projectId?: unknown }).projectId === 'string'
        && validProjectIds.has((worktree as { projectId: string }).projectId),
      )
      const removedInvalidWorktrees = rawWorktrees.length !== (Array.isArray(allRawWorktrees) ? allRawWorktrees.length : 0)
      const validWorktreeIds = new Set(
        (Array.isArray(rawWorktrees) ? rawWorktrees : [])
          .map((worktree) => (worktree && typeof worktree === 'object' && typeof (worktree as { id?: unknown }).id === 'string')
            ? (worktree as { id: string }).id
            : null)
          .filter((id): id is string => id !== null),
      )

      const rawSessions = Array.isArray(data.sessions) ? data.sessions : []
      const sanitizedSessions = rawSessions.filter((session) => {
        if (!session || typeof session !== 'object') return true
        const projectId = (session as { projectId?: unknown }).projectId
        if (projectId === LEGACY_ANONYMOUS_PROJECT_ID) return false
        if (typeof projectId !== 'string' || !validProjectIds.has(projectId)) return false
        const worktreeId = (session as { worktreeId?: unknown }).worktreeId
        return typeof worktreeId !== 'string' || validWorktreeIds.has(worktreeId)
      })
      const removedInvalidSessions = sanitizedSessions.length !== rawSessions.length
      const rawEditors = Array.isArray((data as Record<string, unknown>).editors)
        ? (data as Record<string, unknown>).editors as unknown[]
        : []
      const { tabs: sanitizedEditors, changed: removedInvalidEditors } = await filterExistingEditorTabs(
        rawEditors,
        sanitizedProjects,
        rawWorktrees,
      )

      if (disposed) return

      useGroupsStore.getState()._loadFromConfig(data.groups)
      useSessionGroupsStore.getState()._loadFromConfig((data as Record<string, unknown>).sessionGroups as unknown[] ?? [])
      useProjectsStore.getState()._loadFromConfig(sanitizedProjects)
      useSessionsStore.getState()._loadFromConfig(sanitizedSessions)
      useEditorsStore.getState()._loadFromConfig(sanitizedEditors)
      useUIStore.getState()._loadSettings(data.ui, (data as Record<string, unknown>).customThemes as Record<string, unknown> | undefined)
      useTemplatesStore.getState()._loadFromConfig((data as Record<string, unknown>).templates as unknown[] ?? [])
      useTasksStore.getState()._loadFromConfig({ activeTasks: (data as Record<string, unknown>).activeTasks as unknown[] ?? [] })
      useInfiniteTasksStore.getState()._loadFromConfig((data as Record<string, unknown>).infiniteTasks as unknown ?? {})
      useWorktreesStore.getState()._loadFromConfig(rawWorktrees)
      useLaunchesStore.getState()._loadFromConfig((data as Record<string, unknown>).launches as unknown[] ?? [])
      useClaudeGuiStore.getState()._loadFromConfig((data as Record<string, unknown>).claudeGui as Record<string, unknown> ?? {})
      useCanvasStore.getState().loadFromConfig((data as Record<string, unknown>).canvas as Record<string, unknown> ?? {})

      const validSessionIds = sanitizedSessions
        .map((session) => (session && typeof session === 'object' && typeof (session as { id?: unknown }).id === 'string')
          ? (session as { id: string }).id
          : null)
        .filter((id): id is string => id !== null)
      const validTabIds = new Set<string>([...validSessionIds, ...sanitizedEditors.map((tab) => tab.id)])
      const { panes: sanitizedPanes, changed: removedInvalidPaneTabs } = sanitizePanesConfig(data.panes, validTabIds)

      // Restore pane layout if saved
      if (!removedInvalidSessions && sanitizedPanes) {
        usePanesStore.getState().loadFromConfig(sanitizedPanes)
      }

      if (removedInvalidEditors) {
        window.api.config.write('editors', sanitizedEditors)
      }

      if (removedInvalidSessions) {
        window.api.config.write('sessions', sanitizedSessions)
        window.api.config.write('panes', {})
      } else if (removedInvalidPaneTabs && sanitizedPanes) {
        window.api.config.write('panes', sanitizedPanes)
      }
      if (removedLegacyAnonymousProjects) {
        window.api.config.write('projects', sanitizedProjects)
      }
      if (removedInvalidWorktrees) {
        window.api.config.write('worktrees', rawWorktrees)
      }

      // Restore the last visible context from the saved pane layout instead of
      // defaulting to the first session in the flat session list.
      const paneStore = usePanesStore.getState()
      const sessionStore = useSessionsStore.getState()
      const editorStore = useEditorsStore.getState()
      const projectStore = useProjectsStore.getState()
      const worktreeStore = useWorktreesStore.getState()

      const restoreCandidates = [
        paneStore.paneActiveSession[paneStore.activePaneId] ?? null,
        ...(paneStore.paneSessions[paneStore.activePaneId] ?? []),
        ...Object.values(paneStore.paneSessions).flat(),
        sessionStore.activeSessionId,
      ].filter((id): id is string => typeof id === 'string')

      const restoredSession = restoreCandidates
        .map((sessionId) => sessionStore.sessions.find((session) => session.id === sessionId))
        .find((session): session is NonNullable<typeof sessionStore.sessions[number]> => Boolean(session))
      const restoredEditor = restoreCandidates
        .map((tabId) => editorStore.tabs.find((tab) => tab.id === tabId))
        .find((tab): tab is NonNullable<typeof editorStore.tabs[number]> => Boolean(tab))

      if (restoredSession) {
        projectStore.selectProject(restoredSession.projectId)
        worktreeStore.selectWorktree(
          restoredSession.worktreeId
          ?? worktreeStore.getMainWorktree(restoredSession.projectId)?.id
          ?? null,
        )
        sessionStore.setActive(restoredSession.id)

        const paneId = paneStore.findPaneForSession(restoredSession.id)
        if (paneId) {
          paneStore.setActivePaneId(paneId)
          paneStore.setPaneActiveSession(paneId, restoredSession.id)
        }
      } else if (restoredEditor) {
        projectStore.selectProject(restoredEditor.projectId)
        worktreeStore.selectWorktree(
          restoredEditor.worktreeId
          ?? worktreeStore.getMainWorktree(restoredEditor.projectId)?.id
          ?? null,
        )

        const paneId = paneStore.findPaneForSession(restoredEditor.id)
        if (paneId) {
          paneStore.setActivePaneId(paneId)
          paneStore.setPaneActiveSession(paneId, restoredEditor.id)
        }
      }

      setReady(true)
    })()

    return () => {
      disposed = true
    }
  }, [])

  useActivityMonitor()
  const activePaneTabId = usePanesStore((s) => s.paneActiveSession[s.activePaneId] ?? null)

  useEffect(() => {
    const sessionStore = useSessionsStore.getState()

    if (!activePaneTabId || activePaneTabId.startsWith('editor-')) {
      if (sessionStore.activeSessionId !== null) {
        sessionStore.setActive(null)
      }
      return
    }

    if (sessionStore.activeSessionId !== activePaneTabId) {
      sessionStore.setActive(activePaneTabId)
    }
    sessionStore.markAsRead(activePaneTabId)
  }, [activePaneTabId])

  useEffect(() => {
    const pendingEditedFiles = new Map<string, string[]>()
    const unsubscribe = window.api.claudeGui.onEvent((event) => {
      useClaudeGuiStore.getState().applyEvent(event)

      if (event.type === 'tool-use' && event.toolUseId && isClaudeGuiFileMutatingTool(event.toolName)) {
        const filePaths = Array.from(new Set(collectFilePaths(event.rawInput)))
        const conversation = useClaudeGuiStore.getState().conversations.find((item) => item.id === event.conversationId)
        if (conversation && filePaths.length > 0) {
          void Promise.all(
            filePaths.map(async (filePath) => {
              try {
                const beforeContent = await window.api.fs.readFile(filePath)
                return {
                  filePath,
                  relativePath: toRelativePath(filePath, conversation.cwd),
                  fileName: filePath.split(/[\\/]/).pop() ?? filePath,
                  language: detectLanguage(filePath.split(/[\\/]/).pop() ?? filePath),
                  beforeContent,
                }
              } catch {
                return null
              }
            }),
          ).then((files) => {
            const snapshotFiles = files.filter((item): item is NonNullable<typeof item> => item !== null)
            if (snapshotFiles.length === 0) return
            useClaudeGuiStore.getState().capturePatchSnapshot({
              conversationId: event.conversationId,
              requestId: event.requestId,
              toolUseId: event.toolUseId,
              toolName: event.toolName,
              createdAt: Date.now(),
              files: snapshotFiles,
            })
          })
        }
      }

      if (event.type === 'tool-result' && event.toolUseId) {
        const toolUseId = event.toolUseId
        const snapshot = useClaudeGuiStore.getState().pendingPatchSnapshots[event.toolUseId]
        if (snapshot) {
          void Promise.all(
            snapshot.files.map(async (file) => {
              try {
                const afterContent = await window.api.fs.readFile(file.filePath)
                return {
                  filePath: file.filePath,
                  afterContent,
                }
              } catch {
                return null
              }
            }),
          ).then((files) => {
            useClaudeGuiStore.getState().finalizePatchSnapshot({
              conversationId: event.conversationId,
              requestId: event.requestId,
              toolUseId,
              isError: event.isError === true,
              files: files.filter((item): item is NonNullable<typeof item> => item !== null),
            })
          })
        }
      }

      const editedFiles = extractClaudeGuiEditedFiles(event, pendingEditedFiles)
      for (const filePath of editedFiles) {
        window.dispatchEvent(new CustomEvent('fastagents:file-saved', {
          detail: { filePath },
        }))
      }
    })

    return () => {
      unsubscribe()
    }
  }, [])

  // Listen for Claude Code status-line updates (model, context, cost)
  useEffect(() => {
    const unsubscribe = window.api.session.onStatusUpdate((data) => {
      if (!data.sessionId) return
      updateAgentStatus(data.sessionId, {
        model: typeof data.model === 'string' ? data.model : null,
        contextWindow: data.contextWindow && typeof data.contextWindow === 'object'
          ? data.contextWindow as { used: number; total: number; percentage: number }
          : null,
        cost: data.cost && typeof data.cost === 'object'
          ? data.cost as { total: string; session: string }
          : null,
        workspace: data.workspace && typeof data.workspace === 'object'
          ? data.workspace as { current_dir: string }
          : null,
      })
    })

    return () => {
      unsubscribe()
    }
  }, [])

  // Keep session runtime state correct even when the owning TerminalView is
  // unmounted (for example during project/worktree switches).
  useEffect(() => {
    const unsubscribe = window.api.session.onExit((event) => {
      const sessionStore = useSessionsStore.getState()
      const session = sessionStore.sessions.find((item) => item.ptyId === event.ptyId)
      if (!session) return
      sessionStore.updateSession(session.id, {
        ptyId: null,
        ...(isClaudeCodeType(session.type) && typeof event.resumeUUID === 'string' && event.resumeUUID
          ? { resumeUUID: event.resumeUUID }
          : {}),
      })
      sessionStore.updateStatus(session.id, 'stopped')
    })

    return () => {
      unsubscribe()
    }
  }, [])

  useEffect(() => {
    const unsubscribe = window.api.session.onResumeUUIDs((uuids) => {
      const sessionStore = useSessionsStore.getState()
      for (const [sessionId, resumeUUID] of Object.entries(uuids)) {
        if (!resumeUUID) continue
        const session = sessionStore.sessions.find((item) => item.id === sessionId)
        if (!session || session.resumeUUID === resumeUUID) continue
        if (!isClaudeCodeType(session.type)) continue
        sessionStore.updateSession(sessionId, { resumeUUID })
      }
    })

    return () => {
      unsubscribe()
    }
  }, [])

  // Pragma Desk MCP bridge: handle list-sessions and create-session requests
  // coming from the orchestrator HTTP server (Meta-Agent tools).
  useMcpBridge()

  // Focus a specific session (navigate project + pane + tab)
  const focusSession = useCallback((sessionId: string) => {
    focusSessionTarget(sessionId)
  }, [])

  // Listen for session focus requests (from notification click)
  useEffect(() => {
    const unsubscribe = window.api.session.onFocus((event) => focusSession(event.sessionId))
    return () => {
      unsubscribe()
    }
  }, [focusSession])

  // Listen for overlay actions (e.g., "Jump to session" clicked in overlay)
  useEffect(() => {
    const unsubscribe = window.api.overlay.onAction((raw) => {
      const action = raw as { type: string; sessionId?: string; projectId?: string }
      if (action.type === 'jump' && action.sessionId) {
        focusSession(action.sessionId)
      }
    })

    return () => {
      unsubscribe()
    }
  }, [focusSession])

  // Listen for agent activity events — drive SessionTab status indicator
  useEffect(() => {
    const completionTimers = new Map<string, ReturnType<typeof setTimeout>>()
    const unsubscribe = window.api.session.onActivityStatus((event) => {
      const { setActivity, clearActivity } = useSessionsStore.getState()
      const sessionExists = useSessionsStore.getState().sessions.some((session) => session.id === event.sessionId)
      if (!sessionExists) return
      setActivity(event.sessionId, {
        status: event.activity,
        source: event.source,
        ts: event.ts,
      })

      const existingTimer = completionTimers.get(event.sessionId)
      if (existingTimer) {
        clearTimeout(existingTimer)
        completionTimers.delete(event.sessionId)
      }

      if (event.activity === 'completed') {
        // Decay the highlighted completed state back to idle after ~10s
        const timer = setTimeout(() => {
          const current = useSessionsStore.getState().activityStates[event.sessionId]
          if (current?.status === 'completed' && current.ts === event.ts) {
            setActivity(event.sessionId, { status: 'idle', source: event.source, ts: Date.now() })
          }
          completionTimers.delete(event.sessionId)
        }, 10000)
        completionTimers.set(event.sessionId, timer)
      }

      // When session is removed elsewhere we don't know; clearActivity is a safety net
      void clearActivity
    })

    return () => {
      unsubscribe()
      for (const timer of completionTimers.values()) clearTimeout(timer)
      completionTimers.clear()
    }
  }, [])

  // Listen for agent Stop hooks — show completion toast
  useEffect(() => {
    const unsubscribe = window.api.session.onIdleToast((event) => {
      // HookServer only forwards Stop events for sessions launched by this app.
      const session = event.sessionId
        ? useSessionsStore.getState().sessions.find((s) => s.id === event.sessionId)
        : undefined
      const name = session?.name ?? 'Agent'
      const project = session
        ? useProjectsStore.getState().projects.find((p) => p.id === session.projectId)
        : undefined
      const body = project ? `${project.name}\n${name}` : name
      const { notificationToastEnabled, notificationToastDurationMs, notificationSoundEnabled, notificationSoundVolume } =
        useUIStore.getState().settings
      if (notificationToastEnabled) {
        useUIStore.getState().addToast({
          title: 'Task completed',
          body,
          type: 'success',
          sessionId: session?.id,
          projectId: session?.projectId,
          duration: notificationToastDurationMs,
        })
      }
      if (notificationSoundEnabled) {
        playTaskCompleteSound(notificationSoundVolume)
      }
    })

    return () => {
      unsubscribe()
    }
  }, [])

  // Listen for detached window close — re-attach tabs to their original project
  useEffect(() => {
    const unsubscribe = window.api.detach.onClosed(({ tabIds, sessions: detachedSessions, editors: detachedEditorsRaw, projectId, worktreeId }) => {
      if (tabIds.length === 0) return
      const detachedEditors = detachedEditorsRaw
        .map((editor) => sanitizeEditorTab(editor))
        .filter((editor): editor is EditorTab => editor !== null)
      useSessionsStore.getState().upsertSessions(detachedSessions)
      useEditorsStore.getState().upsertTabs(detachedEditors)
      const sessStore = useSessionsStore.getState()
      const editorStore = useEditorsStore.getState()
      const paneStore = usePanesStore.getState()
      const projectsStore = useProjectsStore.getState()
      const firstSession = detachedSessions.find((session) => tabIds.includes(session.id))
        ?? sessStore.sessions.find((session) => tabIds.includes(session.id))
      const firstEditor = detachedEditors.find((editor) => tabIds.includes(editor.id))
        ?? editorStore.tabs.find((editor) => tabIds.includes(editor.id))
      const targetProjectId = projectId ?? firstSession?.projectId ?? firstEditor?.projectId ?? null
      const targetWorktreeId = worktreeId ?? firstSession?.worktreeId ?? firstEditor?.worktreeId ?? null

      if (!targetProjectId) return

      const selectedWorktreeId = useWorktreesStore.getState().selectedWorktreeId
      const needsContextSwitch = projectsStore.selectedProjectId !== targetProjectId
        || (targetWorktreeId ?? null) !== (selectedWorktreeId ?? null)

      if (needsContextSwitch) {
        switchProjectContext(targetProjectId, tabIds[0] ?? null, targetWorktreeId)
      }

      // Always ensure returning tabs are in the active pane
      const fresh = usePanesStore.getState()
      const findLeaf = (node: { type: string; id: string; first?: unknown }): string =>
        node.type === 'leaf' ? node.id : findLeaf(node.first as typeof node)
      const paneId = findLeaf(fresh.root)
      for (const tabId of tabIds) {
        usePanesStore.getState().addSessionToPane(paneId, tabId)
      }
      usePanesStore.getState().setPaneActiveSession(paneId, tabIds[0] ?? null)
      if (tabIds[0] && !tabIds[0].startsWith('editor-')) {
        useSessionsStore.getState().setActive(tabIds[0])
      }
    })

    return () => {
      unsubscribe()
    }
  }, [])

  // Capture F11 before focused terminals/editors consume it.
  useEffect(() => {
    const handleF11 = (e: KeyboardEvent): void => {
      if (e.key !== 'F11') return
      e.preventDefault()
      e.stopPropagation()
      void toggleCurrentSessionFullscreen()
    }

    window.addEventListener('keydown', handleF11, true)
    return () => window.removeEventListener('keydown', handleF11, true)
  }, [])

  // Capture Alt+1~9 before terminals/editors consume it.
  useEffect(() => {
    const handlePaneNumberShortcut = (e: KeyboardEvent): void => {
      if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || e.key < '1' || e.key > '9') return
      if (useUIStore.getState().settings.workspaceLayout === 'canvas') return

      const paneStore = usePanesStore.getState()
      const paneId = getPaneLeafIds(paneStore.root)[Number(e.key) - 1]
      if (!paneId) return

      e.preventDefault()
      e.stopPropagation()
      paneStore.setActivePaneId(paneId)

      const targetPaneSessions = paneStore.paneSessions[paneId] ?? []
      const activeTabId = paneStore.paneActiveSession[paneId] && targetPaneSessions.includes(paneStore.paneActiveSession[paneId]!)
        ? paneStore.paneActiveSession[paneId]
        : (targetPaneSessions[0] ?? null)
      if (activeTabId && !activeTabId.startsWith('editor-')) {
        useSessionsStore.getState().setActive(activeTabId)
      }
    }

    window.addEventListener('keydown', handlePaneNumberShortcut, true)
    return () => window.removeEventListener('keydown', handlePaneNumberShortcut, true)
  }, [])

  useEffect(() => {
    if (!paneCommandMode) {
      setPaneCommandEditing(false)
      paneCommandProjectSwitcherOpenRef.current = false
      setPaneCommandProjectSwitcherOpen(false)
      setPaneCommandHelpOpen(false)
      setPaneCommandRenameTargetId(null)
      setPaneCommandTabSwitcherOpen(false)
      setPaneCommandJumpOpen(false)
      setPaneCommandInputOpen(false)
      setPaneCommandRects([])
      return
    }

    let frame: number | null = null
    const timeouts: number[] = []
    const scheduleRefresh = (): void => {
      if (frame !== null) window.cancelAnimationFrame(frame)
      frame = window.requestAnimationFrame(() => {
        frame = null
        refreshPaneCommandRects()
      })
    }

    scheduleRefresh()
    for (const delay of [80, 180, 320]) {
      timeouts.push(window.setTimeout(scheduleRefresh, delay))
    }

    const resizeObserver = new ResizeObserver(scheduleRefresh)
    document.querySelectorAll<HTMLElement>('.app-main-frame, .pane-surface').forEach((element) => {
      resizeObserver.observe(element)
    })
    window.addEventListener('resize', scheduleRefresh)
    return () => {
      window.removeEventListener('resize', scheduleRefresh)
      resizeObserver.disconnect()
      if (frame !== null) window.cancelAnimationFrame(frame)
      for (const timeout of timeouts) window.clearTimeout(timeout)
    }
  }, [paneCommandMode, refreshPaneCommandRects])

  useEffect(() => {
    if (!paneCommandMode) return
    const frame = window.requestAnimationFrame(refreshPaneCommandRects)
    return () => window.cancelAnimationFrame(frame)
  }, [paneCommandMode, paneCommandRoot, refreshPaneCommandRects])

  useEffect(() => {
    if (paneCommandMode && !paneCommandEditing) focusPaneCommandSink()
  }, [focusPaneCommandSink, paneCommandEditing, paneCommandMode])

  // Alt+F enters a tmux-style pane command mode. While active, single keys
  // operate on panes before terminal/editor content can consume them.
  useEffect(() => {
    let pendingFrame: number | null = null

    const refreshAfterLayout = (): void => {
      if (pendingFrame !== null) window.cancelAnimationFrame(pendingFrame)
      pendingFrame = window.requestAnimationFrame(() => {
        pendingFrame = null
        refreshPaneCommandRects()
      })
    }

    const handlePaneCommandMode = (e: KeyboardEvent): void => {
      const isPrefix = e.altKey
        && !e.ctrlKey
        && !e.metaKey
        && !e.shiftKey
        && (e.key.toLowerCase() === 'f' || e.code === 'KeyF')
      const ui = useUIStore.getState()

      if (isPrefix) {
        if (ui.settings.workspaceLayout === 'canvas' || ui.settingsOpen) return
        e.preventDefault()
        e.stopPropagation()
        if (paneCommandModeRef.current) {
          exitPaneCommandMode()
        } else {
          enterPaneCommandMode()
        }
        refreshAfterLayout()
        return
      }

      if (!paneCommandModeRef.current) return

      if (
        Date.now() < paneCommandPanelOpeningUntilRef.current
        && e.key === 'Enter'
      ) {
        e.preventDefault()
        e.stopPropagation()
        e.stopImmediatePropagation()
        return
      }

      if (paneCommandCloseTarget) {
        e.preventDefault()
        e.stopPropagation()
        if (e.key === 'Enter') {
          confirmPaneCommandCloseSession()
        } else if (e.key === 'Escape') {
          cancelPaneCommandCloseSession()
        }
        return
      }

      if (paneCommandHelpOpen) {
        e.preventDefault()
        e.stopPropagation()
        if (e.key === 'Escape' || e.key === '?') closePaneCommandHelp()
        return
      }

      if (
        paneCommandNewSessionOpen
        || paneCommandProjectSwitcherOpenRef.current
        || paneCommandRenameTargetId
        || paneCommandTabSwitcherOpen
        || paneCommandJumpOpen
        || paneCommandInputOpen
        || ui.sessionNamePrompt
      ) return

      if (paneCommandEditing) {
        if (e.key === 'Escape') {
          e.preventDefault()
          e.stopPropagation()
          exitPaneCommandEditing()
        }
        return
      }

      e.preventDefault()
      e.stopPropagation()
      if (e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
        const key = e.key.length === 1 ? e.key.toLowerCase() : e.key
        const direction = key === 'ArrowLeft' || key === 'h'
          ? 'left'
          : key === 'ArrowRight' || key === 'l'
            ? 'right'
            : key === 'ArrowUp' || key === 'k'
              ? 'up'
              : key === 'ArrowDown' || key === 'j'
                ? 'down'
                : null
        if (direction) {
          usePanesStore.getState().resizeActivePane(direction)
          refreshAfterLayout()
          return
        }
      }
      if (e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const key = e.key.length === 1 ? e.key.toLowerCase() : e.key
        const direction = key === 'h'
          ? 'left'
          : key === 'l'
            ? 'right'
            : key === 'k'
              ? 'up'
              : key === 'j'
                ? 'down'
                : null
        if (direction) {
          moveActivePaneCommandTab(direction)
          return
        }
      }
      if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
        const key = e.key.length === 1 ? e.key.toLowerCase() : e.key
        const offset = key === 'ArrowLeft' || key === 'h'
          ? -1
          : key === 'ArrowRight' || key === 'l'
            ? 1
            : null
        if (offset !== null) {
          switchActivePaneTab(offset)
          return
        }
      }
      runPaneCommand(e.key)
    }

    window.addEventListener('keydown', handlePaneCommandMode, true)
    return () => {
      window.removeEventListener('keydown', handlePaneCommandMode, true)
      if (pendingFrame !== null) window.cancelAnimationFrame(pendingFrame)
    }
  }, [
    cancelPaneCommandCloseSession,
    closePaneCommandHelp,
    closePaneCommandProjectSwitcher,
    copyPaneCommandPath,
    confirmPaneCommandCloseSession,
    detachActivePaneCommandTab,
    enterPaneCommandEditing,
    enterPaneCommandMode,
    exitPaneCommandEditing,
    exitPaneCommandMode,
    guardPaneCommandPanelOpening,
    keepOnlyActivePaneCommandPane,
    moveActivePaneCommandTab,
    openPaneCommandProjectSwitcher,
    paneCommandCloseTarget,
    paneCommandHelpOpen,
    paneCommandInputOpen,
    paneCommandJumpOpen,
    paneCommandNewSessionOpen,
    paneCommandProjectSwitcherOpen,
    paneCommandRenameTargetId,
    paneCommandTabSwitcherOpen,
    paneCommandEditing,
    paneCommandMode,
    requestPaneCommandCloseSession,
    refreshPaneCommandRects,
    runPaneCommand,
    switchPaneCommandBack,
    switchRecentPaneCommandProject,
  ])

  useEffect(() => {
    const handlePaneTabSwitch = (e: KeyboardEvent): void => {
      if (paneCommandMode) return
      if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return
      if (useUIStore.getState().settings.workspaceLayout === 'canvas' || useUIStore.getState().settingsOpen) return
      if (isPlainTextEditingTarget(e.target)) return

      const key = e.key.length === 1 ? e.key.toLowerCase() : e.key
      const offset = key === 'ArrowLeft' || key === 'h'
        ? -1
        : key === 'ArrowRight' || key === 'l'
          ? 1
          : null
      if (offset === null) return
      if (!switchActivePaneTab(offset)) return

      e.preventDefault()
      e.stopPropagation()
    }

    window.addEventListener('keydown', handlePaneTabSwitch, true)
    return () => window.removeEventListener('keydown', handlePaneTabSwitch, true)
  }, [paneCommandMode])

  // Global keyboard shortcuts — operate on the active pane
  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      const sessStore = useSessionsStore.getState()
      const paneStore = usePanesStore.getState()
      const activePaneId = paneStore.activePaneId
      const paneSessions = paneStore.paneSessions[activePaneId] ?? []
      const activeSessionId = paneStore.paneActiveSession[activePaneId] ?? null

      // Ctrl+Shift+T — restore last closed
      if (e.ctrlKey && e.shiftKey && e.key === 'T') {
        e.preventDefault()
        sessStore.restoreLastClosed()
        // Add restored session to active pane
        const restored = useSessionsStore.getState()
        const newest = restored.sessions[restored.sessions.length - 1]
        if (newest) paneStore.addSessionToPane(activePaneId, newest.id)
        return
      }

      // Ctrl+M — toggle workspace layout (panes ⇄ canvas)
      if (e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey && (e.key === 'M' || e.key === 'm')) {
        e.preventDefault()
        const ui = useUIStore.getState()
        const next = ui.settings.workspaceLayout === 'canvas' ? 'panes' : 'canvas'
        ui.updateSettings({ workspaceLayout: next })
        return
      }

      // Ctrl+W — close active tab in active pane
      if (e.ctrlKey && e.key === 'w') {
        e.preventDefault()
        if (activeSessionId) {
          if (activeSessionId.startsWith('editor-')) {
            const editorTab = useEditorsStore.getState().getTab(activeSessionId)
            if (editorTab?.modified) return
            paneStore.removeSessionFromPane(activePaneId, activeSessionId)
            useEditorsStore.getState().closeTab(activeSessionId)
            return
          }
          const session = sessStore.sessions.find((s) => s.id === activeSessionId)
          if (session?.pinned) return
          if (session?.ptyId) window.api.session.kill(session.ptyId)
          paneStore.removeSessionFromPane(activePaneId, activeSessionId)
          sessStore.removeSession(activeSessionId)
        }
        return
      }

      // Ctrl+Alt+Arrow — navigate between panes
      if (e.ctrlKey && e.altKey && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
        e.preventDefault()
        const dir = e.key === 'ArrowLeft' ? 'left' : e.key === 'ArrowRight' ? 'right' : e.key === 'ArrowUp' ? 'up' : 'down'
        paneStore.navigatePane(dir)
        return
      }

      // Ctrl+1~9 — jump to Nth tab in active pane
      if (e.ctrlKey && e.key >= '1' && e.key <= '9') {
        e.preventDefault()
        const idx = Number(e.key) - 1
        if (idx < paneSessions.length) {
          paneStore.setPaneActiveSession(activePaneId, paneSessions[idx])
        }
        return
      }
    }

    window.addEventListener('keydown', handler, true)
    return () => window.removeEventListener('keydown', handler, true)
  }, [])

  useEffect(() => {
    window.api.window.isFullscreen().then((fullscreen) => {
      useUIStore.getState().setWindowFullscreen(fullscreen)
    }).catch(() => {})
  }, [])

  const windowFullscreen = useUIStore((s) => s.windowFullscreen)
  const focusMode = useUIStore((s) => s.focusMode)
  const hideLeftPanel = useUIStore((s) => s.hideLeftPanel)
  const hideRightPanel = useUIStore((s) => s.hideRightPanel)
  const hideStatusBar = useUIStore((s) => s.hideStatusBar)
  const hideTitleBar = useUIStore((s) => s.hideTitleBar)
  const settingsOpen = useUIStore((s) => s.settingsOpen)

  if (!ready) {
    return (
      <div className="flex h-full items-center justify-center bg-[var(--color-bg-primary)]">
        <div className="text-xs text-[var(--color-text-tertiary)]">Loading...</div>
      </div>
    )
  }

  // Native fullscreen and focus mode share the same app-chrome hiding path.
  // Focus mode keeps the OS taskbar visible because it does not enter
  // Electron fullscreen.
  const hideChrome = windowFullscreen || focusMode
  const isMac = window.api.platform === 'darwin'
  const showPaneCommandPaneNumbers = paneCommandMode && !settingsOpen && getPaneLeafIds(paneCommandRoot).length > 1

  return (
    <div className={cn(
      'flex h-full flex-col bg-[var(--color-titlebar-bg)]',
      isMac && !hideChrome && 'pt-7',
      appChromeStyle === 'joined' ? 'app-shell-joined' : 'app-shell-floating',
      showPaneCommandPaneNumbers && 'pane-command-mode',
    )}>
      {!windowFullscreen && <TitleBar />}
      <div className={cn(
        'app-content-shell flex flex-1 overflow-hidden',
        !hideChrome && 'gap-[var(--layout-gap)] p-[var(--layout-gap)]',
        !hideChrome && hideTitleBar && 'pt-[var(--layout-gap)]',
      )}>
        {!hideChrome && !hideLeftPanel && <LeftPanel />}

        {/* Main panel */}
        <div className={cn(
          'app-main-frame flex-1 overflow-hidden',
          !hideChrome && 'rounded-[var(--radius-panel)]',
        )}>
          <MainPanel />
        </div>

        {/* Right panel */}
        {!hideChrome && !hideRightPanel && <RightPanel />}
      </div>

      {/* Status bar */}
      {!hideChrome && !hideStatusBar && (
        <div className="app-status-shell px-[var(--layout-gap)] pb-[var(--layout-gap)]">
          <StatusBar />
        </div>
      )}

      {paneCommandMode && (
        <>
          <div
            ref={paneCommandFocusRef}
            tabIndex={-1}
            className="fixed left-0 top-0 z-[9399] h-px w-px opacity-0 outline-none"
          />
          <PaneCommandOverlay
            rects={showPaneCommandPaneNumbers ? paneCommandRects : []}
            activePaneId={paneCommandActivePaneId}
            editing={paneCommandEditing}
          />
          {paneCommandNewSessionOpen && (
            <PaneCommandNewSessionDialog
              onClose={closePaneCommandNewSession}
              onAfterNamePromptClose={focusPaneCommandSink}
            />
          )}
          {paneCommandProjectSwitcherOpen && (
            <PaneCommandProjectSwitcher
              recentKeys={paneCommandRecentProjectKeys}
              onBack={closePaneCommandProjectSwitcher}
              onSelect={switchPaneCommandProjectContext}
            />
          )}
          {paneCommandHelpOpen && (
            <PaneCommandHelpPanel onClose={closePaneCommandHelp} />
          )}
          {paneCommandRenameTargetId && (
            <PaneCommandRenameDialog
              tabId={paneCommandRenameTargetId}
              onBack={closePaneCommandRename}
              onRenamed={closePaneCommandRename}
            />
          )}
          {paneCommandTabSwitcherOpen && (
            <PaneCommandTabSwitcher
              onBack={closePaneCommandTabSwitcher}
              onSelect={activatePaneCommandTab}
            />
          )}
          {paneCommandJumpOpen && (
            <PaneCommandJumpMenu
              onBack={closePaneCommandJump}
              onSelect={selectPaneCommandJumpItem}
            />
          )}
          {paneCommandInputOpen && (
            <PaneCommandInputDialog
              commands={paneCommandInputCommands}
              onBack={closePaneCommandInput}
            />
          )}
          {paneCommandCloseTarget && (
            <ConfirmDialog
              title="关闭会话"
              message={`确认关闭 "${paneCommandCloseTarget.sessionName}" 吗？`}
              confirmLabel="关闭"
              danger
              onConfirm={confirmPaneCommandCloseSession}
              onCancel={cancelPaneCommandCloseSession}
            />
          )}
        </>
      )}

      {/* Settings dialog */}
      <SettingsDialog />

      {/* Quick switcher */}
      <QuickSwitcher />

      {/* Permission dialogs */}
      <PermissionDialog />

      {/* Auto-updater dialog */}
      <UpdateDialog />

      {/* Toast notifications */}
      <ToastContainer />

      {/* Session name prompt */}
      <SessionNamePromptDialog />
    </div>
  )
}
