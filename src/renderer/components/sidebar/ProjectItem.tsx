import { ArrowRightLeft, ChevronRight, ExternalLink, Eye, Folder, FolderOpen, GitBranch, Layers, List, MoreHorizontal, Play, Plus as PlusIcon, Rocket, Trash2 } from 'lucide-react'
import { createPortal } from 'react-dom'
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import type { Group, Project, SessionType, TaskBundle, Worktree } from '@shared/types'
import { getDefaultWorktreeIdForProject, switchProjectContext } from '@/lib/project-context'
import { createSessionWithPrompt } from '@/lib/createSession'
import { cn } from '@/lib/utils'
import { useProjectsStore } from '@/stores/projects'
import { normalizeGroupColor, useGroupsStore } from '@/stores/groups'
import { useSessionsStore } from '@/stores/sessions'
import { usePanesStore } from '@/stores/panes'
import { useGitStore } from '@/stores/git'
import { useTemplatesStore } from '@/stores/templates'
import { useTasksStore } from '@/stores/tasks'
import { useWorktreesStore } from '@/stores/worktrees'
import { useLaunchesStore } from '@/stores/launches'
import { useUIStore } from '@/stores/ui'
import { LaunchMenu } from './LaunchMenu'
import { buildNewSessionOptions, type NewSessionOption } from '@/components/session/NewSessionMenu'
import { SessionIconView } from '@/components/session/SessionIconView'
const MENU_ITEM = 'group/menuitem relative flex w-full h-8.5 items-center gap-3 px-3 rounded-[var(--radius-md)] text-[13px] text-[var(--color-text-secondary)] hover:bg-[var(--color-accent)]/15 hover:text-white transition-all duration-200'
const SECTION_HEADER = 'text-[10px] font-black uppercase tracking-[0.2em] text-[var(--color-text-tertiary)] opacity-60'
const INPUT_CLS = 'w-full rounded-[var(--radius-md)] border border-white/[0.1] bg-black/20 px-3 py-1.5 text-[var(--ui-font-sm)] text-white outline-none focus:bg-black/40 transition-all duration-200'
const OVERLAY_PANEL = 'fixed left-1/2 top-1/3 z-50 -translate-x-1/2 rounded-[var(--radius-lg)] border border-white/[0.08] bg-[var(--color-bg-secondary)]/95 backdrop-blur-3xl p-5 shadow-[0_24px_64px_rgba(0,0,0,0.8),inset_0_1px_1px_rgba(255,255,255,0.05)] animate-in fade-in zoom-in-95 duration-200'
const WT_ROW = 'group/wt relative flex h-7.5 w-full cursor-pointer items-center gap-2 pl-8 pr-3 text-[12px] transition-all duration-200'

type ProjectContextSubmenuType = 'sessions' | 'tasks' | 'move'

interface ProjectContextSubmenuState {
  type: ProjectContextSubmenuType
  anchorRect: DOMRect
}

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

function getSubmenuStyle(anchorRect: DOMRect, width: number): { top: number; left: number; width: number; zIndex: number } {
  const gap = 2
  const left = anchorRect.right + gap + width > window.innerWidth - 4
    ? Math.max(4, anchorRect.left - width - gap)
    : anchorRect.right + gap
  const top = Math.max(4, Math.min(anchorRect.top, window.innerHeight - 4))
  return { top, left, width, zIndex: 9999 }
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
        <p className="mb-2 text-[var(--ui-font-sm)] text-[var(--color-text-secondary)]">从当前 HEAD 新建分支</p>
        <input ref={ref} value={value} onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') onClose() }}
          placeholder="分支名称" className={INPUT_CLS} />
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
        <p className="mb-2 text-[var(--ui-font-sm)] font-medium text-[var(--color-text-primary)]">新建工作树</p>
        <input ref={ref} value={branch} onChange={(e) => setBranch(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') onClose() }}
          placeholder="分支名称" className={cn(INPUT_CLS, 'mb-2')} />
        {targetPath && (
          <p className="mb-3 truncate text-[var(--ui-font-2xs)] text-[var(--color-text-tertiary)]">{targetPath}</p>
        )}
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="rounded-[var(--radius-sm)] px-3 py-1 text-[var(--ui-font-sm)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-surface)]">取消</button>
          <button onClick={submit} disabled={!branch.trim()} className="rounded-[var(--radius-sm)] bg-[var(--color-accent)] px-3 py-1 text-[var(--ui-font-sm)] text-white hover:opacity-90 disabled:opacity-40">创建</button>
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
          placeholder="任务描述..." className={cn(INPUT_CLS, 'mb-2')} />
        <input value={branchVal} onChange={(e) => setBranchVal(e.target.value)}
          placeholder="分支名称（可选）" className={cn(INPUT_CLS, 'mb-3')} />
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="rounded-[var(--radius-sm)] px-3 py-1 text-[var(--ui-font-sm)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-surface)]">取消</button>
          <button onClick={start} className="rounded-[var(--radius-sm)] bg-[var(--color-accent)] px-3 py-1 text-[var(--ui-font-sm)] text-white hover:opacity-90">开始</button>
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
          <PlusIcon size={12} /> 新建分支...
        </button>
        <div className="border-t border-[var(--color-border)] my-0.5" />
        {branchInfo.branches.map((b) => (
          <button key={b} onClick={() => handleBranchClick(b)}
            className={cn('flex w-full items-center gap-2 px-3 py-1.5 text-[var(--ui-font-sm)] hover:bg-[var(--color-bg-surface)]',
              b === branchInfo.current ? 'text-[var(--color-accent)]' : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]')}>
            <GitBranch size={11} /><span className="truncate">{b}</span>
            {b === branchInfo.current && <span className="ml-auto text-[var(--ui-font-2xs)]">当前</span>}
          </button>
        ))}
      </div>
      {showNewBranch && <NewBranchInput project={project} onClose={() => { setShowNewBranch(false); onClose() }} />}
      {confirmSwitch && createPortal(
        <>
          <div className="fixed inset-0 z-[200]" onClick={() => setConfirmSwitch(null)} />
          <div className={cn(OVERLAY_PANEL, 'z-[201]')} style={{ width: 340 }}>
            <p className="mb-1 text-[var(--ui-font-sm)] font-medium text-[var(--color-warning)]">未提交的更改</p>
            <p className="mb-3 text-[var(--ui-font-xs)] text-[var(--color-text-secondary)]">
              分支 <strong>{branchInfo.current}</strong> 上有未提交的更改。切换到 <strong>{confirmSwitch}</strong> 可能导致冲突或丢失更改。
            </p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setConfirmSwitch(null)}
                className="rounded-[var(--radius-sm)] px-3 py-1 text-[var(--ui-font-sm)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-surface)]">
                取消
              </button>
              <button onClick={() => { doCheckout(confirmSwitch) }}
                className="rounded-[var(--radius-sm)] bg-[var(--color-warning)] px-3 py-1 text-[var(--ui-font-sm)] text-white hover:opacity-90">
                仍然切换
              </button>
            </div>
          </div>
        </>, document.body,
      )}
    </>
  )
}

function ProjectContextSubmenu({ submenu, bundles, groups, onCreateSession, onStartTask, onMoveToGroup, onMouseEnter, onMouseLeave }: {
  submenu: ProjectContextSubmenuState
  bundles: TaskBundle[]
  groups: Group[]
  onCreateSession: (option: NewSessionOption) => void
  onStartTask: (bundle: TaskBundle) => void
  onMoveToGroup: (groupId: string) => void
  onMouseEnter: () => void
  onMouseLeave: () => void
}): JSX.Element | null {
  const width = submenu.type === 'sessions' ? 196 : 220
  const style = getSubmenuStyle(submenu.anchorRect, width)
  const customSessionDefinitions = useUIStore((s) => s.settings.customSessionDefinitions)
  const hiddenNewSessionOptionIds = useUIStore((s) => s.settings.hiddenNewSessionOptionIds)
  const newSessionOptionOrder = useUIStore((s) => s.settings.newSessionOptionOrder)
  const sessionOptions = buildNewSessionOptions(customSessionDefinitions, hiddenNewSessionOptionIds, newSessionOptionOrder)

  if (submenu.type === 'sessions') {
    return (
      <div
        style={style}
        className="fixed max-h-[60vh] overflow-y-auto rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg-tertiary)] py-1 shadow-lg shadow-black/30"
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
      >
        {sessionOptions.length === 0 ? (
          <div className="px-3 py-2 text-[var(--ui-font-xs)] text-[var(--color-text-tertiary)]">
            没有可显示的会话类型
          </div>
        ) : sessionOptions.map((opt) => (
          <button key={opt.id} className={MENU_ITEM} onClick={() => onCreateSession(opt)}>
            <SessionIconView
              icon={opt.customSessionDefinitionId ? opt.icon : undefined}
              fallbackSrc={opt.customSessionDefinitionId ? undefined : opt.icon}
              className="h-3.5 w-3.5"
              imageClassName="h-3.5 w-3.5"
            />
            {opt.label}
          </button>
        ))}
      </div>
    )
  }

  if (submenu.type === 'tasks') {
    if (bundles.length === 0) return null
    return (
      <div
        style={style}
        className="fixed max-h-[60vh] overflow-y-auto rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg-tertiary)] py-1 shadow-lg shadow-black/30"
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
      >
        {bundles.map((bundle) => (
          <button key={bundle.id} className={MENU_ITEM} onClick={() => onStartTask(bundle)}>
            <Rocket size={11} />
            <span className="truncate">{bundle.name}</span>
            <span className="ml-auto text-[var(--ui-font-2xs)] text-[var(--color-text-tertiary)]">{bundle.steps.length} 步</span>
          </button>
        ))}
      </div>
    )
  }

  if (groups.length === 0) return null
  return (
    <div
      style={style}
      className="fixed max-h-[60vh] overflow-y-auto rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg-tertiary)] py-1 shadow-lg shadow-black/30"
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      {groups.map((group) => (
        <button key={group.id} className={MENU_ITEM} onClick={() => onMoveToGroup(group.id)}>
          <div className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: group.color }} />
          <span className="truncate">{group.name}</span>
        </button>
      ))}
    </div>
  )
}

// ── Worktree Child Row ──

function WorktreeRow({ wt, project, isActive }: { wt: Worktree; project: Project; isActive: boolean }): JSX.Element {
  const [wtContextMenu, setWtContextMenu] = useState<{ x: number; y: number } | null>(null)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const customSessionDefinitions = useUIStore((s) => s.settings.customSessionDefinitions)
  const hiddenNewSessionOptionIds = useUIStore((s) => s.settings.hiddenNewSessionOptionIds)
  const newSessionOptionOrder = useUIStore((s) => s.settings.newSessionOptionOrder)
  const sessionOptions = buildNewSessionOptions(customSessionDefinitions, hiddenNewSessionOptionIds, newSessionOptionOrder)
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
            {/* 新建会话 */}
            <div className="px-3 py-1 border-b border-[var(--color-border)]">
              <p className={SECTION_HEADER}>新建会话</p>
            </div>
            {sessionOptions.length === 0 ? (
              <div className="px-3 py-2 text-[var(--ui-font-xs)] text-[var(--color-text-tertiary)]">
                没有可显示的会话类型
              </div>
            ) : sessionOptions.map((opt) => (
              <button key={opt.id} className={MENU_ITEM} onClick={() => {
                handleClick()
                setWtContextMenu(null)
                createSessionWithPrompt({
                  projectId: project.id,
                  type: opt.type,
                  customSessionDefinitionId: opt.customSessionDefinitionId,
                  worktreeId: wt.id,
                }, (sid) => {
                  usePanesStore.getState().addSessionToPane(usePanesStore.getState().activePaneId, sid)
                  useSessionsStore.getState().setActive(sid)
                })
              }}>
                <SessionIconView
                  icon={opt.customSessionDefinitionId ? opt.icon : undefined}
                  fallbackSrc={opt.customSessionDefinitionId ? undefined : opt.icon}
                  className="h-3.5 w-3.5"
                  imageClassName="h-3.5 w-3.5"
                />
                {opt.label}
              </button>
            ))}
            <div className="border-t border-[var(--color-border)] mt-0.5" />
            <button onClick={() => { setWtContextMenu(null); window.api.shell.openPath(wt.path) }} className={MENU_ITEM}>
              <ExternalLink size={12} /> 在资源管理器中打开
            </button>
            <button onClick={() => { setWtContextMenu(null); setConfirmRemove(true) }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-[var(--ui-font-sm)] text-[var(--color-error)] hover:bg-[var(--color-bg-surface)]">
              <Trash2 size={12} /> 移除工作树
            </button>
          </div>
        </>, document.body,
      )}

      {confirmRemove && createPortal(
        <>
          <div className="fixed inset-0 z-[200]" onClick={() => setConfirmRemove(false)} />
          <div className={cn(OVERLAY_PANEL, 'z-[201]')} style={{ width: 340 }}>
            <p className="mb-1 text-[var(--ui-font-sm)] font-medium text-[var(--color-error)]">移除工作树</p>
            <p className="mb-1 text-[var(--ui-font-xs)] text-[var(--color-text-secondary)]">
              这将删除 <strong>{wt.branch}</strong> 的目录及其所有会话。
            </p>
            <p className="mb-3 truncate text-[var(--ui-font-2xs)] text-[var(--color-text-tertiary)]">{wt.path}</p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setConfirmRemove(false)}
                className="rounded-[var(--radius-sm)] px-3 py-1 text-[var(--ui-font-sm)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-surface)]">
                取消
              </button>
              <button onClick={() => { setConfirmRemove(false); handleRemoveWorktree() }}
                className="rounded-[var(--radius-sm)] bg-[var(--color-error)] px-3 py-1 text-[var(--ui-font-sm)] text-white hover:opacity-90">
                移除
              </button>
            </div>
          </div>
        </>, document.body,
      )}
    </>
  )
}

// ── Main Component ──

interface ProjectItemProps {
  project: Project
  groupColor?: string
  onOpenProject?: (projectId: string) => void
}

export function ProjectItem({ project, groupColor, onOpenProject }: ProjectItemProps): JSX.Element {
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
  const visibleProjectId = useUIStore((s) => s.settings.visibleProjectId)
  const updateSettings = useUIStore((s) => s.updateSettings)

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
  const [projectSubmenu, setProjectSubmenu] = useState<ProjectContextSubmenuState | null>(null)
  const branchMenuRef = useRef<HTMLButtonElement>(null)
  const branchCloseTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const projectSubmenuCloseTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const openProjectSubmenu = useCallback((type: ProjectContextSubmenuType, anchor: HTMLElement) => {
    if (projectSubmenuCloseTimer.current) {
      clearTimeout(projectSubmenuCloseTimer.current)
      projectSubmenuCloseTimer.current = null
    }
    if (branchCloseTimer.current) {
      clearTimeout(branchCloseTimer.current)
      branchCloseTimer.current = null
    }
    setBranchSubmenuAnchor(null)
    setProjectSubmenu({ type, anchorRect: anchor.getBoundingClientRect() })
  }, [])

  const scheduleProjectSubmenuClose = useCallback(() => {
    projectSubmenuCloseTimer.current = setTimeout(() => setProjectSubmenu(null), 150)
  }, [])

  const cancelProjectSubmenuClose = useCallback(() => {
    if (projectSubmenuCloseTimer.current) {
      clearTimeout(projectSubmenuCloseTimer.current)
      projectSubmenuCloseTimer.current = null
    }
  }, [])

  const closeContextMenu = useCallback(() => {
    setContextMenu(null)
    setBranchSubmenuAnchor(null)
    setProjectSubmenu(null)
  }, [])

  const openBranchSub = useCallback(() => {
    if (branchCloseTimer.current) { clearTimeout(branchCloseTimer.current); branchCloseTimer.current = null }
    if (projectSubmenuCloseTimer.current) { clearTimeout(projectSubmenuCloseTimer.current); projectSubmenuCloseTimer.current = null }
    setProjectSubmenu(null)
    if (branchMenuRef.current) setBranchSubmenuAnchor(branchMenuRef.current.getBoundingClientRect())
  }, [])

  const scheduleBranchClose = useCallback(() => {
    branchCloseTimer.current = setTimeout(() => setBranchSubmenuAnchor(null), 150)
  }, [])

  const cancelBranchClose = useCallback(() => {
    if (branchCloseTimer.current) { clearTimeout(branchCloseTimer.current); branchCloseTimer.current = null }
  }, [])

  useEffect(() => () => {
    if (branchCloseTimer.current) clearTimeout(branchCloseTimer.current)
    if (projectSubmenuCloseTimer.current) clearTimeout(projectSubmenuCloseTimer.current)
  }, [])

  const nonMainWorktrees = useMemo(
    () => worktrees.filter((w) => !w.isMain),
    [worktrees],
  )
  const hasWorktreeChildren = nonMainWorktrees.length > 0
  const mainWorktree = useMemo(() => worktrees.find((w) => w.isMain), [worktrees])

  const sessions = useMemo(() => allSessions.filter((s) => s.projectId === project.id), [allSessions, project.id])
  const runningSessionCount = useMemo(() => sessions.filter((s) => s.status === 'running').length, [sessions])
  const otherGroups = useMemo(
    () => allGroups.filter((g) => g.id !== project.groupId),
    [allGroups, project.groupId],
  )
  const effectiveGroupColor = useMemo(() => {
    const color = groupColor ?? allGroups.find((group) => group.id === project.groupId)?.color
    return color ? normalizeGroupColor(color) : null
  }, [allGroups, groupColor, project.groupId])
  const projectHoverStyle = useMemo(() => ({
    '--project-hover-bg': effectiveGroupColor ? `${effectiveGroupColor}1f` : 'var(--color-bg-surface)',
    '--project-hover-border': effectiveGroupColor ? `${effectiveGroupColor}42` : 'transparent',
    '--project-hover-glow': effectiveGroupColor ? `${effectiveGroupColor}18` : 'transparent',
    '--project-hover-icon': effectiveGroupColor ?? 'var(--color-text-secondary)',
    '--project-selected-bg': effectiveGroupColor ? `${effectiveGroupColor}26` : 'var(--color-accent-muted)',
    '--project-selected-border': effectiveGroupColor ? `${effectiveGroupColor}5c` : 'var(--color-accent)',
    '--project-selected-glow': effectiveGroupColor ? `${effectiveGroupColor}22` : 'var(--color-accent-muted)',
    '--project-selected-color': effectiveGroupColor ?? 'var(--color-accent)',
  }) as CSSProperties, [effectiveGroupColor])
  const matchingTemplates = useMemo(() => templates.filter((t) => t.projectId === null || t.projectId === project.id), [templates, project.id])

  useEffect(() => {
    useGitStore.getState().fetchStatus(project.id, project.path)
    useGitStore.getState().fetchWorktrees(project.id, project.path)
  }, [project.id, project.path])

  // Ensure main worktree exists once branch info is available
  useEffect(() => {
    if (branchInfo) {
      useWorktreesStore.getState().ensureMainWorktree(project.id, project.path, branchInfo.current)
    }
  }, [branchInfo, project.id, project.path])

  const isSelected = selectedProjectId === project.id
  const isMainWtActive = isSelected && (!selectedWorktreeId || selectedWorktreeId === mainWorktree?.id)
  const hasUnread = sessions.some((s) => outputStates[s.id] === 'unread')
  const hasOutputting = sessions.some((s) => outputStates[s.id] === 'outputting')

  const handleSelect = useCallback(() => {
    if (isMainWtActive) return
    switchProjectContext(project.id, null, null)
  }, [isMainWtActive, project.id])

  const handleRemove = useCallback(() => {
    removeProjectFromGroup(project.groupId, project.id)
    removeProject(project.id)
    setShowMenu(null)
  }, [project.groupId, project.id, removeProject, removeProjectFromGroup])

  const handleCreateSession = useCallback((option: NewSessionOption) => {
    selectProject(project.id)
    setContextMenu(null)
    setProjectSubmenu(null)
    createSessionWithPrompt(
      {
        projectId: project.id,
        type: option.type,
        customSessionDefinitionId: option.customSessionDefinitionId,
        worktreeId: getDefaultWorktreeIdForProject(project.id),
      },
      (id) => {
        usePanesStore.getState().addSessionToPane(usePanesStore.getState().activePaneId, id)
        setActive(id)
      },
    )
  }, [project.id, selectProject, setActive])

  const handleStartTaskFromMenu = useCallback((bundle: TaskBundle) => {
    setContextMenu(null)
    setProjectSubmenu(null)
    setTaskDialog(bundle)
  }, [])

  const handleMoveToGroup = useCallback((groupId: string) => {
    removeProjectFromGroupFn(project.groupId, project.id)
    addProjectToGroup(groupId, project.id)
    moveProject(project.id, groupId)
    setContextMenu(null)
    setProjectSubmenu(null)
  }, [addProjectToGroup, moveProject, project.groupId, project.id, removeProjectFromGroupFn])

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
    setProjectSubmenu(null)
  }, [project.id, selectProject, addSession, setActive])

  const handleToggleExpand = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    if (hasWorktreeChildren) setExpanded((prev) => !prev)
  }, [hasWorktreeChildren])

  const handleRowDoubleClick = useCallback(() => {
    onOpenProject?.(project.id)
  }, [onOpenProject, project.id])

  return (
    <div className="relative">
      {/* Main project row */}
      <div
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData('project-id', project.id)
          e.dataTransfer.setData('source-group', project.groupId)
          e.dataTransfer.effectAllowed = 'move'
        }}
        className={cn(
          'group relative flex h-8.5 cursor-pointer items-center gap-2.5 px-3 mx-1 rounded-[var(--radius-sm)] transition-all duration-200',
          isMainWtActive
            ? 'bg-[var(--project-selected-bg)] text-[var(--color-text-primary)] ring-1 ring-inset ring-[var(--project-selected-border)] shadow-[inset_0_0_12px_var(--project-selected-glow)]'
            : 'text-[var(--color-text-secondary)] hover:bg-[var(--project-hover-bg)] hover:text-[var(--color-text-primary)] hover:ring-1 hover:ring-inset hover:ring-[var(--project-hover-border)] hover:shadow-[inset_0_0_12px_var(--project-hover-glow)]',
          projDragOver && 'ring-2 ring-[var(--color-accent)] ring-offset-2 ring-offset-[var(--color-bg-secondary)]',
        )}
        style={projectHoverStyle}
        onClick={handleSelect}
        onDoubleClick={handleRowDoubleClick}
        onContextMenu={(e) => {
          e.preventDefault()
          e.stopPropagation()
          setBranchSubmenuAnchor(null)
          setProjectSubmenu(null)
          setContextMenu({ x: e.clientX, y: e.clientY })
        }}
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes('project-id')) {
            e.preventDefault()
            e.dataTransfer.dropEffect = 'move'
            setProjDragOver(true)
          }
        }}
        onDragLeave={() => {
          setProjDragOver(false)
        }}
        onDrop={(e) => {
          e.stopPropagation(); setProjDragOver(false)
          const did = e.dataTransfer.getData('project-id'), sg = e.dataTransfer.getData('source-group')
          if (!did || did === project.id) return
          if (sg === project.groupId) { reorderProjectInGroup(project.groupId, did, project.id) }
          else { moveProjectToGroupAt(did, sg, project.groupId, project.id); moveProject(did, project.groupId) }
        }}
      >
        {/* Left vertical indicator for active project */}
        {isMainWtActive && (
          <div className="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-full bg-[var(--project-selected-color)] shadow-[0_0_8px_var(--project-selected-color)]" />
        )}

        <div className="flex h-4 w-7 shrink-0 items-center gap-1">
          {hasWorktreeChildren ? (
            <button onClick={handleToggleExpand} className="flex h-full w-3 shrink-0 items-center justify-center text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]">
              <ChevronRight size={11} strokeWidth={2.5} className={cn('transition-transform duration-200', expanded && 'rotate-90')} />
            </button>
          ) : (
            <span className="w-3 shrink-0" />
          )}
          <Folder size={14} className={cn('shrink-0', isMainWtActive ? 'text-[var(--project-selected-color)]' : 'text-[var(--color-text-tertiary)] group-hover:text-[var(--project-hover-icon)]')} />
        </div>

        <span className={cn(
          'flex-1 truncate text-[var(--ui-font-sm)] transition-colors duration-200 font-medium'
        )}>
          {project.name}
        </span>

        {/* Status indicators */}
        <div className="flex items-center gap-1.5">
          {hasOutputting && <div className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-[var(--color-accent)] shadow-[0_0_4px_var(--color-accent)]" />}
          {hasUnread && !hasOutputting && <div className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--color-warning)]" />}

          <span
            className={cn(
              'shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-bold leading-none transition-all duration-200',
              sessions.length > 0
                ? isMainWtActive ? 'bg-[var(--project-selected-color)] text-white' : 'bg-[var(--color-bg-surface)] text-[var(--color-text-secondary)]'
                : 'text-[var(--color-text-tertiary)] opacity-40',
            )}
          >
            {sessions.length}
          </span>
        </div>

        {/* Branch badge */}
        {branchInfo?.current && (
          <div
            className={cn(
              'flex max-w-[80px] shrink-0 items-center gap-1 rounded-sm px-1 py-0.5 text-[10px] font-medium leading-none transition-all duration-200',
              'bg-[var(--color-bg-primary)]/40 text-[var(--color-text-tertiary)] group-hover:text-[var(--color-text-secondary)]',
              isMainWtActive && 'bg-black/20 text-[var(--color-text-secondary)]'
            )}
            title={branchInfo.isDirty
              ? `当前分支：${branchInfo.current}（有未提交更改）`
              : `当前分支：${branchInfo.current}`}
          >
            <GitBranch size={10} className="shrink-0 opacity-70" />
            <span className="truncate">{branchInfo.current}</span>
            {branchInfo.isDirty && <span className="h-1 w-1 shrink-0 rounded-full bg-[var(--color-warning)] shadow-[0_0_2px_var(--color-warning)]" />}
          </div>
        )}

        <button onClick={(e) => { e.stopPropagation(); const r = e.currentTarget.getBoundingClientRect(); setShowMenu(showMenu ? null : { x: r.right, y: r.bottom + 4 }) }}
          className={cn(
            'flex h-5 w-5 shrink-0 items-center justify-center rounded-[var(--radius-sm)]',
            'text-[var(--color-text-tertiary)] opacity-0 group-hover:opacity-100',
            'hover:bg-[var(--color-bg-surface)] hover:text-[var(--color-text-primary)] transition-all duration-150'
          )}>
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
            className={cn(
              'fixed min-w-[200px] overflow-visible rounded-[var(--radius-lg)] border border-white/[0.08]',
              'bg-[var(--color-bg-secondary)]/90 backdrop-blur-2xl shadow-[0_12px_40px_rgba(0,0,0,0.6),inset_0_1px_1px_rgba(255,255,255,0.05)] py-1.5 p-1',
              'animate-in fade-in zoom-in-95 duration-150',
            )}>
            <div className="px-3 py-1.5 mb-1 border-b border-white/[0.05]">
              <p className="truncate text-[10px] font-black uppercase tracking-[0.2em] text-[var(--color-text-tertiary)] opacity-60">项目路径</p>
              <p className="mt-0.5 truncate text-[11px] font-medium text-[var(--color-text-secondary)] opacity-80">{project.path}</p>
            </div>
            <button onClick={() => { setShowMenu(null); window.api.shell.openPath(project.path) }} className={MENU_ITEM}>
              <div className="absolute left-0 top-2 bottom-2 w-0.5 rounded-full bg-[var(--color-accent)] scale-y-0 opacity-0 transition-all duration-200 group-hover/menuitem:scale-y-100 group-hover/menuitem:opacity-100 group-hover/menuitem:shadow-[0_0_8px_var(--color-accent)]" />
              <ExternalLink size={14} /> <span className="flex-1">在资源管理器中打开</span>
            </button>
            <button onClick={() => { setShowMenu(null); handleRemove() }}
              className="group/item relative flex h-8.5 w-full items-center gap-3 px-3 rounded-[var(--radius-md)] text-left text-[13px] transition-all duration-200 text-[var(--color-error)] hover:bg-[var(--color-error)]/15">
              <Trash2 size={14} /> <span className="flex-1">移除项目</span>
            </button>
          </div>
        </>, document.body,
      )}

      {/* Right-click context menu */}
      {contextMenu && (
        <>
          <div className="fixed inset-0 z-40" onClick={closeContextMenu} />
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
            className={cn(
              'fixed z-50 min-w-[200px] overflow-visible rounded-[var(--radius-lg)] border border-white/[0.08]',
              'bg-[var(--color-bg-secondary)]/90 backdrop-blur-2xl shadow-[0_12px_40px_rgba(0,0,0,0.6),inset_0_1px_1px_rgba(255,255,255,0.05)] py-1.5 p-1',
              'animate-in fade-in zoom-in-95 duration-150 max-h-[85vh] overflow-y-auto scrollbar-none'
            )}>

            {/* 新建会话 */}
            <button
              className={cn(MENU_ITEM, 'justify-between', projectSubmenu?.type === 'sessions' && 'bg-[var(--color-accent)]/15 text-white')}
              onMouseEnter={(e) => openProjectSubmenu('sessions', e.currentTarget)}
              onMouseLeave={scheduleProjectSubmenuClose}
            >
              <div className={cn("absolute left-0 top-2 bottom-2 w-0.5 rounded-full bg-[var(--color-accent)] transition-all duration-200", projectSubmenu?.type === 'sessions' ? 'scale-y-100 opacity-100 shadow-[0_0_8px_var(--color-accent)]' : 'scale-y-0 opacity-0 group-hover/menuitem:scale-y-100 group-hover/menuitem:opacity-100')} />
              <span className="flex items-center gap-3"><PlusIcon size={14} strokeWidth={2.5} /> 新建会话</span>
              <ChevronRight size={14} opacity={0.4} />
            </button>
            <button
              className={MENU_ITEM}
              onClick={() => {
                onOpenProject?.(project.id)
                setContextMenu(null)
              }}
            >
              <div className="absolute left-0 top-2 bottom-2 w-0.5 rounded-full bg-[var(--color-accent)] scale-y-0 opacity-0 transition-all duration-200 group-hover/menuitem:scale-y-100 group-hover/menuitem:opacity-100 group-hover/menuitem:shadow-[0_0_8px_var(--color-accent)]" />
              <FolderOpen size={14} /> 打开项目
            </button>
            <div className="my-1.5 h-px bg-white/[0.06] mx-2" />
            
            <button
              className={cn(MENU_ITEM, visibleProjectId === project.id && 'text-[var(--color-accent)]')}
              onClick={() => {
                updateSettings({ visibleProjectId: project.id, visibleGroupId: null })
                setContextMenu(null)
              }}
            >
              <div className="absolute left-0 top-2 bottom-2 w-0.5 rounded-full bg-[var(--color-accent)] scale-y-0 opacity-0 transition-all duration-200 group-hover/menuitem:scale-y-100 group-hover/menuitem:opacity-100 group-hover/menuitem:shadow-[0_0_8px_var(--color-accent)]" />
              <Eye size={14} /> 只显示当前项目
            </button>
            <button
              className={MENU_ITEM}
              onClick={() => {
                updateSettings({ visibleProjectId: null, visibleGroupId: null })
                setContextMenu(null)
              }}
            >
              <div className="absolute left-0 top-2 bottom-2 w-0.5 rounded-full bg-[var(--color-accent)] scale-y-0 opacity-0 transition-all duration-200 group-hover/menuitem:scale-y-100 group-hover/menuitem:opacity-100 group-hover/menuitem:shadow-[0_0_8px_var(--color-accent)]" />
              <List size={14} /> 显示所有项目
            </button>

            {/* Git section */}
            <SectionDivider icon={GitBranch} label="Git" />
            {branchInfo && branchInfo.current ? (
              <>
                <button
                  ref={branchMenuRef}
                  className={cn(MENU_ITEM, 'justify-between', branchSubmenuAnchor && 'bg-[var(--color-accent)]/15 text-white')}
                  onMouseEnter={openBranchSub}
                  onMouseLeave={scheduleBranchClose}
                >
                  <div className={cn("absolute left-0 top-2 bottom-2 w-0.5 rounded-full bg-[var(--color-accent)] transition-all duration-200", branchSubmenuAnchor ? 'scale-y-100 opacity-100 shadow-[0_0_8px_var(--color-accent)]' : 'scale-y-0 opacity-0 group-hover/menuitem:scale-y-100 group-hover/menuitem:opacity-100')} />
                  <span className="flex items-center gap-3"><GitBranch size={14} /> 分支</span>
                  <ChevronRight size={14} opacity={0.4} />
                </button>
                <button className={MENU_ITEM} onClick={() => { setContextMenu(null); setShowNewWorktree(true) }}>
                  <div className="absolute left-0 top-2 bottom-2 w-0.5 rounded-full bg-[var(--color-accent)] scale-y-0 opacity-0 transition-all duration-200 group-hover/menuitem:scale-y-100 group-hover/menuitem:opacity-100 group-hover/menuitem:shadow-[0_0_8px_var(--color-accent)]" />
                  <PlusIcon size={14} /> 新建工作树...
                </button>
              </>
            ) : (
              <button className={MENU_ITEM} onClick={async () => {
                setContextMenu(null)
                await window.api.git.init(project.path)
                await useGitStore.getState().fetchStatus(project.id, project.path)
              }}>
                <div className="absolute left-0 top-2 bottom-2 w-0.5 rounded-full bg-[var(--color-accent)] scale-y-0 opacity-0 transition-all duration-200 group-hover/menuitem:scale-y-100 group-hover/menuitem:opacity-100 group-hover/menuitem:shadow-[0_0_8px_var(--color-accent)]" />
                <PlusIcon size={14} /> 初始化仓库
              </button>
            )}

            {/* Run */}
            <SectionDivider icon={Play} label="运行" />
            <button className={MENU_ITEM} onClick={() => {
              setContextMenu(null)
              setShowLaunchMenu(contextMenu)
            }}>
              <div className="absolute left-0 top-2 bottom-2 w-0.5 rounded-full bg-[var(--color-accent)] scale-y-0 opacity-0 transition-all duration-200 group-hover/menuitem:scale-y-100 group-hover/menuitem:opacity-100 group-hover/menuitem:shadow-[0_0_8px_var(--color-accent)]" />
              <Play size={14} /> 启动配置...
            </button>

            {/* Apply Template */}
            {matchingTemplates.length > 0 && (
              <>
                <SectionDivider icon={Layers} label="应用模板" />
                {matchingTemplates.map((t) => (
                  <button key={t.id} className={MENU_ITEM} onClick={() => handleApplyTemplate(t.id)}>
                    <div className="absolute left-0 top-2 bottom-2 w-0.5 rounded-full bg-[var(--color-accent)] scale-y-0 opacity-0 transition-all duration-200 group-hover/menuitem:scale-y-100 group-hover/menuitem:opacity-100 group-hover/menuitem:shadow-[0_0_8px_var(--color-accent)]" />
                    <Layers size={14} /><span className="flex-1 truncate">{t.name}</span>
                    <span className="text-[10px] font-bold tabular-nums opacity-40">{t.items.length}</span>
                  </button>
                ))}
              </>
            )}

            {/* Start Task */}
            {bundles.length > 0 && (
              <>
                <div className="my-1.5 h-px bg-white/[0.06] mx-2" />
                <button
                  className={cn(MENU_ITEM, 'justify-between', projectSubmenu?.type === 'tasks' && 'bg-[var(--color-accent)]/15 text-white')}
                  onMouseEnter={(e) => openProjectSubmenu('tasks', e.currentTarget)}
                  onMouseLeave={scheduleProjectSubmenuClose}
                >
                  <div className={cn("absolute left-0 top-2 bottom-2 w-0.5 rounded-full bg-[var(--color-accent)] transition-all duration-200", projectSubmenu?.type === 'tasks' ? 'scale-y-100 opacity-100 shadow-[0_0_8px_var(--color-accent)]' : 'scale-y-0 opacity-0 group-hover/menuitem:scale-y-100 group-hover/menuitem:opacity-100')} />
                  <span className="flex items-center gap-3"><Rocket size={14} /> 启动任务</span>
                  <ChevronRight size={14} opacity={0.4} />
                </button>
              </>
            )}

            {/* Move to */}
            {otherGroups.length > 0 && (
              <>
                <div className="my-1.5 h-px bg-white/[0.06] mx-2" />
                <button
                  className={cn(MENU_ITEM, 'justify-between', projectSubmenu?.type === 'move' && 'bg-[var(--color-accent)]/15 text-white')}
                  onMouseEnter={(e) => openProjectSubmenu('move', e.currentTarget)}
                  onMouseLeave={scheduleProjectSubmenuClose}
                >
                  <div className={cn("absolute left-0 top-2 bottom-2 w-0.5 rounded-full bg-[var(--color-accent)] transition-all duration-200", projectSubmenu?.type === 'move' ? 'scale-y-100 opacity-100 shadow-[0_0_8px_var(--color-accent)]' : 'scale-y-0 opacity-0 group-hover/menuitem:scale-y-100 group-hover/menuitem:opacity-100')} />
                  <span className="flex items-center gap-3"><ArrowRightLeft size={14} /> 移动到</span>
                  <ChevronRight size={14} opacity={0.4} />
                </button>
              </>
            )}

            {/* Remove + 在资源管理器中打开 */}
            <div className="my-1.5 h-px bg-white/[0.06] mx-2" />
            <button onClick={() => { setContextMenu(null); window.api.shell.openPath(project.path) }} className={MENU_ITEM}>
              <div className="absolute left-0 top-2 bottom-2 w-0.5 rounded-full bg-[var(--color-accent)] scale-y-0 opacity-0 transition-all duration-200 group-hover/menuitem:scale-y-100 group-hover/menuitem:opacity-100 group-hover/menuitem:shadow-[0_0_8px_var(--color-accent)]" />
              <ExternalLink size={14} /> <span className="flex-1">在资源管理器中打开</span>
            </button>
            <button onClick={() => { setContextMenu(null); handleRemove() }}
              className="group/item relative flex h-8.5 w-full items-center gap-3 px-3 rounded-[var(--radius-md)] text-left text-[13px] transition-all duration-200 text-[var(--color-error)] hover:bg-[var(--color-error)]/15">
              <Trash2 size={14} /> <span className="flex-1">移除</span>
            </button>
          </div>

          {projectSubmenu && (
            <ProjectContextSubmenu
              submenu={projectSubmenu}
              bundles={bundles}
              groups={otherGroups}
              onCreateSession={handleCreateSession}
              onStartTask={handleStartTaskFromMenu}
              onMoveToGroup={handleMoveToGroup}
              onMouseEnter={cancelProjectSubmenuClose}
              onMouseLeave={scheduleProjectSubmenuClose}
            />
          )}

          {/* Branch submenu (hover popup) */}
          {branchSubmenuAnchor && branchInfo && (
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
