import { Plus } from 'lucide-react'
import { useCallback } from 'react'
import { cn } from '@/lib/utils'
import { useProjectsStore } from '@/stores/projects'
import { useGroupsStore } from '@/stores/groups'

interface AddProjectProps {
  groupId: string
}

export function AddProject({ groupId }: AddProjectProps): JSX.Element {
  const addProject = useProjectsStore((s) => s.addProject)
  const addProjectToGroup = useGroupsStore((s) => s.addProjectToGroup)

  const handleAdd = useCallback(async () => {
    const path = await window.api.dialog.selectFolder()
    if (path) {
      const id = addProject(path, groupId)
      addProjectToGroup(groupId, id)
    }
  }, [groupId, addProject, addProjectToGroup])

  return (
    <button
      onClick={handleAdd}
      className={cn(
        'flex h-6 items-center gap-1.5 pl-7 pr-2',
        'text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]',
        'hover:bg-[var(--color-bg-tertiary)] transition-colors duration-75',
      )}
    >
      <Plus size={12} />
      <span className="text-[var(--ui-font-xs)]">Add project</span>
    </button>
  )
}
