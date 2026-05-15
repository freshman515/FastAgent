import { useCallback } from 'react'
import { useProjectsStore } from '@/stores/projects'
import { type TodoItem, useUIStore } from '@/stores/ui'

interface ProjectTodos {
  projectId: string | null
  projectName: string
  todoItems: TodoItem[]
  saveTodoItems: (items: TodoItem[]) => void
}

export function useProjectTodos(): ProjectTodos {
  const selectedProjectId = useProjectsStore((s) => s.selectedProjectId)
  const selectedProjectName = useProjectsStore((s) =>
    s.projects.find((project) => project.id === s.selectedProjectId)?.name,
  )
  const todoItemsByProject = useUIStore((s) => s.settings.todoItemsByProject)
  const legacyTodoItems = useUIStore((s) => s.settings.todoItems)
  const updateSettings = useUIStore((s) => s.updateSettings)
  const hasProjectTodoLists = Object.keys(todoItemsByProject).length > 0

  const todoItems = selectedProjectId
    ? (todoItemsByProject[selectedProjectId] ?? (hasProjectTodoLists ? [] : legacyTodoItems))
    : legacyTodoItems

  const saveTodoItems = useCallback((items: TodoItem[]) => {
    const settings = useUIStore.getState().settings

    if (!selectedProjectId) {
      updateSettings({ todoItems: items })
      return
    }

    updateSettings({
      todoItemsByProject: {
        ...settings.todoItemsByProject,
        [selectedProjectId]: items,
      },
    })
  }, [selectedProjectId, updateSettings])

  return {
    projectId: selectedProjectId,
    projectName: selectedProjectName ?? '未选择项目',
    todoItems,
    saveTodoItems,
  }
}
