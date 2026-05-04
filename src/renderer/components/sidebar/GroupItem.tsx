import { ChevronDown, ChevronRight, Clock, Eye, FolderPlus, List, MoreHorizontal, Palette, Trash2, Edit3 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Group } from '@shared/types'
import { cn } from '@/lib/utils'
import { GROUP_COLOR_PRESETS, normalizeGroupColor, parseGroupColor, useGroupsStore } from '@/stores/groups'
import { useProjectsStore } from '@/stores/projects'
import { useUIStore } from '@/stores/ui'
import { ProjectItem } from './ProjectItem'

interface GroupItemProps {
  group: Group
  searchQuery?: string
  onOpenProject?: (projectId: string) => void
}

export function GroupItem({ group, searchQuery = '', onOpenProject }: GroupItemProps): JSX.Element {
  const toggleCollapse = useGroupsStore((s) => s.toggleCollapse)
  const removeGroup = useGroupsStore((s) => s.removeGroup)
  const updateGroup = useGroupsStore((s) => s.updateGroup)
  const allProjects = useProjectsStore((s) => s.projects)
  const visibleGroupId = useUIStore((s) => s.settings.visibleGroupId)
  const visibleProjectId = useUIStore((s) => s.settings.visibleProjectId)
  const updateSettings = useUIStore((s) => s.updateSettings)
  const projects = useMemo(() => {
    const ids = group.projectIds ?? []
    const map = new Map(allProjects.map((p) => [p.id, p]))
    const ordered = ids.map((id) => map.get(id)).filter(Boolean) as typeof allProjects
    const remaining = allProjects.filter((p) => p.groupId === group.id && !ids.includes(p.id))
    let result = [...ordered, ...remaining]
    if (visibleProjectId) {
      return result.filter((p) => p.id === visibleProjectId)
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      result = result.filter((p) => p.name.toLowerCase().includes(q))
    }
    return result
  }, [allProjects, group.id, group.projectIds, searchQuery, visibleProjectId])

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
  const [customColorDraft, setCustomColorDraft] = useState(normalizeGroupColor(group.color))
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setCustomColorDraft(normalizeGroupColor(group.color))
  }, [group.color])

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

  const commitCustomColor = useCallback((rawColor: string) => {
    const color = parseGroupColor(rawColor)
    if (!color) {
      setCustomColorDraft(normalizeGroupColor(group.color))
      return
    }
    setCustomColorDraft(color)
    if (color !== normalizeGroupColor(group.color)) {
      updateGroup(group.id, { color })
    }
  }, [group.color, group.id, updateGroup])

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
          'group relative flex h-8.5 cursor-pointer items-center gap-2.5 px-3 mt-1.5 mb-0.5',
          'transition-all duration-200 hover:bg-[var(--color-bg-surface)]/40 rounded-[var(--radius-sm)] mx-1',
          dragOver && 'bg-[var(--color-accent-muted)] ring-1 ring-inset ring-[var(--color-accent)]',
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
        {/* Brand mark — subtle vertical pill with glow */}
        <div
          className="h-3.5 w-1 rounded-full transition-all duration-300 group-hover:h-4.5"
          style={{
            backgroundColor: group.color,
            boxShadow: `0 0 8px ${group.color}44`,
          }}
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
              'h-6.5 flex-1 rounded-[var(--radius-sm)] bg-[var(--color-bg-primary)] px-2 text-[var(--ui-font-sm)]',
              'text-[var(--color-text-primary)] border border-[var(--color-accent)] shadow-[0_0_0_2px_var(--color-accent-muted)]',
            )}
          />
        ) : (
          <span
            className="flex-1 truncate text-[var(--ui-font-sm)] font-medium tracking-tight transition-colors duration-200 group-hover:text-[var(--color-text-primary)]"
            style={{ color: group.color }}
          >
            {group.name}
          </span>
        )}

        {/* Project count — pill style */}
        {!editing && projects.length > 0 && (
          <span
            className="flex h-4.5 min-w-[20px] items-center justify-center rounded-full px-1.5 text-[10px] font-bold transition-all duration-200"
            style={{
              backgroundColor: `${group.color}18`,
              color: group.color,
              border: `1px solid ${group.color}22`,
            }}
          >
            {projects.length}
          </span>
        )}

        {/* Collapse chevron — moved to end for cleaner left alignment */}
        <div className="flex h-5 w-5 items-center justify-center rounded-[var(--radius-sm)] text-[var(--color-text-tertiary)] transition-all duration-200 hover:text-[var(--color-text-secondary)]">
          {group.collapsed ? (
            <ChevronRight size={12} strokeWidth={2.5} className="transition-transform duration-200" />
          ) : (
            <ChevronDown size={12} strokeWidth={2.5} className="transition-transform duration-200" />
          )}
        </div>
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
              'fixed z-50 min-w-[200px] overflow-visible rounded-[var(--radius-lg)] border border-white/[0.08]',
              'bg-[var(--color-bg-secondary)]/90 backdrop-blur-2xl shadow-[0_12px_40px_rgba(0,0,0,0.6),inset_0_1px_1px_rgba(255,255,255,0.05)] py-1.5 p-1',
              'animate-in fade-in zoom-in-95 duration-150',
            )}>
            <div className="px-3 py-1.5 mb-1 border-b border-white/[0.05]">
              <span className="text-[10px] font-black uppercase tracking-[0.2em] text-[var(--color-text-tertiary)] opacity-60">分组操作</span>
            </div>
            
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
              className="group/menuitem relative flex h-8.5 w-full items-center gap-3 px-3 rounded-[var(--radius-md)] text-[13px] transition-all duration-200 text-[var(--color-text-secondary)] hover:bg-[var(--color-accent)]/15 hover:text-white"
            >
              <div className="absolute left-0 top-2 bottom-2 w-0.5 rounded-full bg-[var(--color-accent)] scale-y-0 opacity-0 transition-all duration-200 group-hover/menuitem:scale-y-100 group-hover/menuitem:opacity-100 group-hover/menuitem:shadow-[0_0_8px_var(--color-accent)]" />
              <FolderPlus size={14} /> <span className="flex-1">浏览...</span>
            </button>

            {useUIStore.getState().settings.recentPaths.length > 0 && (
              <>
                <div className="px-3 py-1.5">
                   <span className="text-[10px] font-black uppercase tracking-[0.2em] text-[var(--color-text-tertiary)] opacity-60">最近打开</span>
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
                    className="group/menuitem relative flex h-8.5 w-full items-center gap-3 px-3 rounded-[var(--radius-md)] text-[12px] transition-all duration-200 text-[var(--color-text-tertiary)] hover:bg-[var(--color-accent)]/15 hover:text-white"
                    title={p}
                  >
                    <div className="absolute left-0 top-2 bottom-2 w-0.5 rounded-full bg-[var(--color-accent)] scale-y-0 opacity-0 transition-all duration-200 group-hover/menuitem:scale-y-100 group-hover/menuitem:opacity-100 group-hover/menuitem:shadow-[0_0_8px_var(--color-accent)]" />
                    <Clock size={12} className="opacity-40" />
                    <span className="flex-1 truncate">{p.split(/[/\\]/).pop()}</span>
                  </button>
                ))}
              </>
            )}

            <div className="my-1.5 h-px bg-white/[0.06] mx-2" />
            
            <button
              onClick={() => {
                updateSettings({ visibleGroupId: group.id, visibleProjectId: null })
                setContextMenu(null)
              }}
              className={cn(
                'group/menuitem relative flex h-8.5 w-full items-center gap-3 px-3 rounded-[var(--radius-md)] text-[13px] transition-all duration-200',
                'text-[var(--color-text-secondary)] hover:bg-[var(--color-accent)]/15 hover:text-white',
                visibleGroupId === group.id && !visibleProjectId && 'text-[var(--color-accent)]',
              )}
            >
              <div className="absolute left-0 top-2 bottom-2 w-0.5 rounded-full bg-[var(--color-accent)] scale-y-0 opacity-0 transition-all duration-200 group-hover/menuitem:scale-y-100 group-hover/menuitem:opacity-100 group-hover/menuitem:shadow-[0_0_8px_var(--color-accent)]" />
              <Eye size={14} /> <span className="flex-1">只显示当前分组</span>
            </button>
            <button
              onClick={() => {
                updateSettings({ visibleGroupId: null, visibleProjectId: null })
                setContextMenu(null)
              }}
              className="group/menuitem relative flex h-8.5 w-full items-center gap-3 px-3 rounded-[var(--radius-md)] text-[13px] transition-all duration-200 text-[var(--color-text-secondary)] hover:bg-[var(--color-accent)]/15 hover:text-white"
            >
              <div className="absolute left-0 top-2 bottom-2 w-0.5 rounded-full bg-[var(--color-accent)] scale-y-0 opacity-0 transition-all duration-200 group-hover/menuitem:scale-y-100 group-hover/menuitem:opacity-100 group-hover/menuitem:shadow-[0_0_8px_var(--color-accent)]" />
              <List size={14} /> <span className="flex-1">显示所有分组</span>
            </button>
            <button
              onClick={() => {
                setContextMenu(null)
                setEditing(true)
                setEditName(group.name)
              }}
              className="group/menuitem relative flex h-8.5 w-full items-center gap-3 px-3 rounded-[var(--radius-md)] text-[13px] transition-all duration-200 text-[var(--color-text-secondary)] hover:bg-[var(--color-accent)]/15 hover:text-white"
            >
              <div className="absolute left-0 top-2 bottom-2 w-0.5 rounded-full bg-[var(--color-accent)] scale-y-0 opacity-0 transition-all duration-200 group-hover/menuitem:scale-y-100 group-hover/menuitem:opacity-100 group-hover/menuitem:shadow-[0_0_8px_var(--color-accent)]" />
              <Edit3 size={14} /> <span className="flex-1">重命名</span>
            </button>
            {/* Color picker */}
            <div className="my-1.5 h-px bg-white/[0.06] mx-2" />
            <div className="px-3 py-1.5">
              <div className="flex items-center gap-1.5 mb-2">
                <Palette size={12} className="text-[var(--color-text-tertiary)] opacity-60" />
                <span className="text-[10px] font-black uppercase tracking-[0.2em] text-[var(--color-text-tertiary)] opacity-60">标记颜色</span>
              </div>
              <div className="grid grid-cols-10 gap-1.5">
                {GROUP_COLOR_PRESETS.map((c) => (
                  <button
                    key={c}
                    onClick={() => {
                      updateGroup(group.id, { color: c })
                      setCustomColorDraft(c)
                      setContextMenu(null)
                    }}
                    className={cn(
                      'h-4.5 w-4.5 rounded-full ring-2 ring-transparent transition-all hover:scale-110 active:scale-95',
                      group.color === c ? 'ring-white shadow-[0_0_8px_rgba(255,255,255,0.4)]' : 'hover:ring-white/20',
                    )}
                    style={{ backgroundColor: c }}
                  />
                ))}
              </div>
              <div className="mt-3 flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                <input
                  type="color"
                  value={normalizeGroupColor(group.color)}
                  onChange={(event) => commitCustomColor(event.target.value)}
                  className="h-7 w-8 shrink-0 cursor-pointer rounded-[var(--radius-sm)] border border-white/[0.12] bg-transparent p-0.5"
                  title="自定义颜色"
                />
                <input
                  value={customColorDraft}
                  onChange={(event) => setCustomColorDraft(event.target.value)}
                  onBlur={() => commitCustomColor(customColorDraft)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') event.currentTarget.blur()
                    if (event.key === 'Escape') {
                      setCustomColorDraft(normalizeGroupColor(group.color))
                      event.currentTarget.blur()
                    }
                  }}
                  spellCheck={false}
                  className={cn(
                    'h-7 min-w-0 flex-1 rounded-[var(--radius-sm)] border border-white/[0.1] bg-black/20 px-2',
                    'font-mono text-[11px] text-[var(--color-text-secondary)] outline-none transition-colors',
                    ' focus:text-[var(--color-text-primary)]',
                  )}
                />
              </div>
            </div>
            <button
              onClick={() => { setContextMenu(null); handleDelete() }}
              className="group/item relative flex h-8.5 w-full items-center gap-3 px-3 rounded-[var(--radius-md)] text-[13px] transition-all duration-200 text-[var(--color-error)] hover:bg-[var(--color-error)]/15 border-t border-white/[0.05] mt-1 pt-1"
            >
              <Trash2 size={14} /> <span className="flex-1">删除</span>
            </button>
          </div>
        </>
      )}

      {/* Projects list */}
      {(!group.collapsed || visibleProjectId) && (
        <div className="flex flex-col pb-1">
          {projects.map((project) => (
            <ProjectItem key={project.id} project={project} groupColor={group.color} onOpenProject={onOpenProject} />
          ))}
        </div>
      )}

      {/* Group separator */}
      <div className="mx-3 border-b border-[var(--color-border)]/40" />
    </div>
  )
}
