import { ArrowRightLeft, ChevronRight, ExternalLink, Folder, GitBranch, Layers, MoreHorizontal, Play, Plus as PlusIcon, Rocket, Trash2 } from 'lucide-react'
import { createPortal } from 'react-dom'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Project, SessionType, TaskBundle, Worktree } from '@shared/types'
import { isAnonymousProject, removeAnonymousProject } from '@/lib/anonymous-project'
import { getDefaultWorktreeIdForProject, switchProjectContext } from '@/lib/project-context'
import { cn } from '@/lib/utils'
import { useProjectsStore } from '@/stores/projects'
import { useGroupsStore } from '@/stores/groups'
import { useSessionsStore } from '@/stores/sessions'
import { usePanesStore } from '@/stores/panes'
import { useGitStore } from '@/stores/git'
import { useTemplatesStore } from '@/stores/templates'
import { useTasksStore } from '@/stores/tasks'
import { useWorktreesStore } from '@/stores/worktrees'
import { useLaunchesStore } from '@/stores/launches'
import { LaunchMenu } from './LaunchMenu'
import claudeIcon from '@/assets/icons/Claude.png'
import codexIcon from '@/assets/icons/codex.png'
import opencodeIcon from '@/assets/icons/icon-opencode.png'
import terminalIcon from '@/assets/icons/terminal_white.png'

const SESSION_OPTS: Array<{ type: SessionType; label: string; icon: string }> = [
  { type: 'claude-code', label: 'Claude Code', icon: claudeIcon },
  { type: 'claude-code-yolo', label: 'Claude Code YOLO', icon: claudeIcon },
  { type: 'claude-gui', label: 'Claude GUI', icon: claudeIcon },
  { type: 'codex', label: 'Codex', icon: codexIcon },
  { type: 'codex-yolo', label: 'Codex YOLO', icon: codexIcon },
  { type: 'opencode', label: 'OpenCode', icon: opencodeIcon },
  { type: 'terminal', label: 'Terminal', icon: terminalIcon },
]

const MENU_ITEM = 'flex w-full items-center gap-2 px-3 py-1.5 text-[var(--ui-font-sm)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-surface)] hover:text-[var(--color-text-primary)]'
const SECTION_HEADER = 'text-[var(--ui-font-2xs)] font-medium uppercase tracking-wider text-[var(--color-text-tertiary)]'
const INPUT_CLS = 'w-full rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-bg-primary)] px-2 py-1 text-[var(--ui-font-sm)] text-[var(--color-text-primary)] outline-none focus:border-[var(--color-accent)]'
const OVERLAY_PANEL = 'fixed left-1/2 top-1/3 z-50 -translate-x-1/2 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg-tertiary)] p-3 shadow-lg shadow-black/30'
const WT_ROW = 'flex h-7 w-full cursor-pointer items-center gap-1.5 pl-8 pr-2 text-[var(--ui-font-2xs)] transition-colors duration-75'

function SectionDivider({ icon: Icon, label }: { icon: typeof GitBranch; label: string }): JSX.Element {
  return (
    <div className="px-3 py-1 border-t border-[var(--color-border)]">
      <div className="flex items-center gap-1.5">
        <Icon size={10} className="text-[var(--color-text-tertiary)]" />
        <span className={SECTION_HEADER}>{label}</span>
      </div>
    </div>
  )
}

// ── New Branch Input (portal overlay) ──

function NewBranchInput({ project, onClose }: { project: Project; onClose: () => void }): JSX.Element {
  const ref = useRef<HTMLInputElement>(null)
  const [value, setValue] = useState('')
  useEffect(() => { ref.current?.focus() }, [])

  const submit = async (): Promise<void> => {
    const name = value.trim()
    if (!name) { onClose(); return }
    await useGitStore.getState().createBranch(project.id, project.path, name)
    onClose()
  }

  return createPortal(
    <>
      <div className="fixed inset-0 z-50" onClick={onClose} />
      <div className={OVERLAY_PANEL} style={{ width: 280 }}>
        <p className="mb-2 text-[var(--ui-font-sm)] text-[var(--color-text-secondary)]">New branch from current HEAD</p>
        <input ref={ref} value={value} onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') onClose() }}
          placeholder="branch-name" className={INPUT_CLS} />
      </div>
    </>, document.body,
  )
}

// ── New Worktree Dialog (portal overlay) ──

function NewWorktreeDialog({ project, onClose }: { project: Project; onClose: () => void }): JSX.Element {
  const ref = useRef<HTMLInputElement>(null)
  const [branch, setBranch] = useState('')
  useEffect(() => { ref.current?.focus() }, [])

  const parentDir = project.path.replace(/[\\/][^\\/]+$/, '')
  const safeBranch = branch.trim().replace(/[/\\]/g, '-')
  const targetName = safeBranch ? `${project.name}-${safeBranch}` : ''
  const targetPath = targetName ? `${parentDir}/${targetName}` : ''

  const submit = async (): Promise<void> => {
    const name = branch.trim()
    if (!name || !targetPath) return
    try {
      await window.api.git.addWorktree(project.path, targetPath, name)
      const wtStore = useWorktreesStore.getState()
      const wtId = wtStore.addWorktree(project.id, name, targetPath, false)
      wtStore.selectWorktree(wtId)
      useProjectsStore.getState().selectProject(project.id)
      usePanesStore.getState().switchWorktree(wtId, [], null)
      // Sync worktree list in background (won't delete the entry we just created thanks to path normalization)
      useGitStore.getState().fetchWorktrees(project.id, project.path)
    } catch {
      // Failed to create worktree
    }
    onClose()
  }

  return createPortal(
    <>
      <div className="fixed inset-0 z-50" onClick={onClose} />
      <div className={OVERLAY_PANEL} style={{ width: 340 }}>
        <p className="mb-2 text-[var(--ui-font-sm)] font-medium text-[var(--color-text-primary)]">New Worktree</p>
        <input ref={ref} value={branch} onChange={(e) => setBranch(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') onClose() }}
          placeholder="branch-name" className={cn(INPUT_CLS, 'mb-2')} />
        {targetPath && (
          <p className="mb-3 truncate text-[var(--ui-font-2xs)] text-[var(--color-text-tertiary)]">{targetPath}</p>
        )}
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="rounded-[var(--radius-sm)] px-3 py-1 text-[var(--ui-font-sm)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-surface)]">Cancel</button>
          <button onClick={submit} disabled={!branch.trim()} className="rounded-[var(--radius-sm)] bg-[var(--color-accent)] px-3 py-1 text-[var(--ui-font-sm)] text-white hover:opacity-90 disabled:opacity-40">Create</button>
        </div>
      </div>
    </>, document.body,
  )
}

// ── Task Start Dialog (portal overlay) ──

function TaskStartDialog({ bundle, project, onClose }: { bundle: TaskBundle; project: Project; onClose: () => void }): JSX.Element {
  const ref = useRef<HTMLInputElement>(null)
  const [desc, setDesc] = useState('')
  const [branchVal, setBranchVal] = useState(bundle.branchPrefix ?? '')
  useEffect(() => { ref.current?.focus() }, [])

  const start = async (): Promise<void> => {
    const description = desc.trim()
    if (!description) return
    const branchName = branchVal.trim() || undefined
    if (branchName) await useGitStore.getState().createBranch(project.id, project.path, branchName)
    const wtStore = useWorktreesStore.getState()
    const mainWt = wtStore.getMainWorktree(project.id)
    const wtId = undefined

    // Switch to project first so xterm components render and PTYs get created
    useProjectsStore.getState().selectProject(project.id)
    if (mainWt) {
      wtStore.selectWorktree(mainWt.id)
    }

    const task = useTasksStore.getState().startTask(bundle.id, project.id, description, branchName)
    const createdSids: string[] = []
    for (const step of bundle.steps) {
      const sid = useSessionsStore.getState().addSession(project.id, step.type, wtId)
      createdSids.push(sid)
      useTasksStore.getState().addSessionToTask(task.id, sid)
    }

    // Set up pane with all created sessions
    const paneId = usePanesStore.getState().activePaneId
    for (const sid of createdSids) {
      usePanesStore.getState().addSessionToPane(paneId, sid)
    }
    useSessionsStore.getState().setActive(createdSids[0])
    onClose()

    // Send prompts after PTYs are ready
    for (let i = 0; i < bundle.steps.length; i++) {
      const step = bundle.steps[i]
      const sid = createdSids[i]
      const prompt = (step.prompt ?? '') + description
      if (!prompt) continue

      let attempts = 0
      const checkAndSend = (): void => {
        attempts++
        if (attempts > 30) return // give up after 15s
        const s = useSessionsStore.getState().sessions.find((x) => x.id === sid)
        if (s?.ptyId) {
          setTimeout(() => {
            const cur = useSessionsStore.getState().sessions.find((x) => x.id === sid)
            if (cur?.ptyId) window.api.session.write(cur.ptyId, prompt + '\n')
          }, 2000)
        } else {
          setTimeout(checkAndSend, 500)
        }
      }
      setTimeout(checkAndSend, 500)
    }
  }

  return createPortal(
    <>
      <div className="fixed inset-0 z-50" onClick={onClose} />
      <div className={OVERLAY_PANEL} style={{ width: 320 }}>
        <p className="mb-1 text-[var(--ui-font-sm)] font-medium text-[var(--color-text-primary)]">{bundle.name}</p>
        <p className="mb-3 text-[var(--ui-font-2xs)] text-[var(--color-text-tertiary)]">{bundle.description}</p>
        <input ref={ref} value={desc} onChange={(e) => setDesc(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') start(); if (e.key === 'Escape') onClose() }}
          placeholder="Task description..." className={cn(INPUT_CLS, 'mb-2')} />
        <input value={branchVal} onChange={(e) => setBranchVal(e.target.value)}
          placeholder="Branch name (optional)" className={cn(INPUT_CLS, 'mb-3')} />
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="rounded-[var(--radius-sm)] px-3 py-1 text-[var(--ui-font-sm)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-surface)]">Cancel</button>
          <button onClick={start} className="rounded-[var(--radius-sm)] bg-[var(--color-accent)] px-3 py-1 text-[var(--ui-font-sm)] text-white hover:opacity-90">Start</button>
        </div>
      </div>
    </>, document.body,
  )
}

// ── Branch Submenu (2-level hover) ──

function BranchSubmenu({ project, branchInfo, anchorRect, onClose, onMouseEnter, onMouseLeave }: {
  project: Project
  branchInfo: { current: string; branches: string[]; isDirty: boolean }
  anchorRect: DOMRect
  onClose: () => void
  onMouseEnter?: () => void
  onMouseLeave?: () => void
}): JSX.Element {
  const [showNewBranch, setShowNewBranch] = useState(false)
  const [confirmSwitch, setConfirmSwitch] = useState<string | null>(null)

  const doCheckout = async (branch: string): Promise<void> => {
    await useGitStore.getState().checkoutBranch(project.id, project.path, branch)
    onClose()
  }

  const handleBranchClick = async (branch: string): Promise<void> => {
    if (branch === branchInfo.current) return
    if (branchInfo.isDirty) {
      setConfirmSwitch(branch)
    } else {
      await doCheckout(branch)
    }
  }

  return (
    <>
      <div
        style={{ top: anchorRect.top, left: anchorRect.right + 2, zIndex: 9999 }}
        className="fixed w-48 rounded-[var(--radius-md)] py-1 border border-[var(--color-border)] bg-[var(--color-bg-tertiary)] shadow-lg shadow-black/30 max-h-[60vh] overflow-y-auto"
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
      >
        <button className={MENU_ITEM} onClick={() => { setShowNewBranch(true) }}>
          <PlusIcon size={12} /> New Branch...
        </button>
        <div className="border-t border-[var(--color-border)] my-0.5" />
        {branchInfo.branches.map((b) => (
          <button key={b} onClick={() => handleBranchClick(b)}
            className={cn('flex w-full items-center gap-2 px-3 py-1.5 text-[var(--ui-font-sm)] hover:bg-[var(--color-bg-surface)]',
              b === branchInfo.current ? 'text-[var(--color-accent)]' : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]')}>
            <GitBranch size={11} /><span className="truncate">{b}</span>
            {b === branchInfo.current && <span className="ml-auto text-[var(--ui-font-2xs)]">current</span>}
          </button>
        ))}
      </div>
      {showNewBranch && <NewBranchInput project={project} onClose={() => { setShowNewBranch(false); onClose() }} />}
      {confirmSwitch && createPortal(
        <>
          <div className="fixed inset-0 z-[200]" onClick={() => setConfirmSwitch(null)} />
          <div className={cn(OVERLAY_PANEL, 'z-[201]')} style={{ width: 340 }}>
            <p className="mb-1 text-[var(--ui-font-sm)] font-medium text-[var(--color-warning)]">Uncommitted Changes</p>
            <p className="mb-3 text-[var(--ui-font-xs)] text-[var(--color-text-secondary)]">
              You have uncommitted changes on <strong>{branchInfo.current}</strong>. Switching to <strong>{confirmSwitch}</strong> may cause conflicts or loss of changes.
            </p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setConfirmSwitch(null)}
                className="rounded-[var(--radius-sm)] px-3 py-1 text-[var(--ui-font-sm)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-surface)]">
                Cancel
              </button>
              <button onClick={() => { doCheckout(confirmSwitch) }}
                className="rounded-[var(--radius-sm)] bg-[var(--color-warning)] px-3 py-1 text-[var(--ui-font-sm)] text-white hover:opacity-90">
                Switch Anyway
              </button>
            </div>
          </div>
        </>, document.body,
      )}
    </>
  )
}

// ── Worktree Child Row ──

function WorktreeRow({ wt, project, isActive }: { wt: Worktree; project: Project; isActive: boolean }): JSX.Element {
  const [wtContextMenu, setWtContextMenu] = useState<{ x: number; y: number } | null>(null)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const branchInfo = useGitStore((s) => s.branchInfo[wt.id])

  useEffect(() => {
    useGitStore.getState().fetchStatus(wt.id, wt.path)
  }, [wt.id, wt.path])

  const isDirty = branchInfo?.isDirty ?? false

  const handleClick = useCallback(() => {
    switchProjectContext(project.id, null, wt.id)
  }, [wt.id, project.id])

  const handleRemoveWorktree = useCallback(async () => {
    // 1. Kill all PTY processes bound to this worktree first (release directory lock)
    const sessions = useSessionsStore.getState().sessions.filter((s) => s.worktreeId === wt.id)
    for (const s of sessions) {
      if (s.ptyId) {
        try { await window.api.session.kill(s.ptyId) } catch { /* ignore */ }
      }
    }
    // Wait briefly for processes to exit and release file handles
    await new Promise((r) => setTimeout(r, 500))

    // 2. Remove worktree directory
    try {
      await window.api.git.removeWorktree(project.path, wt.path)
    } catch {
      // may still fail if something else holds a lock
    }

    // 3. Clean up store
    for (const s of sessions) {
      const paneId = usePanesStore.getState().findPaneForSession(s.id)
      if (paneId) usePanesStore.getState().removeSessionFromPane(paneId, s.id)
      useSessionsStore.getState().removeSession(s.id)
    }
    useWorktreesStore.getState().removeWorktree(wt.id)

    // 4. Switch to main worktree of this project
    const wtStore = useWorktreesStore.getState()
    const mainWt = wtStore.getMainWorktree(project.id)
    if (mainWt) {
      wtStore.selectWorktree(mainWt.id)
      const mainSessions = useSessionsStore.getState().sessions.filter((s) =>
        s.projectId === project.id && (!s.worktreeId || s.worktreeId === mainWt.id),
      )
      const activeId = mainSessions.length > 0 ? mainSessions[0].id : null
      usePanesStore.getState().switchWorktree(mainWt.id, mainSessions.map((s) => s.id), activeId)
      if (activeId) useSessionsStore.getState().setActive(activeId)
    }

    setWtContextMenu(null)
  }, [wt.id, wt.path, project.id, project.path])

  return (
    <>
      <button
        onClick={handleClick}
        onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setWtContextMenu({ x: e.clientX, y: e.clientY }) }}
        className={cn(WT_ROW,
          isActive ? 'bg-[var(--color-accent-muted)] text-[var(--color-text-primary)]' : 'text-[var(--color-text-tertiary)] hover:bg-[var(--color-bg-tertiary)] hover:text-[var(--color-text-secondary)]',
        )}
      >
        <GitBranch size={10} className="shrink-0" />
        <span className="truncate">{wt.branch}</span>
        {isDirty && <div className="ml-0.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--color-warning)]" />}
      </button>

      {wtContextMenu && createPortal(
        <>
          <div className="fixed inset-0" style={{ zIndex: 9998 }} onClick={() => setWtContextMenu(null)} />
          <div style={{ top: wtContextMenu.y, left: wtContextMenu.x, zIndex: 9999 }}
            className="fixed min-w-[160px] rounded-[var(--radius-md)] py-1 border border-[var(--color-border)] bg-[var(--color-bg-tertiary)] shadow-lg shadow-black/30">
            {/* New Session */}
            <div className="px-3 py-1 border-b border-[var(--color-border)]">
              <p className={SECTION_HEADER}>New Session</p>
            </div>
            {SESSION_OPTS.map((opt) => (
              <button key={opt.type} className={MENU_ITEM} onClick={() => {
                handleClick()
                const sid = useSessionsStore.getState().addSession(project.id, opt.type, wt.id)
                usePanesStore.getState().addSessionToPane(usePanesStore.getState().activePaneId, sid)
                useSessionsStore.getState().setActive(sid)
                setWtContextMenu(null)
              }}>
                <img src={opt.icon} alt="" className="h-3.5 w-3.5" />{opt.label}
              </button>
            ))}
            <div className="border-t border-[var(--color-border)] mt-0.5" />
            <button onClick={() => { setWtContextMenu(null); window.api.shell.openPath(wt.path) }} className={MENU_ITEM}>
              <ExternalLink size={12} /> Open in Explorer
            </button>
            <button onClick={() => { setWtContextMenu(null); setConfirmRemove(true) }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-[var(--ui-font-sm)] text-[var(--color-error)] hover:bg-[var(--color-bg-surface)]">
              <Trash2 size={12} /> Remove Worktree
            </button>
          </div>
        </>, document.body,
      )}

      {confirmRemove && createPortal(
        <>
          <div className="fixed inset-0 z-[200]" onClick={() => setConfirmRemove(false)} />
          <div className={cn(OVERLAY_PANEL, 'z-[201]')} style={{ width: 340 }}>
            <p className="mb-1 text-[var(--ui-font-sm)] font-medium text-[var(--color-error)]">Remove Worktree</p>
            <p className="mb-1 text-[var(--ui-font-xs)] text-[var(--color-text-secondary)]">
              This will delete the directory and all sessions for <strong>{wt.branch}</strong>.
            </p>
            <p className="mb-3 truncate text-[var(--ui-font-2xs)] text-[var(--color-text-tertiary)]">{wt.path}</p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setConfirmRemove(false)}
                className="rounded-[var(--radius-sm)] px-3 py-1 text-[var(--ui-font-sm)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-surface)]">
                Cancel
              </button>
              <button onClick={() => { setConfirmRemove(false); handleRemoveWorktree() }}
                className="rounded-[var(--radius-sm)] bg-[var(--color-error)] px-3 py-1 text-[var(--ui-font-sm)] text-white hover:opacity-90">
                Remove
              </button>
            </div>
          </div>
        </>, document.body,
      )}
    </>
  )
}

// ── Main Component ──

interface ProjectItemProps { project: Project }

export function ProjectItem({ project }: ProjectItemProps): JSX.Element {
  const isAnonymous = isAnonymousProject(project)
  const selectedProjectId = useProjectsStore((s) => s.selectedProjectId)
  const selectProject = useProjectsStore((s) => s.selectProject)
  const removeProject = useProjectsStore((s) => s.removeProject)
  const removeProjectFromGroup = useGroupsStore((s) => s.removeProjectFromGroup)
  const allSessions = useSessionsStore((s) => s.sessions)
  const outputStates = useSessionsStore((s) => s.outputStates)
  const addSession = useSessionsStore((s) => s.addSession)
  const setActive = useSessionsStore((s) => s.setActive)
  const allGroups = useGroupsStore((s) => s.groups)
  const addProjectToGroup = useGroupsStore((s) => s.addProjectToGroup)
  const removeProjectFromGroupFn = useGroupsStore((s) => s.removeProjectFromGroup)
  const moveProject = useProjectsStore((s) => s.moveProject)
  const reorderProjectInGroup = useGroupsStore((s) => s.reorderProjectInGroup)
  const moveProjectToGroupAt = useGroupsStore((s) => s.moveProjectToGroupAt)

  const branchInfo = useGitStore((s) => s.branchInfo[project.id])
  const templates = useTemplatesStore((s) => s.templates)
  const bundles = useTasksStore((s) => s.bundles)

  const allWorktrees = useWorktreesStore((s) => s.worktrees)
  const selectedWorktreeId = useWorktreesStore((s) => s.selectedWorktreeId)
  const worktrees = useMemo(() => allWorktrees.filter((w) => w.projectId === project.id), [allWorktrees, project.id])

  const [expanded, setExpanded] = useState(false)
  const [showMenu, setShowMenu] = useState<{ x: number; y: number } | null>(null)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null)
  const [showNewBranch, setShowNewBranch] = useState(false)
  const [showNewWorktree, setShowNewWorktree] = useState(false)
  const [showLaunchMenu, setShowLaunchMenu] = useState<{ x: number; y: number } | null>(null)
  const [taskDialog, setTaskDialog] = useState<TaskBundle | null>(null)
  const [projDragOver, setProjDragOver] = useState(false)
  const [branchSubmenuAnchor, setBranchSubmenuAnchor] = useState<DOMRect | null>(null)
  const branchMenuRef = useRef<HTMLButtonElement>(null)
  const branchCloseTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const openBranchSub = useCallback(() => {
    if (branchCloseTimer.current) { clearTimeout(branchCloseTimer.current); branchCloseTimer.current = null }
    if (branchMenuRef.current) setBranchSubmenuAnchor(branchMenuRef.current.getBoundingClientRect())
  }, [])

  const scheduleBranchClose = useCallback(() => {
    branchCloseTimer.current = setTimeout(() => setBranchSubmenuAnchor(null), 150)
  }, [])

  const cancelBranchClose = useCallback(() => {
    if (branchCloseTimer.current) { clearTimeout(branchCloseTimer.current); branchCloseTimer.current = null }
  }, [])

  const nonMainWorktrees = useMemo(
    () => (isAnonymous ? [] : worktrees.filter((w) => !w.isMain)),
    [isAnonymous, worktrees],
  )
  const hasWorktreeChildren = nonMainWorktrees.length > 0
  const mainWorktree = useMemo(() => worktrees.find((w) => w.isMain), [worktrees])

  const sessions = useMemo(() => allSessions.filter((s) => s.projectId === project.id), [allSessions, project.id])
  const otherGroups = useMemo(
    () => (isAnonymous ? [] : allGroups.filter((g) => g.id !== project.groupId)),
    [allGroups, isAnonymous, project.groupId],
  )
  const matchingTemplates = useMemo(() => templates.filter((t) => t.projectId === null || t.projectId === project.id), [templates, project.id])

  useEffect(() => {
    if (isAnonymous) return
    useGitStore.getState().fetchStatus(project.id, project.path)
    useGitStore.getState().fetchWorktrees(project.id, project.path)
  }, [isAnonymous, project.id, project.path])

  // Ensure main worktree exists once branch info is available
  useEffect(() => {
    if (!isAnonymous && branchInfo) {
      useWorktreesStore.getState().ensureMainWorktree(project.id, project.path, branchInfo.current)
    }
  }, [branchInfo, isAnonymous, project.id, project.path])

  const isSelected = selectedProjectId === project.id
  const isMainWtActive = isSelected && (!selectedWorktreeId || selectedWorktreeId === mainWorktree?.id)
  const hasUnread = sessions.some((s) => outputStates[s.id] === 'unread')
  const hasOutputting = sessions.some((s) => outputStates[s.id] === 'outputting')

  const handleSelect = useCallback(() => {
    if (isMainWtActive) return
    switchProjectContext(project.id, null, null)
  }, [isMainWtActive, project.id])

  const handleRemove = useCallback(() => {
    if (isAnonymous) {
      void removeAnonymousProject()
    } else {
      removeProjectFromGroup(project.groupId, project.id)
      removeProject(project.id)
    }
    setShowMenu(null)
  }, [isAnonymous, project.groupId, project.id, removeProject, removeProjectFromGroup])

  const handleApplyTemplate = useCallback((tid: string) => {
    const t = useTemplatesStore.getState().templates.find((x) => x.id === tid)
    if (!t) return
    selectProject(project.id)
    const wtId = undefined
    const paneId = usePanesStore.getState().activePaneId
    for (const item of t.items) {
      const sid = addSession(project.id, item.type, wtId)
      usePanesStore.getState().addSessionToPane(paneId, sid)
      setActive(sid)
    }
    setContextMenu(null)
  }, [project.id, selectProject, addSession, setActive])

  const handleToggleExpand = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    if (hasWorktreeChildren) setExpanded((prev) => !prev)
  }, [hasWorktreeChildren])

  const handleRowDoubleClick = useCallback(() => {
    if (hasWorktreeChildren) setExpanded((prev) => !prev)
  }, [hasWorktreeChildren])

  return (
    <div className="relative">
      {/* Main project row */}
      <div
        draggable={!isAnonymous}
        onDragStart={(e) => {
          if (isAnonymous) return
          e.dataTransfer.setData('project-id', project.id)
          e.dataTransfer.setData('source-group', project.groupId)
          e.dataTransfer.effectAllowed = 'move'
        }}
        className={cn(
          'group flex h-8 cursor-pointer items-center gap-1 pl-2 pr-2 transition-colors duration-75',
          isMainWtActive
            ? 'bg-[var(--color-accent)]/10 text-[var(--color-text-primary)] border-l-2 border-l-[var(--color-accent)]'
            : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-tertiary)] hover:text-[var(--color-text-primary)] border-l-2 border-l-transparent',
          projDragOver && 'border-t border-t-[var(--color-accent)]',
        )}
        onClick={handleSelect}
        onDoubleClick={handleRowDoubleClick}
        onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setContextMenu({ x: e.clientX, y: e.clientY }) }}
        onDragOver={(e) => {
          if (isAnonymous) return
          if (e.dataTransfer.types.includes('project-id')) {
            e.preventDefault()
            e.dataTransfer.dropEffect = 'move'
            setProjDragOver(true)
          }
        }}
        onDragLeave={() => {
          if (isAnonymous) return
          setProjDragOver(false)
        }}
        onDrop={(e) => {
          if (isAnonymous) return
          e.stopPropagation(); setProjDragOver(false)
          const did = e.dataTransfer.getData('project-id'), sg = e.dataTransfer.getData('source-group')
          if (!did || did === project.id) return
          if (sg === project.groupId) { reorderProjectInGroup(project.groupId, did, project.id) }
          else { moveProjectToGroupAt(did, sg, project.groupId, project.id); moveProject(did, project.groupId) }
        }}
      >
        {/* Expand/collapse chevron */}
        <button onClick={handleToggleExpand} className={cn('flex h-4 w-4 shrink-0 items-center justify-center', hasWorktreeChildren ? 'cursor-pointer' : 'cursor-default opacity-0')}>
          <ChevronRight size={11} className={cn('transition-transform duration-100', expanded && 'rotate-90')} />
        </button>

        <Folder size={14} className={cn('shrink-0', isMainWtActive ? 'text-[var(--color-accent)]' : 'text-[var(--color-text-tertiary)]')} />
        <span className="flex-1 truncate text-[var(--ui-font-sm)] font-medium">{project.name}</span>

        {/* Status indicators */}
        {hasOutputting && <div className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-[var(--color-accent)]" />}
        {hasUnread && !hasOutputting && <div className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--color-warning)]" />}

        {/* Branch badge */}
        {!isAnonymous && branchInfo && (
          <span className={cn(
            'flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5',
            'text-[9px] leading-none',
            branchInfo.isDirty
              ? 'bg-[var(--color-warning)]/15 text-[var(--color-warning)]'
              : 'bg-[var(--color-bg-surface)] text-[var(--color-text-tertiary)]',
          )}>
            <GitBranch size={9} />
            <span className="max-w-[60px] truncate">{branchInfo.current}</span>
          </span>
        )}

        <button onClick={(e) => { e.stopPropagation(); const r = e.currentTarget.getBoundingClientRect(); setShowMenu(showMenu ? null : { x: r.right, y: r.bottom + 4 }) }}
          className={cn('flex h-5 w-5 items-center justify-center rounded-[var(--radius-sm)]', 'text-[var(--color-text-tertiary)] opacity-0 group-hover:opacity-100', 'hover:bg-[var(--color-bg-surface)] transition-all duration-75')}>
          <MoreHorizontal size={12} />
        </button>
      </div>

      {/* Worktree children (when expanded) */}
      {expanded && hasWorktreeChildren && nonMainWorktrees.map((wt) => (
        <WorktreeRow
          key={wt.id}
          wt={wt}
          project={project}
          isActive={isSelected && selectedWorktreeId === wt.id}
        />
      ))}

      {/* Three-dot menu */}
      {showMenu && createPortal(
        <>
          <div className="fixed inset-0" style={{ zIndex: 9998 }} onClick={() => setShowMenu(null)} />
          <div style={{ top: showMenu.y, left: showMenu.x, zIndex: 9999 }}
            className={cn('fixed min-w-[160px] rounded-[var(--radius-md)] py-1', 'border border-[var(--color-border)] bg-[var(--color-bg-tertiary)] shadow-lg shadow-black/30')}>
            <div className="border-b border-[var(--color-border)] px-3 py-1.5">
              <p className="truncate text-[var(--ui-font-2xs)] text-[var(--color-text-tertiary)]">{project.path}</p>
            </div>
            <button onClick={() => { setShowMenu(null); window.api.shell.openPath(project.path) }} className={MENU_ITEM}>
              <ExternalLink size={12} /> Open in Explorer
            </button>
            <button onClick={() => { setShowMenu(null); handleRemove() }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-[var(--ui-font-sm)] text-[var(--color-error)] hover:bg-[var(--color-bg-surface)]">
              <Trash2 size={12} /> Remove
            </button>
          </div>
        </>, document.body,
      )}

      {/* Right-click context menu */}
      {contextMenu && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => { setContextMenu(null); setBranchSubmenuAnchor(null) }} />
          <div
            ref={(el) => {
              if (!el) return
              const rect = el.getBoundingClientRect()
              const vh = window.innerHeight
              const vw = window.innerWidth
              if (rect.bottom > vh) el.style.top = `${Math.max(4, vh - rect.height - 4)}px`
              if (rect.right > vw) el.style.left = `${Math.max(4, vw - rect.width - 4)}px`
            }}
            style={{ top: contextMenu.y, left: contextMenu.x }}
            className={cn('fixed z-50 w-52 rounded-[var(--radius-md)] py-1', 'border border-[var(--color-border)] bg-[var(--color-bg-tertiary)] shadow-lg shadow-black/30 max-h-[80vh] overflow-y-auto')}>

            {/* New Session */}
            <div className="px-3 py-1 border-b border-[var(--color-border)]">
              <p className={SECTION_HEADER}>New Session</p>
            </div>
            {SESSION_OPTS.map((opt) => (
              <button key={opt.type} className={MENU_ITEM} onClick={() => {
                selectProject(project.id)
                const id = addSession(project.id, opt.type, getDefaultWorktreeIdForProject(project.id))
                usePanesStore.getState().addSessionToPane(usePanesStore.getState().activePaneId, id)
                setActive(id); setContextMenu(null)
              }}>
                <img src={opt.icon} alt="" className="h-3.5 w-3.5" />{opt.label}
              </button>
            ))}

            {!isAnonymous && (
              <>
                {/* Git section */}
                <SectionDivider icon={GitBranch} label="Git" />
                {branchInfo && branchInfo.current ? (
                  <>
                    <button
                      ref={branchMenuRef}
                      className={cn(MENU_ITEM, 'justify-between')}
                      onMouseEnter={openBranchSub}
                      onMouseLeave={scheduleBranchClose}
                    >
                      <span className="flex items-center gap-2"><GitBranch size={11} /> Branches</span>
                      <ChevronRight size={12} />
                    </button>
                    <button className={MENU_ITEM} onClick={() => { setContextMenu(null); setShowNewWorktree(true) }}>
                      <PlusIcon size={12} /> New Worktree...
                    </button>
                  </>
                ) : (
                  <button className={MENU_ITEM} onClick={async () => {
                    setContextMenu(null)
                    await window.api.git.init(project.path)
                    await useGitStore.getState().fetchStatus(project.id, project.path)
                  }}>
                    <PlusIcon size={12} /> Initialize Repository
                  </button>
                )}
              </>
            )}

            {/* Run */}
            <SectionDivider icon={Play} label="Run" />
            <button className={MENU_ITEM} onClick={() => {
              setContextMenu(null)
              setShowLaunchMenu(contextMenu)
            }}>
              <Play size={11} /> Launch Profiles...
            </button>

            {/* Apply Template */}
            {matchingTemplates.length > 0 && (
              <>
                <SectionDivider icon={Layers} label="Apply Template" />
                {matchingTemplates.map((t) => (
                  <button key={t.id} className={MENU_ITEM} onClick={() => handleApplyTemplate(t.id)}>
                    <Layers size={11} /><span className="truncate">{t.name}</span>
                    <span className="ml-auto text-[var(--ui-font-2xs)] text-[var(--color-text-tertiary)]">{t.items.length}</span>
                  </button>
                ))}
              </>
            )}

            {/* Start Task */}
            {bundles.length > 0 && (
              <>
                <SectionDivider icon={Rocket} label="Start Task" />
                {bundles.map((b) => (
                  <button key={b.id} className={MENU_ITEM} onClick={() => { setContextMenu(null); setTaskDialog(b) }}>
                    <Rocket size={11} /><span className="truncate">{b.name}</span>
                    <span className="ml-auto text-[var(--ui-font-2xs)] text-[var(--color-text-tertiary)]">{b.steps.length} steps</span>
                  </button>
                ))}
              </>
            )}

            {/* Move to */}
            {!isAnonymous && otherGroups.length > 0 && (
              <>
                <SectionDivider icon={ArrowRightLeft} label="Move to" />
                {otherGroups.map((g) => (
                  <button key={g.id} className={MENU_ITEM} onClick={() => {
                    removeProjectFromGroupFn(project.groupId, project.id); addProjectToGroup(g.id, project.id)
                    moveProject(project.id, g.id); setContextMenu(null)
                  }}>
                    <div className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: g.color }} />{g.name}
                  </button>
                ))}
              </>
            )}

            {/* Remove + Open in Explorer */}
            <div className="border-t border-[var(--color-border)] mt-0.5" />
            <button onClick={() => { setContextMenu(null); window.api.shell.openPath(project.path) }} className={MENU_ITEM}>
              <ExternalLink size={12} /> Open in Explorer
            </button>
            <button onClick={() => { setContextMenu(null); handleRemove() }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-[var(--ui-font-sm)] text-[var(--color-error)] hover:bg-[var(--color-bg-surface)]">
              <Trash2 size={12} /> Remove
            </button>
          </div>

          {/* Branch submenu (hover popup) */}
          {!isAnonymous && branchSubmenuAnchor && branchInfo && (
            <BranchSubmenu
              project={project}
              branchInfo={branchInfo}
              anchorRect={branchSubmenuAnchor}
              onClose={() => { setBranchSubmenuAnchor(null); setContextMenu(null) }}
              onMouseEnter={cancelBranchClose}
              onMouseLeave={scheduleBranchClose}
            />
          )}
        </>
      )}

      {showNewBranch && <NewBranchInput project={project} onClose={() => setShowNewBranch(false)} />}
      {showNewWorktree && <NewWorktreeDialog project={project} onClose={() => setShowNewWorktree(false)} />}
      {taskDialog && <TaskStartDialog bundle={taskDialog} project={project} onClose={() => setTaskDialog(null)} />}
      {showLaunchMenu && <LaunchMenu projectId={project.id} projectPath={project.path} position={showLaunchMenu} onClose={() => setShowLaunchMenu(null)} />}
    </div>
  )
}
