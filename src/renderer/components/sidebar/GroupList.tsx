import { useMemo } from 'react'
import type { Group, Project } from '@shared/types'
import { useGroupsStore } from '@/stores/groups'
import { useProjectsStore } from '@/stores/projects'
import { useUIStore } from '@/stores/ui'
import { GroupItem } from './GroupItem'
import { ProjectItem } from './ProjectItem'

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

export function GroupList({ searchQuery = '', onOpenProject }: GroupListProps): JSX.Element {
  const groups = useGroupsStore((s) => s.groups)
  const projects = useProjectsStore((s) => s.projects)
  const visibleGroupId = useUIStore((s) => s.settings.visibleGroupId)
  const visibleProjectId = useUIStore((s) => s.settings.visibleProjectId)
  const normalizedQuery = searchQuery.trim().toLowerCase()

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

  if (filteredGroups.length === 0 && ungroupedProjects.length === 0) {
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
