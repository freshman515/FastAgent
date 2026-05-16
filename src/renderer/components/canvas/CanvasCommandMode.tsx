import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type RefObject, type SetStateAction } from 'react'
import { SESSION_TYPE_CONFIG, type CanvasCard } from '@shared/types'
import { createSessionWithPrompt } from '@/lib/createSession'
import { getDefaultWorktreeIdForProject, switchProjectContext } from '@/lib/project-context'
import { focusTerminalInputSoon, scrollTerminalToLatest } from '@/hooks/useXterm'
import { cn } from '@/lib/utils'
import { formatSessionCardTitle } from '@/lib/canvasSessionLabel'
import { buildNewSessionOptions, type NewSessionOption } from '@/components/session/NewSessionMenu'
import { SessionIconView } from '@/components/session/SessionIconView'
import { focusOpenEditorSoon } from '@/components/session/EditorView'
import { useGroupsStore } from '@/stores/groups'
import { usePanesStore } from '@/stores/panes'
import { useProjectsStore } from '@/stores/projects'
import { useSessionsStore } from '@/stores/sessions'
import { useEditorsStore } from '@/stores/editors'
import { useWorktreesStore } from '@/stores/worktrees'
import { getDefaultCanvasCardSize, isCanvasCardHidden, useCanvasStore } from '@/stores/canvas'
import { useCanvasUiStore } from '@/stores/canvasUi'
import { useUIStore, type CanvasArrangeMode } from '@/stores/ui'
import { addCanvasCardToSpace } from './canvasSpaceMembership'
import { getSmartNewCardPlacement } from './canvasSmartPlacement'
import { focusCanvasCardInDirection } from './hooks/useCanvasKeyboard'

type CanvasNavigationKey = 'h' | 'j' | 'k' | 'l' | 'ArrowLeft' | 'ArrowDown' | 'ArrowUp' | 'ArrowRight'

interface CanvasCommandProjectContext {
  projectId: string
  worktreeId: string | null
}

interface CanvasCommandModeController {
  active: boolean
  enter: () => void
  exit: () => void
  layer: JSX.Element | null
}

interface CanvasCommandModeOptions {
  viewportRef: RefObject<HTMLDivElement | null>
  searchOpen: boolean
  onRenameFrame: (cardId: string) => void
  onCreateFrame: () => void
}

interface CanvasCommandInputCommand {
  id: string
  label: string
  detail: string
  aliases: string[]
  run: () => void
}

const CANVAS_COMMAND_SHORTCUTS: Array<{ key: string; label: string }> = [
  { key: 'h/j/k/l', label: '按空间方向聚焦卡片' },
  { key: '1-9', label: '跳转画布书签' },
  { key: 'a', label: '适配所有内容' },
  { key: 'f', label: '切换会话' },
  { key: 'p', label: '切换项目' },
  { key: 'Tab', label: '上一个项目' },
  { key: 'n', label: '新建会话' },
  { key: 't', label: '新建便签' },
  { key: 's', label: '新建空间' },
  { key: 'b', label: '保存书签' },
  { key: 'g', label: '网格整理' },
  { key: 'c', label: '连接两个选中卡片' },
  { key: 'd', label: '克隆选中卡片' },
  { key: 'x', label: '移除选中卡片' },
  { key: 'z', label: '最大化/还原选中卡片' },
  { key: 'o', label: '进入/退出空间' },
  { key: 'r', label: '重命名选中空间' },
  { key: 'u', label: '选中会话滚动到底部' },
  { key: ':', label: '输入命令' },
  { key: '?', label: '帮助' },
  { key: 'i', label: '编辑当前视口卡片' },
  { key: 'Esc / Enter', label: '退出 Canvas Mode' },
]

function isPlainTextEditingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.closest('.xterm')) return true
  const tagName = target.tagName
  return tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT' || target.isContentEditable
}

function normalizeCommandQuery(value: string): string {
  return value.trim().toLowerCase().replace(/[\s_-]+/g, '')
}

function getCanvasCommandProjectContextKey(projectId: string, worktreeId?: string | null): string {
  return `${projectId}::${worktreeId ?? 'main'}`
}

function parseCanvasCommandProjectContextKey(key: string): CanvasCommandProjectContext | null {
  const [projectId, worktreePart] = key.split('::')
  if (!projectId) return null
  return {
    projectId,
    worktreeId: worktreePart && worktreePart !== 'main' ? worktreePart : null,
  }
}

function scoreCommand(command: CanvasCommandInputCommand, query: string): number {
  if (!query) return 1
  const fields = [command.label, command.detail, command.id, ...command.aliases]
    .map(normalizeCommandQuery)
    .filter(Boolean)

  if (fields.some((field) => field === query)) return 100
  if (fields.some((field) => field.startsWith(query))) return 80
  if (fields.some((field) => field.includes(query))) return 40
  return 0
}

function scoreNewSessionOption(option: NewSessionOption, query: string): number {
  if (!query) return 1
  const fields = [
    option.label,
    option.id,
    option.type ?? '',
    option.customSessionDefinitionId ?? '',
  ].map(normalizeCommandQuery).filter(Boolean)

  if (fields.some((field) => field === query)) return 100
  if (fields.some((field) => field.startsWith(query))) return 80
  if (fields.some((field) => field.includes(query))) return 40
  return 0
}

function useCommandPanelKeyboardCapture({
  panelRef,
  inputRef,
  onBack,
  onArrowDown,
  onArrowUp,
  onEnter,
  setQuery,
}: {
  panelRef: { current: HTMLDivElement | null }
  inputRef: { current: HTMLInputElement | null }
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
  }, [inputRef, onArrowDown, onArrowUp, onBack, onEnter, panelRef, setQuery])
}

function CanvasCommandInputDialog({
  commands,
  onBack,
}: {
  commands: CanvasCommandInputCommand[]
  onBack: () => void
}): JSX.Element {
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)

  const visibleCommands = useMemo(() => {
    const normalizedQuery = normalizeCommandQuery(query)
    return commands
      .map((command, index) => ({
        command,
        index,
        score: scoreCommand(command, normalizedQuery),
      }))
      .filter((item) => !normalizedQuery || item.score > 0)
      .sort((a, b) => b.score - a.score || a.index - b.index)
      .map((item) => item.command)
      .slice(0, 14)
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

  const confirmSelected = useCallback(() => {
    visibleCommands[selectedIndex]?.run()
  }, [selectedIndex, visibleCommands])

  useCommandPanelKeyboardCapture({
    panelRef,
    inputRef,
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
        className="w-[min(600px,calc(100vw-32px))] overflow-hidden rounded-[var(--radius-xl)] border border-[var(--color-border)] bg-[var(--color-bg-secondary)] shadow-2xl shadow-black/45"
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
            <div className="text-[var(--ui-font-sm)] font-semibold text-[var(--color-text-primary)]">画布命令</div>
            <div className="text-[10px] text-[var(--color-text-tertiary)]">Esc 返回 Canvas Mode</div>
          </div>
          <div className="flex h-10 items-center rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg-primary)] px-3">
            <span className="mr-2 font-mono text-[var(--ui-font-sm)] font-bold text-[var(--color-accent)]">:</span>
            <input
              ref={inputRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              spellCheck={false}
              placeholder="输入命令，例如 search、note、grid、bookmark"
              className="h-full min-w-0 flex-1 bg-transparent text-[var(--ui-font-sm)] text-[var(--color-text-primary)] outline-none placeholder:text-[var(--color-text-tertiary)]"
            />
          </div>
        </div>
        <div className="max-h-[460px] overflow-y-auto p-1.5">
          {visibleCommands.length === 0 ? (
            <div className="px-3 py-6 text-center text-[var(--ui-font-sm)] text-[var(--color-text-tertiary)]">
              没有匹配的命令
            </div>
          ) : visibleCommands.map((command, index) => (
            <button
              key={command.id}
              type="button"
              onClick={() => command.run()}
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

function CanvasCommandNewSessionDialog({
  viewportRef,
  onClose,
  onAfterNamePromptClose,
}: {
  viewportRef: RefObject<HTMLDivElement | null>
  onClose: () => void
  onAfterNamePromptClose: () => void
}): JSX.Element {
  const selectedProjectId = useProjectsStore((state) => state.selectedProjectId)
  const customSessionDefinitions = useUIStore((state) => state.settings.customSessionDefinitions)
  const hiddenNewSessionOptionIds = useUIStore((state) => state.settings.hiddenNewSessionOptionIds)
  const newSessionOptionOrder = useUIStore((state) => state.settings.newSessionOptionOrder)
  const setSessionNamePrompt = useUIStore((state) => state.setSessionNamePrompt)
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)

  const options = useMemo(
    () => buildNewSessionOptions(customSessionDefinitions, hiddenNewSessionOptionIds, newSessionOptionOrder),
    [customSessionDefinitions, hiddenNewSessionOptionIds, newSessionOptionOrder],
  )
  const filteredOptions = useMemo(() => {
    const normalizedQuery = normalizeCommandQuery(query)
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
    const defaultName = option.customSessionDefinitionId
      ? useSessionsStore.getState().generateDefaultSessionName(projectId, 'terminal', option.label)
      : useSessionsStore.getState().generateDefaultSessionName(projectId, option.type ?? 'terminal')

    onClose()
    setSessionNamePrompt({
      defaultName,
      title: `新建 ${option.label}`,
      description: '输入会话名称，回车后在画布当前视口创建卡片。',
      sessionType: option.type,
      onSubmit: (name) => {
        createCanvasSessionAtCenter(viewportRef, option, name)
        onAfterNamePromptClose()
      },
      onUseDefault: () => {
        createCanvasSessionAtCenter(viewportRef, option, defaultName)
        onAfterNamePromptClose()
      },
      onCancel: onAfterNamePromptClose,
    })
  }, [onAfterNamePromptClose, onClose, selectedProjectId, setSessionNamePrompt, viewportRef])

  const selectPrevious = useCallback(() => {
    setSelectedIndex((current) => Math.max(0, current - 1))
  }, [])
  const selectNext = useCallback(() => {
    setSelectedIndex((current) => Math.min(current + 1, Math.max(0, filteredOptions.length - 1)))
  }, [filteredOptions.length])
  const confirmSelected = useCallback(() => {
    if (selectedOption) openNamePrompt(selectedOption)
  }, [openNamePrompt, selectedOption])

  useCommandPanelKeyboardCapture({
    panelRef,
    inputRef,
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

function CanvasCommandHelpPanel({ onClose }: { onClose: () => void }): JSX.Element {
  return (
    <div
      className="fixed inset-0 z-[9600] flex items-start justify-center bg-black/30 px-4 pt-16 backdrop-blur-[1px]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="w-[min(680px,calc(100vw-32px))] overflow-hidden rounded-[var(--radius-xl)] border border-[var(--color-border)] bg-[var(--color-bg-secondary)] shadow-2xl shadow-black/45">
        <div className="flex items-center justify-between border-b border-[var(--color-border)] px-4 py-3">
          <div className="text-[var(--ui-font-sm)] font-semibold text-[var(--color-text-primary)]">Canvas Mode 快捷键</div>
          <div className="text-[10px] text-[var(--color-text-tertiary)]">? / Esc 关闭</div>
        </div>
        <div className="grid max-h-[520px] grid-cols-1 gap-1 overflow-y-auto p-2 sm:grid-cols-2">
          {CANVAS_COMMAND_SHORTCUTS.map((item) => (
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

interface CanvasCommandProjectSwitchItem {
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

interface CanvasCommandCardSwitchItem {
  id: string
  cardId: string
  title: string
  detail: string
  searchText: string
  priority: number
  kind: 'session' | 'terminal' | 'editor'
  isCurrent: boolean
  isPrevious: boolean
}

function CanvasCommandProjectSwitcher({
  recentKeys,
  onBack,
  onSelect,
}: {
  recentKeys: string[]
  onBack: () => void
  onSelect: (context: CanvasCommandProjectContext) => void
}): JSX.Element {
  const projects = useProjectsStore((state) => state.projects)
  const selectedProjectId = useProjectsStore((state) => state.selectedProjectId)
  const groups = useGroupsStore((state) => state.groups)
  const worktrees = useWorktreesStore((state) => state.worktrees)
  const selectedWorktreeId = useWorktreesStore((state) => state.selectedWorktreeId)
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const visibleItemsRef = useRef<CanvasCommandProjectSwitchItem[]>([])
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
    ? getCanvasCommandProjectContextKey(selectedProjectId, effectiveSelectedWorktreeId)
    : null
  const previousContextKey = currentContextKey
    ? (recentKeys.find((key) => key !== currentContextKey) ?? null)
    : null

  const scoreProjectSwitchItem = useCallback((key: string, isCurrent: boolean): number => {
    if (previousContextKey && key === previousContextKey) return 2000
    const rank = recentRank.get(key)
    return (isCurrent ? 1000 : 0) + (rank !== undefined ? 500 - rank * 10 : 0)
  }, [previousContextKey, recentRank])

  const items = useMemo<CanvasCommandProjectSwitchItem[]>(() => {
    const result: CanvasCommandProjectSwitchItem[] = []

    for (const project of projects) {
      const groupName = groupNameById.get(project.groupId) ?? ''
      const groupColor = groupColorById.get(project.groupId) ?? null
      const mainKey = getCanvasCommandProjectContextKey(project.id, null)
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
        const key = getCanvasCommandProjectContextKey(project.id, worktree.id)
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
    const normalizedQuery = normalizeCommandQuery(query)
    if (!normalizedQuery) return items
    return items.filter((item) => normalizeCommandQuery(item.searchText).includes(normalizedQuery))
  }, [items, query])
  visibleItemsRef.current = visibleItems
  selectedIndexRef.current = selectedIndex

  const focusInput = useCallback(() => {
    inputRef.current?.focus({ preventScroll: true })
  }, [])

  useEffect(() => {
    setSelectedIndex(0)
  }, [query])

  useEffect(() => {
    window.requestAnimationFrame(focusInput)
    window.setTimeout(focusInput, 40)
    window.setTimeout(focusInput, 160)
  }, [focusInput])

  useEffect(() => {
    if (visibleItems.length === 0 && selectedIndex !== 0) {
      setSelectedIndex(0)
      return
    }
    if (selectedIndex >= visibleItems.length) {
      setSelectedIndex(Math.max(0, visibleItems.length - 1))
    }
  }, [selectedIndex, visibleItems.length])

  const activateItem = useCallback((item: CanvasCommandProjectSwitchItem) => {
    onSelect({ projectId: item.projectId, worktreeId: item.worktreeId })
  }, [onSelect])

  const activateSelected = useCallback(() => {
    const item = visibleItemsRef.current[selectedIndexRef.current]
    if (item) activateItem(item)
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
  }, [activateSelected, focusInput, onBack])

  return (
    <div
      className="fixed inset-0 z-[9600] flex items-start justify-center bg-black/30 px-4 pt-20 backdrop-blur-[1px]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onBack()
      }}
    >
      <div
        ref={panelRef}
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
              Esc 返回 Canvas Mode
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

function CanvasCommandCardSwitcher({
  onBack,
  onSelect,
}: {
  onBack: () => void
  onSelect: (cardId: string) => void
}): JSX.Element {
  const cards = useCanvasStore((state) => state.getLayout().cards)
  const recentCardIds = useCanvasStore((state) => state.getLayout().recentCardIds ?? [])
  const selectedCardIds = useCanvasStore((state) => state.selectedCardIds)
  const sessions = useSessionsStore((state) => state.sessions)
  const editors = useEditorsStore((state) => state.tabs)
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)

  const sessionById = useMemo(() => new Map(sessions.map((session) => [session.id, session])), [sessions])
  const editorById = useMemo(() => new Map(editors.map((tab) => [tab.id, tab])), [editors])
  const workCards = useMemo(
    () => cards.filter((card) => (card.kind === 'session' || card.kind === 'terminal' || card.kind === 'editor') && card.refId),
    [cards],
  )
  const workCardIds = useMemo(() => new Set(workCards.map((card) => card.id)), [workCards])
  const currentCardId = selectedCardIds.find((id) => workCardIds.has(id)) ?? null
  const previousCardId = recentCardIds.find((id) => id !== currentCardId && workCardIds.has(id)) ?? null
  const recentRank = useMemo(
    () => new Map(recentCardIds.map((id, index) => [id, index])),
    [recentCardIds],
  )

  const items = useMemo<CanvasCommandCardSwitchItem[]>(() => {
    return workCards
      .map((card) => {
        if (card.kind === 'editor') {
          const tab = card.refId ? editorById.get(card.refId) : undefined
          if (!tab) return null
          const rank = recentRank.get(card.id)
          const isCurrent = card.id === currentCardId
          const isPrevious = card.id === previousCardId
          const priority = isPrevious
            ? 2000
            : (isCurrent ? 1000 : 0) + (rank !== undefined ? 500 - rank * 10 : 0)
          return {
            id: card.id,
            cardId: card.id,
            title: tab.fileName,
            detail: `${tab.language}${tab.modified ? ' · 未保存' : ''}`,
            searchText: [tab.fileName, tab.filePath, tab.language].filter(Boolean).join(' '),
            priority,
            kind: 'editor' as const,
            isCurrent,
            isPrevious,
          }
        }
        const session = card.refId ? sessionById.get(card.refId) : undefined
        if (!session) return null
        const title = session ? formatSessionCardTitle(session.name, card.sessionRemark) : '会话'
        const typeLabel = session ? SESSION_TYPE_CONFIG[session.type]?.label ?? session.type : card.kind
        const status = session?.status ? ` · ${session.status}` : ''
        const rank = recentRank.get(card.id)
        const isCurrent = card.id === currentCardId
        const isPrevious = card.id === previousCardId
        const priority = isPrevious
          ? 2000
          : (isCurrent ? 1000 : 0) + (rank !== undefined ? 500 - rank * 10 : 0)
        return {
          id: card.id,
          cardId: card.id,
          title,
          detail: `${typeLabel}${status}`,
          searchText: [title, session?.name, session?.type, session?.label, card.sessionRemark].filter(Boolean).join(' '),
          priority,
          kind: card.kind === 'terminal' ? 'terminal' : 'session',
          isCurrent,
          isPrevious,
        }
      })
      .filter((item): item is CanvasCommandCardSwitchItem => Boolean(item))
      .sort((a, b) => b.priority - a.priority || a.title.localeCompare(b.title))
  }, [currentCardId, editorById, previousCardId, recentRank, sessionById, workCards])

  const visibleItems = useMemo(() => {
    const normalizedQuery = normalizeCommandQuery(query)
    if (!normalizedQuery) return items
    return items.filter((item) => normalizeCommandQuery(item.searchText).includes(normalizedQuery))
  }, [items, query])

  useEffect(() => {
    setSelectedIndex(0)
  }, [query])

  useEffect(() => {
    const focusInput = (): void => inputRef.current?.focus({ preventScroll: true })
    window.requestAnimationFrame(focusInput)
    window.setTimeout(focusInput, 40)
    window.setTimeout(focusInput, 160)
  }, [])

  useEffect(() => {
    if (visibleItems.length === 0 && selectedIndex !== 0) {
      setSelectedIndex(0)
      return
    }
    if (selectedIndex >= visibleItems.length) {
      setSelectedIndex(Math.max(0, visibleItems.length - 1))
    }
  }, [selectedIndex, visibleItems.length])

  const selectPrevious = useCallback(() => {
    setSelectedIndex((current) => Math.max(0, current - 1))
  }, [])

  const selectNext = useCallback(() => {
    setSelectedIndex((current) => Math.min(current + 1, Math.max(0, visibleItems.length - 1)))
  }, [visibleItems.length])

  const select = useCallback((index: number) => {
    const item = visibleItems[index]
    if (item) onSelect(item.cardId)
  }, [onSelect, visibleItems])

  const confirmSelected = useCallback(() => {
    select(selectedIndex)
  }, [select, selectedIndex])

  useCommandPanelKeyboardCapture({
    panelRef,
    inputRef,
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
            <div className="text-[var(--ui-font-sm)] font-semibold text-[var(--color-text-primary)]">切换画布卡片</div>
            <div className="text-[10px] text-[var(--color-text-tertiary)]">Esc 返回 Canvas Mode</div>
          </div>
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            spellCheck={false}
            placeholder="搜索画布卡片"
            className={cn(
              'h-10 w-full rounded-[var(--radius-md)] border border-[var(--color-border)]',
              'bg-[var(--color-bg-primary)] px-3 text-[var(--ui-font-sm)] text-[var(--color-text-primary)]',
              'placeholder:text-[var(--color-text-tertiary)] outline-none',
            )}
          />
        </div>
        <div className="max-h-[380px] overflow-y-auto p-1.5">
          {visibleItems.length === 0 ? (
            <div className="px-3 py-6 text-center text-[var(--ui-font-sm)] text-[var(--color-text-tertiary)]">
              没有匹配的卡片
            </div>
          ) : visibleItems.map((item, index) => (
            <button
              key={item.id}
              type="button"
              onClick={() => select(index)}
              className={cn(
                'flex min-h-11 w-full items-center gap-3 rounded-[var(--radius-md)] px-3 py-2 text-left transition-colors',
                index === selectedIndex
                  ? 'bg-[var(--color-accent)]/16 text-[var(--color-text-primary)]'
                  : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-tertiary)]',
              )}
            >
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-bg-primary)] text-[10px] font-bold">
                {item.kind === 'terminal' ? 'T' : item.kind === 'editor' ? 'F' : 'S'}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[var(--ui-font-sm)] font-medium">{item.title}</span>
                <span className="block truncate text-[11px] text-[var(--color-text-tertiary)]">{item.detail}</span>
              </span>
              {item.isPrevious && <span className="shrink-0 text-[10px] text-[var(--color-accent)]">上一个</span>}
              {!item.isPrevious && item.isCurrent && <span className="shrink-0 text-[10px] text-[var(--color-accent)]">当前</span>}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

function CanvasCommandOverlay({ editing }: { editing: boolean }): JSX.Element {
  return (
    <div className="pointer-events-none fixed inset-0 z-[9400]">
      <div className="absolute bottom-3 left-1/2 z-20 h-8 w-max max-w-[calc(100vw-40px)] -translate-x-1/2 rounded-[var(--radius-lg)] border border-[var(--color-accent)]/25 bg-[var(--color-bg-tertiary)]/80 px-3 shadow-2xl shadow-black/35 backdrop-blur-md">
        <div className="flex h-full items-center gap-x-3 overflow-hidden whitespace-nowrap">
          <span className="rounded-[var(--radius-sm)] bg-[var(--color-accent)]/16 px-2 py-1 text-[11px] font-bold text-[var(--color-accent)]">
            {editing ? 'Canvas Edit' : 'Canvas Mode'}
          </span>
          <span className="text-[11px] text-[var(--color-text-secondary)]">
            {editing ? 'Esc 返回命令模式' : 'h/j/k/l 聚焦 · f 切换会话 · n 新建会话 · t 便签 · s 空间 · : 命令 · ? 帮助 · i 编辑 · Esc/Enter 退出'}
          </span>
        </div>
      </div>
    </div>
  )
}

function fitAllToViewport(viewportRef: RefObject<HTMLDivElement | null>): void {
  const rect = viewportRef.current?.getBoundingClientRect()
  if (!rect) return
  useCanvasStore.getState().fitAll(rect.width, rect.height)
}

function selectedCards(): CanvasCard[] {
  const canvas = useCanvasStore.getState()
  return canvas.selectedCardIds
    .map((id) => canvas.getCard(id))
    .filter((card): card is CanvasCard => Boolean(card))
}

function getCanvasCommandCardsForActiveSpace(): CanvasCard[] {
  const canvas = useCanvasStore.getState()
  const cards = canvas.getCards()
  const activeSpaceId = useCanvasUiStore.getState().activeSpaceId
  if (!activeSpaceId) return cards

  const activeSpace = cards.find((card) => card.id === activeSpaceId && card.kind === 'frame')
  if (!activeSpace) return cards

  const visibleIds = new Set([activeSpace.id, ...(activeSpace.frameMemberIds ?? [])])
  return cards.filter((card) => visibleIds.has(card.id))
}

function getCanvasCardElement(cardId: string): HTMLElement | null {
  const escaped = cardId.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
  return document.querySelector(`[data-card-id="${escaped}"]`) as HTMLElement | null
}

function isCanvasCommandEditableCard(card: CanvasCard): boolean {
  if (isCanvasCardHidden(card)) return false
  if (card.kind === 'note') return true
  if (card.kind === 'editor') return Boolean(card.refId && !card.collapsed)
  if ((card.kind !== 'session' && card.kind !== 'terminal') || !card.refId || card.collapsed) return false

  const session = useSessionsStore.getState().sessions.find((item) => item.id === card.refId)
  return !session || (session.type !== 'browser' && session.type !== 'claude-gui')
}

function getScreenRectOverlapArea(a: DOMRect, b: DOMRect): number {
  const width = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left))
  const height = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top))
  return width * height
}

function findViewportEditingCard(viewportEl: HTMLDivElement | null): CanvasCard | null {
  const canvas = useCanvasStore.getState()
  const maximizedCardId = canvas.maximizedCardId
  if (maximizedCardId) {
    const card = canvas.getCard(maximizedCardId)
    if (card && isCanvasCommandEditableCard(card)) return card
  }

  if (!viewportEl) return null
  const viewportRect = viewportEl.getBoundingClientRect()
  if (viewportRect.width <= 0 || viewportRect.height <= 0) return null

  const viewportArea = Math.max(1, viewportRect.width * viewportRect.height)
  const viewportCenterX = viewportRect.left + viewportRect.width / 2
  const viewportCenterY = viewportRect.top + viewportRect.height / 2
  const maxCenterDistance = Math.max(1, Math.hypot(viewportRect.width, viewportRect.height) / 2)

  let best: { card: CanvasCard; score: number; visibleArea: number; centerDistance: number } | null = null
  for (const card of getCanvasCommandCardsForActiveSpace()) {
    if (!isCanvasCommandEditableCard(card)) continue

    const cardEl = getCanvasCardElement(card.id)
    if (!cardEl) continue

    const cardRect = cardEl.getBoundingClientRect()
    if (cardRect.width <= 0 || cardRect.height <= 0) continue

    const visibleArea = getScreenRectOverlapArea(cardRect, viewportRect)
    if (visibleArea <= 0) continue

    const cardCenterX = cardRect.left + cardRect.width / 2
    const cardCenterY = cardRect.top + cardRect.height / 2
    const centerDistance = Math.hypot(cardCenterX - viewportCenterX, cardCenterY - viewportCenterY)
    const viewportCoverage = visibleArea / viewportArea
    const cardCoverage = visibleArea / Math.max(1, cardRect.width * cardRect.height)
    const centerProximity = 1 - Math.min(1, centerDistance / maxCenterDistance)
    const score = viewportCoverage * 0.68 + centerProximity * 0.27 + cardCoverage * 0.05

    if (
      !best
      || score > best.score
      || (
        Math.abs(score - best.score) < 0.0001
        && (
          visibleArea > best.visibleArea
          || (visibleArea === best.visibleArea && centerDistance < best.centerDistance)
          || (visibleArea === best.visibleArea && centerDistance === best.centerDistance && card.zIndex > best.card.zIndex)
        )
      )
    ) {
      best = { card, score, visibleArea, centerDistance }
    }
  }

  return best?.card ?? null
}

function selectCardForEditing(card: CanvasCard): void {
  const canvas = useCanvasStore.getState()
  const latest = canvas.getCard(card.id)
  if (!latest) return

  if (useUIStore.getState().settings.canvasFocusOnClick) {
    if (canvas.maximizedCardId === latest.id || canvas.focusReturn?.cardId === latest.id) {
      canvas.setSelection([latest.id])
      if (latest.kind !== 'frame') canvas.bringToFront(latest.id)
      canvas.recordCardVisit(latest.id)
      return
    }
    canvas.focusOnCard(latest.id)
    return
  }

  canvas.setSelection([latest.id])
  if (latest.kind !== 'frame') canvas.bringToFront(latest.id)
  canvas.recordCardVisit(latest.id)
}

function addNoteAtCenter(viewportRef: RefObject<HTMLDivElement | null>): void {
  const noteSize = getDefaultCanvasCardSize('note')
  const placement = getSmartNewCardPlacement(viewportRef, noteSize)
  if (!placement) return
  const cardId = useCanvasStore.getState().addCard({
    kind: 'note',
    x: placement.position.x,
    y: placement.position.y,
    noteBody: '',
    noteColor: 'yellow',
  }, placement.placeOptions)
  addCanvasCardToSpace(cardId, placement.activeSpaceId)
}

function createCanvasSessionAtCenter(
  viewportRef: RefObject<HTMLDivElement | null>,
  option: NewSessionOption,
  name: string,
): void {
  const projectId = useProjectsStore.getState().selectedProjectId
  if (!projectId) {
    useUIStore.getState().addToast({
      title: '未选择项目',
      body: '先选择一个项目，再从画布创建会话。',
      type: 'warning',
      duration: 2200,
    })
    return
  }

  const worktreeId = getDefaultWorktreeIdForProject(projectId)
  const cardKind = option.type === 'terminal' || option.type === 'terminal-wsl' || option.customSessionDefinitionId ? 'terminal' : 'session'
  const cardSize = getDefaultCanvasCardSize(cardKind)

  createSessionWithPrompt({
    projectId,
    type: option.type,
    customSessionDefinitionId: option.customSessionDefinitionId,
    worktreeId,
    forceName: name,
  }, (sessionId) => {
    const paneStore = usePanesStore.getState()
    paneStore.addSessionToPane(paneStore.activePaneId, sessionId)
    useSessionsStore.getState().setActive(sessionId)

    const placement = getSmartNewCardPlacement(viewportRef, cardSize)
    if (!placement) return
    const cardId = useCanvasStore.getState().attachSession(sessionId, cardKind, {
      x: placement.position.x,
      y: placement.position.y,
    }, placement.placeOptions)
    addCanvasCardToSpace(cardId, placement.activeSpaceId)
    requestAnimationFrame(() => useCanvasStore.getState().focusOnCard(cardId))
  })
}

function saveBookmarkForCurrentContext(): void {
  const [card] = selectedCards()
  const canvas = useCanvasStore.getState()
  if (!card) {
    canvas.addBookmark()
    return
  }
  canvas.addBookmarkForCard(card.id)
}

function connectSelection(): void {
  const selection = useCanvasStore.getState().selectedCardIds
  if (selection.length !== 2) return
  useCanvasStore.getState().addRelation(selection[0], selection[1])
}

function toggleSelectedMaximized(): void {
  const [card] = selectedCards()
  if (!card) return
  useCanvasStore.getState().toggleMaximizedCard(card.id)
}

function enterOrExitSelectedSpace(): void {
  const canvasUi = useCanvasUiStore.getState()
  const [card] = selectedCards()
  if (card?.kind === 'frame') {
    canvasUi.setActiveSpaceId(card.id)
    useCanvasStore.getState().focusFrameWorkspace(card.id)
    return
  }
  if (canvasUi.activeSpaceId) {
    canvasUi.setActiveSpaceId(null)
    useCanvasStore.getState().showAllCards()
  }
}

function scrollSelectedSessionToBottom(): void {
  const [card] = selectedCards()
  if (!card?.refId) return
  scrollTerminalToLatest(card.refId)
}

function focusCardInput(card: CanvasCard): void {
  if ((card.kind === 'session' || card.kind === 'terminal') && card.refId) {
    focusTerminalInputSoon(card.refId)
    return
  }
  if (card.kind === 'editor' && card.refId) {
    focusOpenEditorSoon(card.refId)
    return
  }

  const cardEl = getCanvasCardElement(card.id)
  const input = cardEl?.querySelector('textarea, input, [contenteditable="true"]') as HTMLElement | null
  input?.focus({ preventScroll: true })
}

function focusCardInputSoon(card: CanvasCard): void {
  if ((card.kind === 'session' || card.kind === 'terminal') && card.refId) {
    focusTerminalInputSoon(card.refId)
    return
  }
  if (card.kind === 'editor' && card.refId) {
    focusOpenEditorSoon(card.refId)
    return
  }

  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(() => {
      const latest = useCanvasStore.getState().getCard(card.id)
      if (latest) focusCardInput(latest)
    })
  })
}

function focusViewportCardInput(viewportRef: RefObject<HTMLDivElement | null>): void {
  const target = findViewportEditingCard(viewportRef.current)
    ?? selectedCards().find(isCanvasCommandEditableCard)
  if (!target) return

  selectCardForEditing(target)
  focusCardInputSoon(target)
}

function runArrange(mode: CanvasArrangeMode | 'pack'): void {
  const ui = useUIStore.getState()
  if (mode === 'pack') {
    ui.updateSettings({ canvasArrangeMode: 'free' })
    useCanvasStore.getState().arrange('pack')
    return
  }
  ui.updateSettings({ canvasArrangeMode: mode })
  useCanvasStore.getState().arrange(mode)
}

function directionFromKey(key: string): Parameters<typeof focusCanvasCardInDirection>[0] | null {
  const normalized = key.length === 1 ? key.toLowerCase() : key
  if (normalized === 'h' || normalized === 'ArrowLeft') return 'left'
  if (normalized === 'j' || normalized === 'ArrowDown') return 'down'
  if (normalized === 'k' || normalized === 'ArrowUp') return 'up'
  if (normalized === 'l' || normalized === 'ArrowRight') return 'right'
  return null
}

export function useCanvasCommandMode({
  viewportRef,
  searchOpen,
  onRenameFrame,
  onCreateFrame,
}: CanvasCommandModeOptions): CanvasCommandModeController {
  const [active, setActive] = useState(false)
  const [editing, setEditing] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const [inputOpen, setInputOpen] = useState(false)
  const [cardSwitcherOpen, setCardSwitcherOpen] = useState(false)
  const [projectSwitcherOpen, setProjectSwitcherOpen] = useState(false)
  const [newSessionOpen, setNewSessionOpen] = useState(false)
  const [recentProjectKeys, setRecentProjectKeys] = useState<string[]>([])
  const focusRef = useRef<HTMLDivElement | null>(null)
  const activeRef = useRef(false)
  const editingRef = useRef(false)
  const restoreInputModePendingRef = useRef(false)
  const previousSearchOpenRef = useRef(false)
  const panelReturnGuardUntilRef = useRef(0)
  const selectedProjectId = useProjectsStore((state) => state.selectedProjectId)
  const selectedWorktreeId = useWorktreesStore((state) => state.selectedWorktreeId)
  const worktrees = useWorktreesStore((state) => state.worktrees)
  const effectiveSelectedWorktreeId = useMemo(() => {
    const selectedWorktree = worktrees.find((item) => item.id === selectedWorktreeId && item.projectId === selectedProjectId)
    return selectedWorktree?.isMain ? null : (selectedWorktreeId ?? null)
  }, [selectedProjectId, selectedWorktreeId, worktrees])

  const focusSink = useCallback(() => {
    window.requestAnimationFrame(() => focusRef.current?.focus({ preventScroll: true }))
  }, [])

  const restoreInputMode = useCallback(() => {
    if (window.api.platform !== 'win32' || !restoreInputModePendingRef.current) return
    restoreInputModePendingRef.current = false
    window.setTimeout(() => {
      void window.api.window.restoreInputMode().catch(() => {})
    }, 30)
  }, [])

  const ensureEnglishInputMode = useCallback(() => {
    if (window.api.platform !== 'win32') return
    restoreInputModePendingRef.current = false
    window.setTimeout(() => {
      void window.api.window.ensureEnglishInputMode()
        .then((result) => {
          if (!result.switched) return
          if (activeRef.current && !editingRef.current) {
            restoreInputModePendingRef.current = true
            return
          }
          void window.api.window.restoreInputMode().catch(() => {})
        })
        .catch(() => {})
    }, 30)
  }, [])

  const enter = useCallback(() => {
    activeRef.current = true
    editingRef.current = false
    setEditing(false)
    setActive(true)
    focusSink()
    ensureEnglishInputMode()
  }, [ensureEnglishInputMode, focusSink])

  const exit = useCallback(() => {
    activeRef.current = false
    editingRef.current = false
    setActive(false)
    setEditing(false)
    setHelpOpen(false)
    setInputOpen(false)
    setCardSwitcherOpen(false)
    setProjectSwitcherOpen(false)
    setNewSessionOpen(false)
    restoreInputMode()
  }, [restoreInputMode])

  const enterEditing = useCallback(() => {
    editingRef.current = true
    setEditing(true)
    restoreInputMode()
    window.requestAnimationFrame(() => focusViewportCardInput(viewportRef))
  }, [restoreInputMode, viewportRef])

  const exitEditing = useCallback(() => {
    editingRef.current = false
    setEditing(false)
    focusSink()
    ensureEnglishInputMode()
  }, [ensureEnglishInputMode, focusSink])

  useEffect(() => {
    activeRef.current = active
  }, [active])

  useEffect(() => {
    editingRef.current = editing
  }, [editing])

  const runAndCloseInput = useCallback((run: () => void, exitMode = false) => {
    setInputOpen(false)
    run()
    if (exitMode) exit()
    else focusSink()
  }, [exit, focusSink])

  const guardPanelReturn = useCallback(() => {
    panelReturnGuardUntilRef.current = Date.now() + 220
  }, [])

  const closeCardSwitcher = useCallback(() => {
    setCardSwitcherOpen(false)
    guardPanelReturn()
    focusSink()
  }, [focusSink, guardPanelReturn])

  const closeProjectSwitcher = useCallback(() => {
    setProjectSwitcherOpen(false)
    guardPanelReturn()
    focusSink()
  }, [focusSink, guardPanelReturn])

  const closeNewSessionSelector = useCallback(() => {
    setNewSessionOpen(false)
    guardPanelReturn()
    focusSink()
  }, [focusSink, guardPanelReturn])

  const openProjectSwitcher = useCallback(() => {
    setProjectSwitcherOpen(true)
  }, [])

  const openNewSessionSelector = useCallback(() => {
    setInputOpen(false)
    setNewSessionOpen(true)
  }, [])

  const openCardSwitcher = useCallback(() => {
    setCardSwitcherOpen(true)
  }, [])

  const openCardSwitcherFromInput = useCallback(() => {
    setInputOpen(false)
    openCardSwitcher()
  }, [openCardSwitcher])

  const focusCanvasCommandCard = useCallback((cardId: string) => {
    const canvas = useCanvasStore.getState()
    const card = canvas.getCard(cardId)
    if (!card) return
    if (isCanvasCardHidden(card)) canvas.updateCard(cardId, { hidden: false, hiddenByFrameId: undefined })
    canvas.clearMaximizedCard()
    canvas.clearFocusReturn()
    window.requestAnimationFrame(() => {
      const latest = useCanvasStore.getState().getCard(cardId)
      if (!latest) return
      if (latest.kind === 'frame') useCanvasStore.getState().focusFrameWorkspace(cardId)
      else useCanvasStore.getState().focusOnCard(cardId)
    })
  }, [])

  const selectCardFromSwitcher = useCallback((cardId: string) => {
    setCardSwitcherOpen(false)
    guardPanelReturn()
    focusCanvasCommandCard(cardId)
    focusSink()
  }, [focusCanvasCommandCard, focusSink, guardPanelReturn])

  const switchCanvasProjectContext = useCallback((context: CanvasCommandProjectContext) => {
    switchProjectContext(context.projectId, null, context.worktreeId)
    setProjectSwitcherOpen(false)
    guardPanelReturn()
    focusSink()
  }, [focusSink, guardPanelReturn])

  const switchPreviousProject = useCallback(() => {
    if (!selectedProjectId) return
    const currentKey = getCanvasCommandProjectContextKey(selectedProjectId, effectiveSelectedWorktreeId)
    const previousKey = recentProjectKeys.find((key) => key !== currentKey)
    if (!previousKey) return
    const context = parseCanvasCommandProjectContextKey(previousKey)
    if (context) switchCanvasProjectContext(context)
  }, [effectiveSelectedWorktreeId, recentProjectKeys, selectedProjectId, switchCanvasProjectContext])

  useEffect(() => {
    if (!selectedProjectId) return
    const key = getCanvasCommandProjectContextKey(selectedProjectId, effectiveSelectedWorktreeId)
    setRecentProjectKeys((current) => [key, ...current.filter((item) => item !== key)].slice(0, 12))
  }, [effectiveSelectedWorktreeId, selectedProjectId])

  const commands = useMemo<CanvasCommandInputCommand[]>(() => {
    const canvas = useCanvasStore.getState()
    const selected = canvas.selectedCardIds
    const firstSelected = selected[0] ? canvas.getCard(selected[0]) ?? null : null
    const hasSelection = selected.length > 0
    const hasTwoSelected = selected.length === 2
    const selectedIsFrame = firstSelected?.kind === 'frame'

    return [
      {
        id: 'search',
        label: '切换画布卡片',
        detail: '打开画布卡片切换面板',
        aliases: ['f', 'find', 'search', 'session', 'file', 'switch card', '会话', '文件'],
        run: openCardSwitcherFromInput,
      },
      {
        id: 'project',
        label: '切换项目',
        detail: '打开项目 / worktree 切换面板',
        aliases: ['p', 'project', 'projects', 'switch project', '项目'],
        run: () => runAndCloseInput(openProjectSwitcher),
      },
      {
        id: 'previous-project',
        label: '切到上一个项目',
        detail: '等同 Canvas Mode 下按 Tab',
        aliases: ['tab', 'previous project', 'recent project', '上一个项目'],
        run: () => runAndCloseInput(switchPreviousProject),
      },
      {
        id: 'new-session',
        label: '新建会话',
        detail: '选择会话类型并在当前视口创建卡片',
        aliases: ['n', 'new', 'new session', 'session', '新建', '会话'],
        run: openNewSessionSelector,
      },
      {
        id: 'new-note',
        label: '新建便签',
        detail: '在当前视口中心创建便签',
        aliases: ['t', 'note', 'sticky', '便签'],
        run: () => runAndCloseInput(() => addNoteAtCenter(viewportRef)),
      },
      {
        id: 'new-space',
        label: '新建空间',
        detail: hasSelection ? '围绕选中卡片创建空间' : '在当前视口中心创建空空间',
        aliases: ['s', 'space', 'frame', '空间'],
        run: () => runAndCloseInput(onCreateFrame),
      },
      {
        id: 'fit-all',
        label: '适配所有内容',
        detail: '缩放并居中显示当前画布全部内容',
        aliases: ['a', 'all', 'fit', 'fit all', '适配'],
        run: () => runAndCloseInput(() => fitAllToViewport(viewportRef)),
      },
      {
        id: 'bookmark',
        label: '保存书签',
        detail: hasSelection ? '保存选中卡片书签' : '保存当前视图书签',
        aliases: ['b', 'bookmark', 'save view', '书签'],
        run: () => runAndCloseInput(saveBookmarkForCurrentContext),
      },
      {
        id: 'grid',
        label: '网格整理',
        detail: '把当前画布整理为网格',
        aliases: ['g', 'grid', 'arrange', '网格'],
        run: () => runAndCloseInput(() => runArrange('grid')),
      },
      {
        id: 'row',
        label: '横向整理',
        detail: '把当前画布整理为横向流',
        aliases: ['row', 'horizontal', '横向'],
        run: () => runAndCloseInput(() => runArrange('rowFlow')),
      },
      {
        id: 'column',
        label: '纵向整理',
        detail: '把当前画布整理为纵向流',
        aliases: ['column', 'vertical', 'col', '纵向'],
        run: () => runAndCloseInput(() => runArrange('colFlow')),
      },
      {
        id: 'pack',
        label: '紧凑打包',
        detail: '压紧画布卡片间距',
        aliases: ['pack', 'compact', '打包'],
        run: () => runAndCloseInput(() => runArrange('pack')),
      },
      {
        id: 'connect',
        label: '连接选中卡片',
        detail: hasTwoSelected ? '给两个选中卡片添加连线' : '需要正好选中两个卡片',
        aliases: ['c', 'connect', 'link', '连接'],
        run: () => runAndCloseInput(connectSelection),
      },
      {
        id: 'duplicate',
        label: '克隆选中卡片',
        detail: hasSelection ? `克隆 ${selected.length} 张选中卡片` : '需要先选中卡片',
        aliases: ['d', 'duplicate', 'clone', '克隆'],
        run: () => runAndCloseInput(() => useCanvasStore.getState().duplicateCards(useCanvasStore.getState().selectedCardIds)),
      },
      {
        id: 'remove',
        label: '移除选中卡片',
        detail: hasSelection ? `从画布移除 ${selected.length} 张卡片` : '需要先选中卡片',
        aliases: ['x', 'remove', 'delete', '删除', '移除'],
        run: () => runAndCloseInput(() => useCanvasStore.getState().removeCards(useCanvasStore.getState().selectedCardIds)),
      },
      {
        id: 'maximize',
        label: '最大化/还原选中卡片',
        detail: '切换选中卡片的最大化状态',
        aliases: ['z', 'zoom', 'maximize', '最大化'],
        run: () => runAndCloseInput(toggleSelectedMaximized),
      },
      {
        id: 'space',
        label: '进入/退出空间',
        detail: selectedIsFrame ? '进入选中空间' : '退出当前空间过滤',
        aliases: ['o', 'open space', 'space', '进入空间'],
        run: () => runAndCloseInput(enterOrExitSelectedSpace),
      },
      {
        id: 'rename-space',
        label: '重命名选中空间',
        detail: selectedIsFrame ? '打开空间重命名输入框' : '需要先选中空间',
        aliases: ['r', 'rename', 'space name', '重命名'],
        run: () => runAndCloseInput(() => {
          const [card] = selectedCards()
          if (card?.kind === 'frame') onRenameFrame(card.id)
        }, true),
      },
      {
        id: 'scroll-bottom',
        label: '选中会话滚动到底部',
        detail: '将选中会话卡片的终端滚动到最新输出',
        aliases: ['u', 'bottom', 'scroll', '底部'],
        run: () => runAndCloseInput(scrollSelectedSessionToBottom),
      },
      {
        id: 'toggle-lock',
        label: '锁定/解锁布局',
        detail: '切换画布拖拽、缩放、删除保护',
        aliases: ['lock', 'unlock', 'layout lock', '锁定'],
        run: () => runAndCloseInput(() => {
          const ui = useUIStore.getState()
          ui.updateSettings({ canvasLayoutLocked: !ui.settings.canvasLayoutLocked })
        }),
      },
      {
        id: 'toggle-grid',
        label: '显示/隐藏网格',
        detail: '切换画布网格背景',
        aliases: ['grid background', 'show grid', '网格背景'],
        run: () => runAndCloseInput(() => {
          const ui = useUIStore.getState()
          ui.updateSettings({ canvasGridEnabled: !ui.settings.canvasGridEnabled })
        }),
      },
      {
        id: 'toggle-snap',
        label: '开启/关闭吸附',
        detail: '切换卡片移动吸附',
        aliases: ['snap', 'magnet', '吸附'],
        run: () => runAndCloseInput(() => {
          const ui = useUIStore.getState()
          ui.updateSettings({ canvasSnapEnabled: !ui.settings.canvasSnapEnabled })
        }),
      },
      {
        id: 'toggle-minimap',
        label: '显示/隐藏小地图',
        detail: '切换画布小地图',
        aliases: ['m', 'minimap', 'map', '小地图'],
        run: () => runAndCloseInput(() => {
          const ui = useUIStore.getState()
          ui.updateSettings({ canvasShowMinimap: !ui.settings.canvasShowMinimap })
        }),
      },
      {
        id: 'show-all',
        label: '显示全部内容',
        detail: '取消画布隐藏状态并退出空间过滤',
        aliases: ['show all', 'unhide', 'all cards', '显示全部'],
        run: () => runAndCloseInput(() => {
          useCanvasUiStore.getState().setActiveSpaceId(null)
          useCanvasStore.getState().showAllCards()
        }),
      },
      {
        id: 'help',
        label: '快捷键帮助',
        detail: '查看 Canvas Mode 快捷键',
        aliases: ['?', 'help', 'shortcuts', '帮助'],
        run: () => runAndCloseInput(() => setHelpOpen(true)),
      },
      {
        id: 'edit-input',
        label: '编辑当前视口卡片',
        detail: '扫描当前视口并把输入交给最合适的会话或便签',
        aliases: ['i', 'input', 'edit', 'terminal', '输入'],
        run: () => runAndCloseInput(enterEditing),
      },
      {
        id: 'exit',
        label: '退出 Canvas Mode',
        detail: '关闭命令模式',
        aliases: ['esc', 'exit', 'quit', '退出'],
        run: exit,
      },
    ]
  }, [enterEditing, exit, onCreateFrame, onRenameFrame, openCardSwitcherFromInput, openNewSessionSelector, openProjectSwitcher, runAndCloseInput, switchPreviousProject, viewportRef])

  const runCanvasCommand = useCallback((key: string): boolean => {
    const normalized = key.length === 1 ? key.toLowerCase() : key

    if (normalized === 'Escape' || normalized === 'Enter') {
      exit()
      return true
    }
    if (normalized === 'i') {
      enterEditing()
      return true
    }
    if (normalized === '?') {
      setHelpOpen((current) => !current)
      return true
    }
    if (normalized === ':') {
      setInputOpen(true)
      return true
    }
    if (normalized === 'f') {
      openCardSwitcher()
      return true
    }
    if (normalized === 'p') {
      openProjectSwitcher()
      return true
    }
    if (normalized === 'Tab') {
      switchPreviousProject()
      return true
    }
    if (normalized === 'a') {
      fitAllToViewport(viewportRef)
      return true
    }
    if (normalized >= '1' && normalized <= '9') {
      const bookmark = useCanvasStore.getState().getLayout().bookmarks[Number(normalized) - 1]
      if (bookmark) useCanvasStore.getState().goToBookmark(bookmark.id)
      return true
    }
    const direction = directionFromKey(normalized as CanvasNavigationKey)
    if (direction) {
      focusCanvasCardInDirection(direction)
      return true
    }
    if ((normalized === 'z')) {
      toggleSelectedMaximized()
      return true
    }
    if (normalized === 'n') {
      openNewSessionSelector()
      return true
    }
    if (normalized === 't') {
      addNoteAtCenter(viewportRef)
      return true
    }
    if (normalized === 's') {
      onCreateFrame()
      return true
    }
    if (normalized === 'b') {
      saveBookmarkForCurrentContext()
      return true
    }
    if (normalized === 'g') {
      runArrange('grid')
      return true
    }
    if (normalized === 'c') {
      connectSelection()
      return true
    }
    if (normalized === 'd') {
      useCanvasStore.getState().duplicateCards(useCanvasStore.getState().selectedCardIds)
      return true
    }
    if (normalized === 'x' || normalized === 'Delete' || normalized === 'Backspace') {
      useCanvasStore.getState().removeCards(useCanvasStore.getState().selectedCardIds)
      return true
    }
    if (normalized === 'o') {
      enterOrExitSelectedSpace()
      return true
    }
    if (normalized === 'r') {
      const [card] = selectedCards()
      if (card?.kind === 'frame') {
        onRenameFrame(card.id)
        exit()
      }
      return true
    }
    if (normalized === 'u') {
      scrollSelectedSessionToBottom()
      return true
    }
    if (normalized === 'm') {
      const ui = useUIStore.getState()
      ui.updateSettings({ canvasShowMinimap: !ui.settings.canvasShowMinimap })
      return true
    }
    return false
  }, [enterEditing, exit, onCreateFrame, onRenameFrame, openCardSwitcher, openNewSessionSelector, openProjectSwitcher, switchPreviousProject, viewportRef])

  useEffect(() => {
    const wasOpen = previousSearchOpenRef.current
    previousSearchOpenRef.current = searchOpen

    if (searchOpen) {
      restoreInputMode()
      return
    }

    if (wasOpen && activeRef.current && !editingRef.current) {
      focusSink()
      ensureEnglishInputMode()
    }
  }, [ensureEnglishInputMode, focusSink, restoreInputMode, searchOpen])

  useEffect(() => {
    const handleCanvasCommandMode = (event: KeyboardEvent): void => {
      const isPrefix = event.altKey
        && !event.ctrlKey
        && !event.metaKey
        && !event.shiftKey
        && (event.key.toLowerCase() === 'f' || event.code === 'KeyF')

      if (isPrefix) {
        if (useUIStore.getState().settings.workspaceLayout !== 'canvas' || useUIStore.getState().settingsOpen) return
        event.preventDefault()
        event.stopPropagation()
        event.stopImmediatePropagation()
        if (activeRef.current) exit()
        else enter()
        return
      }

      if (!activeRef.current) return

      if (
        Date.now() < panelReturnGuardUntilRef.current
        && event.key === 'Enter'
      ) {
        event.preventDefault()
        event.stopPropagation()
        event.stopImmediatePropagation()
        return
      }

      if (helpOpen) {
        event.preventDefault()
        event.stopPropagation()
        event.stopImmediatePropagation()
        if (event.key === 'Escape' || event.key === '?') {
          setHelpOpen(false)
          focusSink()
        }
        return
      }

      if (
        searchOpen
        || inputOpen
        || cardSwitcherOpen
        || projectSwitcherOpen
        || newSessionOpen
        || useUIStore.getState().settingsOpen
        || useUIStore.getState().sessionNamePrompt
      ) return

      if (editingRef.current) {
        if (event.key === 'Escape') {
          event.preventDefault()
          event.stopPropagation()
          event.stopImmediatePropagation()
          exitEditing()
        }
        return
      }

      if (event.ctrlKey || event.metaKey) {
        if (!event.shiftKey && !event.altKey && event.key.toLowerCase() === 'z') {
          const canvas = useCanvasStore.getState()
          if (canvas.canUndo()) {
            event.preventDefault()
            event.stopPropagation()
            event.stopImmediatePropagation()
            canvas.undo()
          }
        }
        return
      }

      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
      runCanvasCommand(event.key)
    }

    window.addEventListener('keydown', handleCanvasCommandMode, true)
    return () => window.removeEventListener('keydown', handleCanvasCommandMode, true)
  }, [cardSwitcherOpen, enter, exit, exitEditing, focusSink, helpOpen, inputOpen, newSessionOpen, projectSwitcherOpen, runCanvasCommand, searchOpen])

  const layer = active ? (
    <>
      <div
        ref={focusRef}
        tabIndex={-1}
        className="fixed left-0 top-0 z-[9399] h-px w-px opacity-0 outline-none"
      />
      <CanvasCommandOverlay editing={editing} />
      {helpOpen && <CanvasCommandHelpPanel onClose={() => { setHelpOpen(false); focusSink() }} />}
      {cardSwitcherOpen && <CanvasCommandCardSwitcher onBack={closeCardSwitcher} onSelect={selectCardFromSwitcher} />}
      {projectSwitcherOpen && (
        <CanvasCommandProjectSwitcher
          recentKeys={recentProjectKeys}
          onBack={closeProjectSwitcher}
          onSelect={switchCanvasProjectContext}
        />
      )}
      {newSessionOpen && (
        <CanvasCommandNewSessionDialog
          viewportRef={viewportRef}
          onClose={closeNewSessionSelector}
          onAfterNamePromptClose={() => {
            guardPanelReturn()
            focusSink()
          }}
        />
      )}
      {inputOpen && <CanvasCommandInputDialog commands={commands} onBack={() => { setInputOpen(false); focusSink() }} />}
    </>
  ) : null

  return { active, enter, exit, layer }
}
