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
      <div className="px-3 py-6 text-center">
        <p className="text-[var(--ui-font-sm)] text-[var(--color-text-tertiary)]">
          {searchQuery ? 'No matches found.' : 'No groups or projects yet.'}
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
        <div className="pt-1">
          <div className="px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--color-text-tertiary)]">
            Ungrouped
          </div>
          <div className="flex flex-col">
            {ungroupedProjects.map((project) => (
              <ProjectItem key={project.id} project={project} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
