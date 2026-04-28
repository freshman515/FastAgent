import { FolderPlus, Plus, Search, Terminal, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { createSessionWithPrompt } from '@/lib/createSession'
import { getDefaultWorktreeIdForProject, switchProjectContext } from '@/lib/project-context'
import { cn } from '@/lib/utils'
import { useGroupsStore } from '@/stores/groups'
import { usePanesStore } from '@/stores/panes'
import { useProjectsStore } from '@/stores/projects'
import { useSessionsStore } from '@/stores/sessions'
import { useUIStore } from '@/stores/ui'
import { GroupList } from './GroupList'
import { ProjectDetailPanel } from './ProjectDetailPanel'

export function ProjectsPanel(): JSX.Element {
  const addGroup = useGroupsStore((s) => s.addGroup)
  const projects = useProjectsStore((s) => s.projects)
  const selectedProjectId = useProjectsStore((s) => s.selectedProjectId)
  const addToast = useUIStore((s) => s.addToast)
  const openProjectId = useUIStore((s) => s.projectDetailOpenProjectId)
  const setOpenProjectId = useUIStore((s) => s.setProjectDetailOpenProjectId)
  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const committedRef = useRef(false)

  const handleCommit = useCallback(() => {
    if (committedRef.current) return
    const name = newName.trim()
    if (name) {
      committedRef.current = true
      addGroup(name)
    }
    setNewName('')
    setAdding(false)
  }, [newName, addGroup])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') handleCommit()
      if (e.key === 'Escape') {
        committedRef.current = true
        setAdding(false)
        setNewName('')
      }
    },
    [handleCommit],
  )

  const handleStartAdding = useCallback(() => {
    committedRef.current = false
    setNewName('')
    setAdding(true)
  }, [])

  const handleCreateProjectTerminal = useCallback(() => {
    if (!selectedProjectId) {
      addToast({
        type: 'warning',
        title: '未选择项目',
        body: '请先选中一个项目，再创建终端会话。',
      })
      return
    }

    const project = projects.find((item) => item.id === selectedProjectId)
    if (!project) {
      addToast({
        type: 'warning',
        title: '项目不存在',
        body: '当前选中的项目已不在项目列表中。',
      })
      return
    }

    const worktreeId = getDefaultWorktreeIdForProject(selectedProjectId)
    createSessionWithPrompt(
      {
        projectId: selectedProjectId,
        type: 'terminal',
        worktreeId,
      },
      (sessionId) => {
        switchProjectContext(selectedProjectId, sessionId, worktreeId ?? null)
        const paneStore = usePanesStore.getState()
        if (!paneStore.findPaneForSession(sessionId)) {
          paneStore.addSessionToPane(paneStore.activePaneId, sessionId)
        }
        paneStore.setPaneActiveSession(paneStore.activePaneId, sessionId)
        useSessionsStore.getState().setActive(sessionId)
      },
    )
  }, [addToast, projects, selectedProjectId])

  useEffect(() => {
    if (openProjectId && !projects.some((project) => project.id === openProjectId)) {
      setOpenProjectId(null)
    }
  }, [openProjectId, projects])

  if (openProjectId) {
    return <ProjectDetailPanel projectId={openProjectId} onBack={() => setOpenProjectId(null)} />
  }

  return (
    <div className="flex h-full flex-col bg-[var(--color-bg-secondary)]">
      <div className="flex shrink-0 items-center justify-between border-b border-[var(--color-border)]/50 px-2.5 py-1.5">
        <span className="pl-1 text-[11px] font-bold tracking-wider text-[var(--color-text-tertiary)] uppercase">Projects</span>
        <div className="flex items-center gap-0.5">
          <button
            onClick={handleCreateProjectTerminal}
            className={cn(
              'flex h-6 w-6 items-center justify-center rounded-[var(--radius-sm)]',
              'text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-surface)] hover:text-[var(--color-text-primary)]',
              'transition-all duration-150',
            )}
            title="为选中项目新建终端会话"
          >
            <Terminal size={14} />
          </button>
          <button
            onClick={handleStartAdding}
            className={cn(
              'flex h-6 w-6 items-center justify-center rounded-[var(--radius-sm)]',
              'text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-surface)] hover:text-[var(--color-text-primary)]',
              'transition-all duration-150',
            )}
            title="新建分组"
          >
            <Plus size={15} />
          </button>
        </div>
      </div>

      {adding && (
        <div className="border-b border-[var(--color-border)]/60 bg-[var(--color-bg-primary)]/30 px-3 py-2.5 animate-[fade-in_0.2s_ease-out]">
          <div className="flex items-center gap-2">
            <div className="flex h-5 w-5 items-center justify-center rounded-full bg-[var(--color-accent-muted)] text-[var(--color-accent)]">
              <FolderPlus size={12} />
            </div>
            <input
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={handleKeyDown}
              onBlur={handleCommit}
              placeholder="分组名称..."
              className={cn(
                'h-7 w-full rounded-[var(--radius-sm)] bg-[var(--color-bg-surface)]/50 px-2.5 text-[var(--ui-font-sm)]',
                'text-[var(--color-text-primary)] placeholder:text-[var(--color-text-tertiary)]',
                'border border-[var(--color-border)] focus:border-[var(--color-accent)] focus:outline-none transition-all',
              )}
            />
          </div>
        </div>
      )}

      <div className="shrink-0 px-3 py-3">
        <div className="group/search relative">
          {/* Leading search icon — always visible, tints to accent on focus */}
          <div className="pointer-events-none absolute inset-y-0 left-0 flex w-9 items-center justify-center text-[var(--color-text-tertiary)] transition-colors group-focus-within/search:text-[var(--color-accent)]">
            <Search size={14} strokeWidth={2.5} />
          </div>

          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="搜索项目与分组…"
            spellCheck={false}
            className={cn(
              'peer h-8.5 w-full rounded-[var(--radius-md)] border border-[var(--color-border)]/80 bg-[var(--color-bg-primary)]/40 pl-9 pr-8',
              'text-[var(--ui-font-sm)] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-tertiary)]',
              'outline-none transition-all duration-200',
              'hover:border-[var(--color-border-hover)] hover:bg-[var(--color-bg-primary)]/60',
              'focus:border-[var(--color-accent)]/60 focus:bg-[var(--color-bg-primary)]',
              'focus:shadow-[0_0_0_3px_var(--color-accent-muted)]',
            )}
          />

          {/* Trailing clear button — only shown when there's content */}
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="absolute inset-y-0 right-1.5 my-auto flex h-5.5 w-5.5 items-center justify-center rounded-[var(--radius-sm)] text-[var(--color-text-tertiary)] transition-colors hover:bg-[var(--color-bg-surface)] hover:text-[var(--color-text-primary)]"
              title="清除搜索"
            >
              <X size={12} />
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-none pb-4">
        <GroupList searchQuery={searchQuery} onOpenProject={setOpenProjectId} />
      </div>

    </div>
  )
}
