import { useMemo } from 'react'
import { useGroupsStore } from '@/stores/groups'
import { useProjectsStore } from '@/stores/projects'
import { useUIStore } from '@/stores/ui'
import { GroupItem } from './GroupItem'

interface GroupListProps {
  searchQuery?: string
}

export function GroupList({ searchQuery = '' }: GroupListProps): JSX.Element {
  const groups = useGroupsStore((s) => s.groups)
  const projects = useProjectsStore((s) => s.projects)
  const visibleGroupId = useUIStore((s) => s.settings.visibleGroupId)

  const filteredGroups = useMemo(() => {
    let result = visibleGroupId ? groups.filter((g) => g.id === visibleGroupId) : groups
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      result = result.filter((g) => {
        // Match group name
        if (g.name.toLowerCase().includes(q)) return true
        // Match any project in this group
        return projects.some((p) => p.groupId === g.id && p.name.toLowerCase().includes(q))
      })
    }
    return result
  }, [groups, visibleGroupId, searchQuery, projects])

  if (filteredGroups.length === 0) {
    return (
      <div className="px-3 py-6 text-center">
        <p className="text-[var(--ui-font-sm)] text-[var(--color-text-tertiary)]">
          {searchQuery ? 'No matches found.' : 'No groups yet. Click + to create one.'}
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col">
      {filteredGroups.map((group) => (
        <GroupItem key={group.id} group={group} searchQuery={searchQuery} />
      ))}
    </div>
  )
}
