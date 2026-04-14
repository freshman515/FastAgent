import { ChevronDown, ChevronRight, Clock, FolderPlus, MoreHorizontal, Palette, Trash2, Edit3 } from 'lucide-react'
import { useCallback, useMemo, useRef, useState } from 'react'
import type { Group } from '@shared/types'
import { cn } from '@/lib/utils'
import { useGroupsStore } from '@/stores/groups'
import { useProjectsStore } from '@/stores/projects'
import { useUIStore } from '@/stores/ui'
import { ProjectItem } from './ProjectItem'

interface GroupItemProps {
  group: Group
  searchQuery?: string
}

export function GroupItem({ group, searchQuery = '' }: GroupItemProps): JSX.Element {
  const toggleCollapse = useGroupsStore((s) => s.toggleCollapse)
  const removeGroup = useGroupsStore((s) => s.removeGroup)
  const updateGroup = useGroupsStore((s) => s.updateGroup)
  const allProjects = useProjectsStore((s) => s.projects)
  const projects = useMemo(() => {
    const ids = group.projectIds ?? []
    const map = new Map(allProjects.map((p) => [p.id, p]))
    const ordered = ids.map((id) => map.get(id)).filter(Boolean) as typeof allProjects
    const remaining = allProjects.filter((p) => p.groupId === group.id && !ids.includes(p.id))
    let result = [...ordered, ...remaining]
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      result = result.filter((p) => p.name.toLowerCase().includes(q))
    }
    return result
  }, [allProjects, group.id, group.projectIds, searchQuery])

  const addProject = useProjectsStore((s) => s.addProject)
  const addProjectToGroup = useGroupsStore((s) => s.addProjectToGroup)
  const removeProjectFromGroup = useGroupsStore((s) => s.removeProjectFromGroup)

  const moveProject = useProjectsStore((s) => s.moveProject)

  const reorderGroupById = useGroupsStore((s) => s.reorderGroupById)
  const reorderProjectInGroup = useGroupsStore((s) => s.reorderProjectInGroup)

  const [showMenu, setShowMenu] = useState(false)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [editing, setEditing] = useState(false)
  const [editName, setEditName] = useState(group.name)
  const menuRef = useRef<HTMLDivElement>(null)

  const handleToggle = useCallback(() => {
    toggleCollapse(group.id)
  }, [group.id, toggleCollapse])

  const handleRename = useCallback(() => {
    const name = editName.trim()
    if (name && name !== group.name) {
      updateGroup(group.id, { name })
    }
    setEditing(false)
    setShowMenu(false)
  }, [editName, group.id, group.name, updateGroup])

  const handleDelete = useCallback(() => {
    removeGroup(group.id)
    setShowMenu(false)
  }, [group.id, removeGroup])

  return (
    <div className="relative">
      {/* Group header */}
      <div
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData('group-id', group.id)
          e.dataTransfer.effectAllowed = 'move'
        }}
        className={cn(
          'group relative flex h-7 cursor-pointer items-center gap-2 px-2 mt-1 mb-0.5',
          'transition-colors duration-75 hover:bg-[var(--color-bg-tertiary)]/50 rounded-[var(--radius-sm)]',
          dragOver && 'bg-[var(--color-accent-muted)] border border-dashed border-[var(--color-accent)]',
        )}
        onClick={handleToggle}
        onContextMenu={(e) => {
          e.preventDefault()
          e.stopPropagation()
          setContextMenu({ x: e.clientX, y: e.clientY })
        }}
        onDragOver={(e) => {
          e.preventDefault()
          e.dataTransfer.dropEffect = 'move'
          if (e.dataTransfer.types.includes('project-id') || e.dataTransfer.types.includes('group-id')) {
            setDragOver(true)
          }
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          setDragOver(false)
          // Project dropped onto group
          const projId = e.dataTransfer.getData('project-id')
          const sourceGroup = e.dataTransfer.getData('source-group')
          if (projId && sourceGroup) {
            if (sourceGroup !== group.id) {
              removeProjectFromGroup(sourceGroup, projId)
              addProjectToGroup(group.id, projId)
              moveProject(projId, group.id)
              if (group.collapsed) toggleCollapse(group.id)
            }
            return
          }
          // Group dropped onto group (reorder)
          const draggedGroupId = e.dataTransfer.getData('group-id')
          if (draggedGroupId && draggedGroupId !== group.id) {
            reorderGroupById(draggedGroupId, group.id)
          }
        }}
      >
        {/* Collapse chevron — muted, stays out of the way of the brand mark */}
        {group.collapsed ? (
          <ChevronRight size={11} className="shrink-0 text-[var(--color-text-tertiary)]" />
        ) : (
          <ChevronDown size={11} className="shrink-0 text-[var(--color-text-tertiary)]" />
        )}

        {/* Brand mark — small filled rounded bar acts as the group identity chip.
            Typography + this tiny chip together make the row read as a "section label"
            rather than a "selectable row", which visually separates it from the
            selected-project accent style. */}
        <span
          className="inline-block h-3 w-1 shrink-0 rounded-full"
          style={{ backgroundColor: group.color, boxShadow: `0 0 6px ${group.color}55` }}
        />

        {/* Name */}
        {editing ? (
          <input
            autoFocus
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            onBlur={handleRename}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleRename()
              if (e.key === 'Escape') setEditing(false)
            }}
            onClick={(e) => e.stopPropagation()}
            style={{ outline: 'none' }}
            className={cn(
              'h-6 flex-1 rounded-[var(--radius-sm)] bg-[var(--color-bg-surface)] px-1.5 text-[var(--ui-font-sm)]',
              'text-[var(--color-text-primary)] border border-[var(--color-accent)]',
            )}
          />
        ) : (
          <span
            className="flex-1 truncate text-[var(--ui-font-sm)] font-semibold"
            style={{ color: group.color }}
          >
            {group.name}
          </span>
        )}

        {/* Project count — tinted to the group color for a cohesive look */}
        {!editing && projects.length > 0 && (
          <span
            className="flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[9px] font-medium"
            style={{
              backgroundColor: `${group.color}22`,
              color: group.color,
            }}
          >
            {projects.length}
          </span>
        )}

        {/* Menu button */}
        <button
          onClick={(e) => {
            e.stopPropagation()
            setShowMenu(!showMenu)
          }}
          className={cn(
            'flex h-5 w-5 items-center justify-center rounded-[var(--radius-sm)]',
            'text-[var(--color-text-tertiary)] opacity-0 group-hover:opacity-100',
            'hover:bg-[var(--color-bg-surface)] transition-all duration-75',
          )}
        >
          <MoreHorizontal size={12} />
        </button>
      </div>

      {/* Context menu */}
      {showMenu && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setShowMenu(false)} />
          <div
            ref={menuRef}
            className={cn(
              'absolute right-2 top-7 z-50 min-w-[140px] rounded-[var(--radius-md)] py-1',
              'border border-[var(--color-border)] bg-[var(--color-bg-tertiary)]',
              'shadow-lg shadow-black/30 animate-[fade-in_0.1s_ease-out]',
            )}
          >
            <button
              onClick={(e) => {
                e.stopPropagation()
                setEditing(true)
                setEditName(group.name)
                setShowMenu(false)
              }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-[var(--ui-font-sm)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-surface)] hover:text-[var(--color-text-primary)]"
            >
              <Edit3 size={12} /> 重命名
            </button>
            <button
              onClick={handleDelete}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-[var(--ui-font-sm)] text-[var(--color-error)] hover:bg-[var(--color-bg-surface)]"
            >
              <Trash2 size={12} /> 删除
            </button>
          </div>
        </>
      )}

      {/* Right-click context menu */}
      {contextMenu && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setContextMenu(null)} />
          <div
            style={{ top: contextMenu.y, left: contextMenu.x }}
            className={cn(
              'fixed z-50 w-44 rounded-[var(--radius-md)] py-1',
              'border border-[var(--color-border)] bg-[var(--color-bg-tertiary)]',
              'shadow-lg shadow-black/30',
            )}
          >
            <button
              onClick={async () => {
                setContextMenu(null)
                const folder = await window.api.dialog.selectFolder()
                if (folder) {
                  useUIStore.getState().addRecentPath(folder)
                  const projId = addProject(folder, group.id)
                  addProjectToGroup(group.id, projId)
                  if (group.collapsed) toggleCollapse(group.id)
                }
              }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-[var(--ui-font-sm)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-surface)] hover:text-[var(--color-text-primary)]"
            >
              <FolderPlus size={12} /> 浏览...
            </button>
            {useUIStore.getState().settings.recentPaths.length > 0 && (
              <>
                <div className="px-3 py-0.5 flex items-center gap-1.5">
                  <Clock size={10} className="text-[var(--color-text-tertiary)]" />
                  <span className="text-[var(--ui-font-2xs)] text-[var(--color-text-tertiary)]">最近</span>
                </div>
                {useUIStore.getState().settings.recentPaths.slice(0, 5).map((p) => (
                  <button
                    key={p}
                    onClick={() => {
                      setContextMenu(null)
                      useUIStore.getState().addRecentPath(p)
                      const projId = addProject(p, group.id)
                      addProjectToGroup(group.id, projId)
                      if (group.collapsed) toggleCollapse(group.id)
                    }}
                    className="flex w-full items-center gap-2 px-3 py-1 text-[var(--ui-font-2xs)] text-[var(--color-text-tertiary)] hover:bg-[var(--color-bg-surface)] hover:text-[var(--color-text-primary)] truncate"
                    title={p}
                  >
                    {p.split(/[/\\]/).pop()}
                  </button>
                ))}
              </>
            )}
            <button
              onClick={() => {
                setContextMenu(null)
                setEditing(true)
                setEditName(group.name)
              }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-[var(--ui-font-sm)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-surface)] hover:text-[var(--color-text-primary)]"
            >
              <Edit3 size={12} /> 重命名
            </button>
            {/* Color picker */}
            <div className="px-3 py-1.5 border-t border-[var(--color-border)]">
              <div className="flex items-center gap-1.5 mb-1">
                <Palette size={12} className="text-[var(--color-text-tertiary)]" />
                <span className="text-[var(--ui-font-2xs)] text-[var(--color-text-tertiary)]">颜色</span>
              </div>
              <div className="flex gap-1.5 flex-wrap">
                {['#7c6aef', '#5fa0f5', '#45c8c8', '#3ecf7b', '#f0a23b', '#ef5757', '#c084fc', '#f472b6', '#8e8e96'].map((c) => (
                  <button
                    key={c}
                    onClick={() => { updateGroup(group.id, { color: c }); setContextMenu(null) }}
                    className={cn(
                      'h-4 w-4 rounded-full border-2 transition-transform hover:scale-125',
                      group.color === c ? 'border-white' : 'border-transparent',
                    )}
                    style={{ backgroundColor: c }}
                  />
                ))}
              </div>
            </div>
            <button
              onClick={() => { setContextMenu(null); handleDelete() }}
              className="flex w-full items-center gap-2 px-3 py-1.5 border-t border-[var(--color-border)] text-[var(--ui-font-sm)] text-[var(--color-error)] hover:bg-[var(--color-bg-surface)]"
            >
              <Trash2 size={12} /> 删除
            </button>
          </div>
        </>
      )}

      {/* Projects list */}
      {!group.collapsed && (
        <div className="flex flex-col pb-1">
          {projects.map((project) => (
            <ProjectItem key={project.id} project={project} />
          ))}
        </div>
      )}

      {/* Group separator */}
      <div className="mx-3 border-b border-[var(--color-border)]/40" />
    </div>
  )
}
