import { Check, ChevronDown, ChevronRight, Edit3, FolderPlus, Play, Plus, Trash2, X } from 'lucide-react'
import { createPortal } from 'react-dom'
import { useCallback, useState } from 'react'
import { cn, generateId } from '@/lib/utils'
import { usePanesStore } from '@/stores/panes'
import { useSessionsStore } from '@/stores/sessions'
import { type QuickCommand, useUIStore } from '@/stores/ui'

const UNGROUPED_SECTION_ID = '__ungrouped__'

function toGroupId(value: string, validGroupIds: Set<string>): string | undefined {
  return value && validGroupIds.has(value) ? value : undefined
}

export function QuickCommands(): JSX.Element {
  const commands = useUIStore((s) => s.settings.quickCommands)
  const groups = useUIStore((s) => s.settings.quickCommandGroups)
  const updateSettings = useUIStore((s) => s.updateSettings)

  const [addingCommand, setAddingCommand] = useState(false)
  const [addingGroup, setAddingGroup] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draftName, setDraftName] = useState('')
  const [draftCommand, setDraftCommand] = useState('')
  const [draftGroupId, setDraftGroupId] = useState('')
  const [draftGroupName, setDraftGroupName] = useState('')
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({})
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; commandId: string } | null>(null)

  const validGroupIds = new Set(groups.map((group) => group.id))
  const sections = [
    ...groups.map((group) => ({
      id: group.id,
      name: group.name,
      commands: commands.filter((command) => command.groupId === group.id),
    })),
    {
      id: UNGROUPED_SECTION_ID,
      name: '未分组',
      commands: commands.filter((command) => !command.groupId),
    },
  ].filter((section) => section.id !== UNGROUPED_SECTION_ID || section.commands.length > 0)

  const resetCommandDraft = useCallback(() => {
    setDraftName('')
    setDraftCommand('')
    setDraftGroupId('')
  }, [])

  const cancelCommandEdit = useCallback(() => {
    setEditingId(null)
    setAddingCommand(false)
    resetCommandDraft()
  }, [resetCommandDraft])

  const handleAddGroup = useCallback(() => {
    const name = draftGroupName.trim()
    if (!name) return
    const id = `qcg-${generateId()}`
    updateSettings({
      quickCommandGroups: [...groups, { id, name }],
    })
    setCollapsedSections((current) => ({ ...current, [id]: false }))
    setDraftGroupName('')
    setAddingGroup(false)
  }, [draftGroupName, groups, updateSettings])

  const handleAddCommand = useCallback(() => {
    const name = draftName.trim()
    const command = draftCommand.trim()
    if (!name || !command) return
    updateSettings({
      quickCommands: [
        ...commands,
        {
          id: `qc-${generateId()}`,
          name,
          command,
          groupId: toGroupId(draftGroupId, validGroupIds),
        },
      ],
    })
    setAddingCommand(false)
    resetCommandDraft()
  }, [commands, draftCommand, draftGroupId, draftName, resetCommandDraft, updateSettings, validGroupIds])

  const handleDeleteCommand = useCallback((id: string) => {
    updateSettings({
      quickCommands: commands.filter((command) => command.id !== id),
    })
    if (editingId === id) {
      cancelCommandEdit()
    }
  }, [cancelCommandEdit, commands, editingId, updateSettings])

  const handleEditCommand = useCallback((command: QuickCommand) => {
    setEditingId(command.id)
    setAddingCommand(false)
    setDraftName(command.name)
    setDraftCommand(command.command)
    setDraftGroupId(command.groupId ?? '')
  }, [])

  const handleSaveEdit = useCallback(() => {
    const name = draftName.trim()
    const command = draftCommand.trim()
    if (!editingId || !name || !command) return
    updateSettings({
      quickCommands: commands.map((item) =>
        item.id === editingId
          ? { ...item, name, command, groupId: toGroupId(draftGroupId, validGroupIds) }
          : item,
      ),
    })
    cancelCommandEdit()
  }, [cancelCommandEdit, commands, draftCommand, draftGroupId, draftName, editingId, updateSettings, validGroupIds])

  const handleMoveCommand = useCallback((id: string, nextGroupId: string) => {
    updateSettings({
      quickCommands: commands.map((command) =>
        command.id === id
          ? { ...command, groupId: toGroupId(nextGroupId, validGroupIds) }
          : command,
      ),
    })
  }, [commands, updateSettings, validGroupIds])

  const handleContextMenu = useCallback((e: React.MouseEvent, commandId: string) => {
    e.preventDefault()
    setContextMenu({ x: e.clientX, y: e.clientY, commandId })
  }, [])

  const handleSend = useCallback((command: string) => {
    const panesStore = usePanesStore.getState()
    const activeSessionId = panesStore.paneActiveSession[panesStore.activePaneId]
    if (!activeSessionId) return
    const session = useSessionsStore.getState().sessions.find((item) => item.id === activeSessionId)
    if (!session?.ptyId) return
    window.api.session.write(session.ptyId, command + '\r')
  }, [])

  const toggleSection = useCallback((sectionId: string) => {
    setCollapsedSections((current) => ({
      ...current,
      [sectionId]: !current[sectionId],
    }))
  }, [])

  const contextCommand = contextMenu
    ? commands.find((command) => command.id === contextMenu.commandId) ?? null
    : null

  const INPUT = 'w-full rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-bg-primary)] px-2 py-1 text-[var(--ui-font-xs)] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-tertiary)] outline-none'
  const SELECT = cn(INPUT, 'h-7 py-0')

  return (
    <div className="flex flex-col gap-3 p-3">
      {sections.map((section) => {
        const collapsed = collapsedSections[section.id] ?? false

        return (
          <div
            key={section.id}
            className="overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg-primary)]"
          >
            <button
              onClick={() => toggleSection(section.id)}
              className="flex w-full items-center justify-between px-2.5 py-2 text-left hover:bg-[var(--color-bg-surface)]"
            >
              <div className="flex items-center gap-1.5">
                {collapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
                <span className="text-[var(--ui-font-xs)] font-medium text-[var(--color-text-primary)]">
                  {section.name}
                </span>
              </div>
              <span className="text-[10px] text-[var(--color-text-tertiary)]">
                {section.commands.length}
              </span>
            </button>

            {!collapsed && (
              <div className="border-t border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-2 py-2">
                {section.commands.length === 0 ? (
                  <div className="rounded-[var(--radius-sm)] border border-dashed border-[var(--color-border)] px-2 py-3 text-center text-[10px] text-[var(--color-text-tertiary)]">
                    这个分组里还没有命令
                  </div>
                ) : (
                  <div className="flex flex-col gap-2">
                    {section.commands.map((command) => (
                      <div
                        key={command.id}
                        className="group rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-bg-primary)] p-2"
                        onContextMenu={(e) => handleContextMenu(e, command.id)}
                      >
                        {editingId === command.id ? (
                          <div className="flex flex-col gap-1.5">
                            <input
                              value={draftName}
                              onChange={(e) => setDraftName(e.target.value)}
                              placeholder="命令名称"
                              className={INPUT}
                            />
                            <textarea
                              value={draftCommand}
                              onChange={(e) => setDraftCommand(e.target.value)}
                              placeholder="命令内容..."
                              rows={3}
                              className={cn(INPUT, 'resize-none')}
                            />
                            <select
                              value={draftGroupId}
                              onChange={(e) => setDraftGroupId(e.target.value)}
                              className={SELECT}
                            >
                              <option value="">未分组</option>
                              {groups.map((group) => (
                                <option key={group.id} value={group.id}>
                                  {group.name}
                                </option>
                              ))}
                            </select>
                            <div className="flex justify-end gap-1">
                              <button
                                onClick={cancelCommandEdit}
                                className="p-1 text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]"
                                title="取消"
                              >
                                <X size={13} />
                              </button>
                              <button
                                onClick={handleSaveEdit}
                                className="p-1 text-[var(--color-success)] hover:text-[var(--color-success)]"
                                title="保存"
                              >
                                <Check size={13} />
                              </button>
                            </div>
                          </div>
                        ) : (
                          <>
                            <div className="mb-1 flex items-center justify-between gap-2">
                              <span className="truncate text-[var(--ui-font-xs)] font-medium text-[var(--color-text-primary)]">
                                {command.name}
                              </span>
                              <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                                <button
                                  onClick={() => handleSend(command.command)}
                                  className="rounded p-1 text-[var(--color-success)] hover:bg-[var(--color-bg-surface)]"
                                  title="发送到当前会话"
                                >
                                  <Play size={11} fill="currentColor" />
                                </button>
                                <button
                                  onClick={() => handleEditCommand(command)}
                                  className="rounded p-1 text-[var(--color-text-tertiary)] hover:bg-[var(--color-bg-surface)]"
                                  title="编辑命令"
                                >
                                  <Edit3 size={11} />
                                </button>
                                <button
                                  onClick={() => handleDeleteCommand(command.id)}
                                  className="rounded p-1 text-[var(--color-error)] hover:bg-[var(--color-bg-surface)]"
                                  title="删除命令"
                                >
                                  <Trash2 size={11} />
                                </button>
                              </div>
                            </div>
                            <pre className="break-all whitespace-pre-wrap font-mono text-[10px] leading-tight text-[var(--color-text-tertiary)]">
                              {command.command}
                            </pre>
                          </>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )
      })}

      {addingGroup ? (
        <div className="rounded-[var(--radius-md)] border border-[var(--color-accent)]/30 bg-[var(--color-bg-primary)] p-2">
          <div className="flex flex-col gap-1.5">
            <input
              value={draftGroupName}
              onChange={(e) => setDraftGroupName(e.target.value)}
              placeholder="分组名称"
              className={INPUT}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleAddGroup()
                if (e.key === 'Escape') {
                  setAddingGroup(false)
                  setDraftGroupName('')
                }
              }}
            />
            <div className="flex justify-end gap-1.5">
              <button
                onClick={() => {
                  setAddingGroup(false)
                  setDraftGroupName('')
                }}
                className="px-2 py-1 text-[var(--ui-font-xs)] text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]"
              >
                取消
              </button>
              <button
                onClick={handleAddGroup}
                className="rounded-[var(--radius-sm)] bg-[var(--color-accent)] px-2 py-1 text-[var(--ui-font-xs)] text-white hover:opacity-90"
              >
                创建分组
              </button>
            </div>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setAddingGroup(true)}
          className="flex items-center justify-center gap-1.5 rounded-[var(--radius-md)] border border-dashed border-[var(--color-border)] py-2 text-[var(--ui-font-xs)] text-[var(--color-text-tertiary)] transition-colors hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]"
        >
          <FolderPlus size={13} /> 新建分组
        </button>
      )}

      {addingCommand ? (
        <div className="rounded-[var(--radius-md)] border border-[var(--color-accent)]/30 bg-[var(--color-bg-primary)] p-2">
          <div className="flex flex-col gap-1.5">
            <input
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              placeholder="命令名称"
              className={INPUT}
              autoFocus
            />
            <textarea
              value={draftCommand}
              onChange={(e) => setDraftCommand(e.target.value)}
              placeholder="命令或 prompt..."
              rows={3}
              className={cn(INPUT, 'resize-none')}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && e.ctrlKey) handleAddCommand()
                if (e.key === 'Escape') cancelCommandEdit()
              }}
            />
            <select
              value={draftGroupId}
              onChange={(e) => setDraftGroupId(e.target.value)}
              className={SELECT}
            >
              <option value="">未分组</option>
              {groups.map((group) => (
                <option key={group.id} value={group.id}>
                  {group.name}
                </option>
              ))}
            </select>
            <div className="flex justify-end gap-1.5">
              <button
                onClick={cancelCommandEdit}
                className="px-2 py-1 text-[var(--ui-font-xs)] text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]"
              >
                取消
              </button>
              <button
                onClick={handleAddCommand}
                className="rounded-[var(--radius-sm)] bg-[var(--color-accent)] px-2 py-1 text-[var(--ui-font-xs)] text-white hover:opacity-90"
              >
                添加命令
              </button>
            </div>
          </div>
        </div>
      ) : (
        <button
          onClick={() => {
            setEditingId(null)
            resetCommandDraft()
            setAddingCommand(true)
          }}
          className="flex items-center justify-center gap-1.5 rounded-[var(--radius-md)] border border-dashed border-[var(--color-border)] py-2 text-[var(--ui-font-xs)] text-[var(--color-text-tertiary)] transition-colors hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]"
        >
          <Plus size={13} /> 添加命令
        </button>
      )}

      {contextMenu && contextCommand && createPortal(
        <>
          <div className="fixed inset-0" style={{ zIndex: 9998 }} onClick={() => setContextMenu(null)} />
          <div
            style={{ top: contextMenu.y, left: contextMenu.x, zIndex: 9999 }}
            className="fixed w-48 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg-tertiary)] py-1 shadow-lg shadow-black/30"
          >
            <button
              onClick={() => {
                setContextMenu(null)
                handleSend(contextCommand.command)
              }}
              className="flex w-full items-center px-3 py-1.5 text-[var(--ui-font-sm)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-surface)] hover:text-[var(--color-text-primary)]"
            >
              发送到当前会话
            </button>
            <button
              onClick={() => {
                setContextMenu(null)
                handleEditCommand(contextCommand)
              }}
              className="flex w-full items-center px-3 py-1.5 text-[var(--ui-font-sm)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-surface)] hover:text-[var(--color-text-primary)]"
            >
              编辑命令
            </button>
            <div className="my-0.5 h-px bg-[var(--color-border)]" />
            <div className="px-3 py-1 text-[var(--ui-font-2xs)] text-[var(--color-text-tertiary)]">
              移动到分组
            </div>
            <button
              onClick={() => {
                handleMoveCommand(contextCommand.id, '')
                setContextMenu(null)
              }}
              className={cn(
                'flex w-full items-center px-3 py-1.5 text-left text-[var(--ui-font-sm)] hover:bg-[var(--color-bg-surface)]',
                !contextCommand.groupId
                  ? 'text-[var(--color-accent)]'
                  : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]',
              )}
            >
              未分组
            </button>
            {groups.map((group) => (
              <button
                key={group.id}
                onClick={() => {
                  handleMoveCommand(contextCommand.id, group.id)
                  setContextMenu(null)
                }}
                className={cn(
                  'flex w-full items-center px-3 py-1.5 text-left text-[var(--ui-font-sm)] hover:bg-[var(--color-bg-surface)]',
                  contextCommand.groupId === group.id
                    ? 'text-[var(--color-accent)]'
                    : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]',
                )}
              >
                {group.name}
              </button>
            ))}
            <div className="my-0.5 h-px bg-[var(--color-border)]" />
            <button
              onClick={() => {
                setContextMenu(null)
                handleDeleteCommand(contextCommand.id)
              }}
              className="flex w-full items-center px-3 py-1.5 text-[var(--ui-font-sm)] text-[var(--color-error)] hover:bg-[var(--color-bg-surface)]"
            >
              删除命令
            </button>
          </div>
        </>,
        document.body,
      )}
    </div>
  )
}
