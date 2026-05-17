import { ChevronRight, Pin } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { Group, Project } from '@shared/types'
import { useGroupsStore } from '@/stores/groups'
import { usePanesStore } from '@/stores/panes'
import { useProjectsStore } from '@/stores/projects'
import { useSessionsStore } from '@/stores/sessions'
import { useUIStore } from '@/stores/ui'
import { useWorktreesStore } from '@/stores/worktrees'
import { useIsDarkTheme } from '@/hooks/useIsDarkTheme'
import { GroupItem } from './GroupItem'
import { getProjectSessionPriority, getWorktreeDisplayLabel, ProjectItem, ProjectSessionRow } from './ProjectItem'

interface GroupListProps {
  searchQuery?: string
  onOpenProject?: (projectId: string) => void
}

function getOrderedChildGroups(group: Group, groups: Group[]): Group[] {
  const byId = new Map(groups.map((item) => [item.id, item]))
  const ordered = (group.childGroupIds ?? [])
    .map((id) => byId.get(id))
    .filter((item): item is Group => Boolean(item))
  const orderedIds = new Set(ordered.map((item) => item.id))
  const remaining = groups.filter((item) => item.parentId === group.id && !orderedIds.has(item.id))
  return [...ordered, ...remaining]
}

function groupSubtreeMatches(group: Group, groups: Group[], projects: Project[], query: string): boolean {
  if (!query) return true
  if (group.name.toLowerCase().includes(query)) return true
  if (projects.some((project) => project.groupId === group.id && project.name.toLowerCase().includes(query))) return true
  return getOrderedChildGroups(group, groups).some((child) => groupSubtreeMatches(child, groups, projects, query))
}

function groupContainsGroup(group: Group, groups: Group[], targetGroupId: string): boolean {
  if (group.id === targetGroupId) return true
  return getOrderedChildGroups(group, groups).some((child) => groupContainsGroup(child, groups, targetGroupId))
}

export function GroupList({ searchQuery = '', onOpenProject }: GroupListProps): JSX.Element {
  const groups = useGroupsStore((s) => s.groups)
  const projects = useProjectsStore((s) => s.projects)
  const allSessions = useSessionsStore((s) => s.sessions)
  const outputStates = useSessionsStore((s) => s.outputStates)
  const activePaneId = usePanesStore((s) => s.activePaneId)
  const activeTabId = usePanesStore((s) => s.paneActiveSession[activePaneId] ?? null)
  const worktrees = useWorktreesStore((s) => s.worktrees)
  const visibleGroupId = useUIStore((s) => s.settings.visibleGroupId)
  const visibleProjectId = useUIStore((s) => s.settings.visibleProjectId)
  const isDarkTheme = useIsDarkTheme()
  const [pinnedCollapsed, setPinnedCollapsed] = useState(false)
  const normalizedQuery = searchQuery.trim().toLowerCase()
  const projectById = useMemo(() => new Map(projects.map((project) => [project.id, project])), [projects])
  const worktreeById = useMemo(() => new Map(worktrees.map((worktree) => [worktree.id, worktree])), [worktrees])

  const filteredGroups = useMemo(() => {
    const validGroupIds = new Set(groups.map((group) => group.id))
    const rootGroups = groups.filter((group) => !group.parentId || !validGroupIds.has(group.parentId))

    if (visibleProjectId) {
      const visibleProject = projects.find((project) => project.id === visibleProjectId)
      return visibleProject ? groups.filter((group) => group.id === visibleProject.groupId) : []
    }

    let result = visibleGroupId ? groups.filter((g) => g.id === visibleGroupId) : rootGroups
    if (normalizedQuery) {
      result = result.filter((g) => groupSubtreeMatches(g, groups, projects, normalizedQuery))
    }
    return result
  }, [groups, normalizedQuery, projects, visibleGroupId, visibleProjectId])

  const ungroupedProjects = useMemo(() => {
    const validGroupIds = new Set(groups.map((group) => group.id))
    if (visibleProjectId) {
      return projects.filter((project) => project.id === visibleProjectId && !validGroupIds.has(project.groupId))
    }

    if (visibleGroupId) return []
    return projects.filter((project) => {
      if (validGroupIds.has(project.groupId)) return false
      return !normalizedQuery || project.name.toLowerCase().includes(normalizedQuery)
    })
  }, [groups, normalizedQuery, projects, visibleGroupId, visibleProjectId])

  const pinnedSessions = useMemo(() => {
    const visibleGroup = visibleGroupId ? groups.find((group) => group.id === visibleGroupId) ?? null : null

    return allSessions
      .filter((session) => {
        if (!session.pinned) return false
        const project = projectById.get(session.projectId)
        if (!project) return false
        if (visibleProjectId && session.projectId !== visibleProjectId) return false
        if (visibleGroupId && (!visibleGroup || !groupContainsGroup(visibleGroup, groups, project.groupId))) return false
        if (!normalizedQuery) return true
        return session.name.toLowerCase().includes(normalizedQuery) || project.name.toLowerCase().includes(normalizedQuery)
      })
      .sort((a, b) => {
        const priority = getProjectSessionPriority(b, outputStates[b.id]) - getProjectSessionPriority(a, outputStates[a.id])
        if (priority !== 0) return priority
        return b.updatedAt - a.updatedAt
      })
  }, [allSessions, groups, normalizedQuery, outputStates, projectById, visibleGroupId, visibleProjectId])

  if (pinnedSessions.length === 0 && filteredGroups.length === 0 && ungroupedProjects.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
        <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-[var(--color-bg-primary)]/50 text-[var(--color-text-tertiary)] opacity-20">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9h18v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9Z"/><path d="M3 9V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v4"/><path d="M12 12v6"/><path d="M9 15h6"/></svg>
        </div>
        <p className="text-[var(--ui-font-sm)] font-medium text-[var(--color-text-secondary)]">
          {searchQuery ? '未找到匹配项目' : '暂无项目或分组'}
        </p>
        <p className="mt-1 text-[var(--ui-font-xs)] text-[var(--color-text-tertiary)]">
          {searchQuery ? '尝试搜索其他关键词' : '点击上方按钮新建分组，或先添加一个项目'}
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col">
      {pinnedSessions.length > 0 && (
        <div className="mb-2 border-b border-[var(--color-border)]/35 pb-2">
          <div
            className="mx-1 mb-1 mt-1.5 flex h-8 cursor-pointer items-center gap-2 rounded-[var(--radius-sm)] px-3 text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-bg-surface)]/45 hover:text-[var(--color-text-primary)]"
            onClick={() => setPinnedCollapsed((value) => !value)}
            title={pinnedCollapsed ? '展开置顶' : '折叠置顶'}
          >
            <Pin size={13} className="shrink-0 fill-current text-[var(--color-accent)]" />
            <span className="shrink-0 truncate text-[var(--ui-font-sm)] font-semibold">置顶</span>
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation()
                setPinnedCollapsed((value) => !value)
              }}
              onDoubleClick={(event) => event.stopPropagation()}
              className="-ml-0.5 flex h-5 w-4 shrink-0 items-center justify-center rounded-[var(--radius-sm)] text-[var(--color-text-tertiary)] transition-colors hover:text-[var(--color-text-secondary)]"
              title={pinnedCollapsed ? '展开置顶' : '折叠置顶'}
              aria-label={pinnedCollapsed ? '展开置顶' : '折叠置顶'}
            >
              <ChevronRight
                size={12}
                strokeWidth={2.5}
                className={pinnedCollapsed ? 'transition-transform duration-200' : 'rotate-90 transition-transform duration-200'}
              />
            </button>
            <span className="ml-auto flex h-4.5 min-w-[20px] shrink-0 items-center justify-center rounded-full bg-[var(--color-accent)]/18 px-1.5 text-[10px] font-bold leading-none text-[var(--color-accent)]">
              {pinnedSessions.length}
            </span>
          </div>
          {!pinnedCollapsed && <div className="space-y-0.5">
            {pinnedSessions.map((session) => {
              const project = projectById.get(session.projectId)
              return (
                <ProjectSessionRow
                  key={session.id}
                  session={session}
                  active={activeTabId === session.id}
                  outputState={outputStates[session.id]}
                  worktreeLabel={getWorktreeDisplayLabel(session.worktreeId, worktreeById)}
                  isDarkTheme={isDarkTheme}
                  contextLabel={project?.name ?? null}
                  rowClassName="mx-1 w-[calc(100%-0.5rem)]"
                  showConnector={false}
                />
              )
            })}
          </div>}
        </div>
      )}
      {filteredGroups.map((group) => (
        <GroupItem key={group.id} group={group} searchQuery={searchQuery} onOpenProject={onOpenProject} />
      ))}
      {ungroupedProjects.length > 0 && (
        <div className="mt-4 pt-2 border-t border-[var(--color-border)]/30">
          <div className="px-4 py-2 text-[10px] font-bold uppercase tracking-[0.2em] text-[var(--color-text-tertiary)]/70">
            Ungrouped Projects
          </div>
          <div className="flex flex-col gap-0.5">
            {ungroupedProjects.map((project) => (
              <ProjectItem key={project.id} project={project} onOpenProject={onOpenProject} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
