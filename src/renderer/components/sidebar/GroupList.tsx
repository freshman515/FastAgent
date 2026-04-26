import { useMemo } from 'react'
import { useGroupsStore } from '@/stores/groups'
import { useProjectsStore } from '@/stores/projects'
import { useUIStore } from '@/stores/ui'
import { GroupItem } from './GroupItem'
import { ProjectItem } from './ProjectItem'

interface GroupListProps {
  searchQuery?: string
}

export function GroupList({ searchQuery = '' }: GroupListProps): JSX.Element {
  const groups = useGroupsStore((s) => s.groups)
  const projects = useProjectsStore((s) => s.projects)
  const visibleGroupId = useUIStore((s) => s.settings.visibleGroupId)
  const visibleProjectId = useUIStore((s) => s.settings.visibleProjectId)
  const normalizedQuery = searchQuery.trim().toLowerCase()

  const filteredGroups = useMemo(() => {
    if (visibleProjectId) {
      const visibleProject = projects.find((project) => project.id === visibleProjectId)
      return visibleProject ? groups.filter((group) => group.id === visibleProject.groupId) : []
    }

    let result = visibleGroupId ? groups.filter((g) => g.id === visibleGroupId) : groups
    if (normalizedQuery) {
      result = result.filter((g) => {
        // Match group name
        if (g.name.toLowerCase().includes(normalizedQuery)) return true
        // Match any project in this group
        return projects.some((p) => p.groupId === g.id && p.name.toLowerCase().includes(normalizedQuery))
      })
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
          <useGroupsStore.getState().groups.length === 0 ? null : null /* dummy to keep imports if needed */ }
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9h18v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9Z"/><path d="M3 9V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v4"/><path d="M12 12v6"/><path d="M9 15h6"/></svg>
        </div>
        <p className="text-[var(--ui-font-sm)] font-medium text-[var(--color-text-secondary)]">
          {searchQuery ? '未找到匹配项目' : '暂无项目或分组'}
        </p>
        <p className="mt-1 text-[var(--ui-font-xs)] text-[var(--color-text-tertiary)]">
          {searchQuery ? '尝试搜索其他关键词' : '点击上方按钮新建分组或匿名终端'}
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col">
      {filteredGroups.map((group) => (
        <GroupItem key={group.id} group={group} searchQuery={searchQuery} />
      ))}
      {ungroupedProjects.length > 0 && (
        <div className="mt-4 pt-2 border-t border-[var(--color-border)]/30">
          <div className="px-4 py-2 text-[10px] font-bold uppercase tracking-[0.2em] text-[var(--color-text-tertiary)]/70">
            Ungrouped Projects
          </div>
          <div className="flex flex-col gap-0.5">
            {ungroupedProjects.map((project) => (
              <ProjectItem key={project.id} project={project} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
