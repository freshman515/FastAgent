import { Plus, Play, Trash2, Edit3, Check, X } from 'lucide-react'
import { useCallback, useState } from 'react'
import { cn } from '@/lib/utils'
import { useUIStore } from '@/stores/ui'
import { useSessionsStore } from '@/stores/sessions'
import { usePanesStore } from '@/stores/panes'

interface QuickCommand {
  id: string
  name: string
  command: string
}

function getCommands(): QuickCommand[] {
  return useUIStore.getState().settings.quickCommands ?? []
}

function saveCommands(commands: QuickCommand[]): void {
  useUIStore.getState().updateSettings({ quickCommands: commands })
}

export function QuickCommands(): JSX.Element {
  const [commands, setCommands] = useState<QuickCommand[]>(getCommands)
  const [adding, setAdding] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [command, setCommand] = useState('')

  const refresh = useCallback(() => setCommands(getCommands()), [])

  const handleAdd = useCallback(() => {
    if (!name.trim() || !command.trim()) return
    const cmd: QuickCommand = { id: `qc-${Date.now()}`, name: name.trim(), command: command.trim() }
    const updated = [...commands, cmd]
    saveCommands(updated)
    setCommands(updated)
    setName('')
    setCommand('')
    setAdding(false)
  }, [name, command, commands])

  const handleDelete = useCallback((id: string) => {
    const updated = commands.filter((c) => c.id !== id)
    saveCommands(updated)
    setCommands(updated)
  }, [commands])

  const handleEdit = useCallback((id: string) => {
    const cmd = commands.find((c) => c.id === id)
    if (!cmd) return
    setEditingId(id)
    setName(cmd.name)
    setCommand(cmd.command)
  }, [commands])

  const handleSaveEdit = useCallback(() => {
    if (!editingId || !name.trim() || !command.trim()) return
    const updated = commands.map((c) =>
      c.id === editingId ? { ...c, name: name.trim(), command: command.trim() } : c,
    )
    saveCommands(updated)
    setCommands(updated)
    setEditingId(null)
    setName('')
    setCommand('')
  }, [editingId, name, command, commands])

  const handleSend = useCallback((cmd: string) => {
    const activeSessionId = usePanesStore.getState().paneActiveSession[usePanesStore.getState().activePaneId]
    if (!activeSessionId) return
    const session = useSessionsStore.getState().sessions.find((s) => s.id === activeSessionId)
    if (!session?.ptyId) return
    // Use \r for PTY (terminal expects carriage return to execute)
    window.api.session.write(session.ptyId, cmd + '\r')
  }, [])

  const INPUT = 'w-full rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-bg-primary)] px-2 py-1 text-[var(--ui-font-xs)] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-tertiary)] outline-none focus:border-[var(--color-accent)]'

  return (
    <div className="p-3 flex flex-col gap-2">
      {/* Command list */}
      {commands.map((cmd) => (
        <div
          key={cmd.id}
          className="group rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg-primary)] p-2"
        >
          {editingId === cmd.id ? (
            <div className="flex flex-col gap-1.5">
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" className={INPUT} />
              <textarea value={command} onChange={(e) => setCommand(e.target.value)} placeholder="Command..." rows={2} className={cn(INPUT, 'resize-none')} />
              <div className="flex justify-end gap-1">
                <button onClick={() => { setEditingId(null); setName(''); setCommand('') }} className="p-1 text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]"><X size={13} /></button>
                <button onClick={handleSaveEdit} className="p-1 text-[var(--color-success)] hover:text-[var(--color-success)]"><Check size={13} /></button>
              </div>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between mb-1">
                <span className="text-[var(--ui-font-xs)] font-medium text-[var(--color-text-primary)]">{cmd.name}</span>
                <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button onClick={() => handleSend(cmd.command)} className="p-1 rounded text-[var(--color-success)] hover:bg-[var(--color-bg-surface)]" title="Send to session"><Play size={11} fill="currentColor" /></button>
                  <button onClick={() => handleEdit(cmd.id)} className="p-1 rounded text-[var(--color-text-tertiary)] hover:bg-[var(--color-bg-surface)]" title="Edit"><Edit3 size={11} /></button>
                  <button onClick={() => handleDelete(cmd.id)} className="p-1 rounded text-[var(--color-error)] hover:bg-[var(--color-bg-surface)]" title="Delete"><Trash2 size={11} /></button>
                </div>
              </div>
              <pre className="text-[10px] leading-tight text-[var(--color-text-tertiary)] font-mono whitespace-pre-wrap break-all">{cmd.command}</pre>
            </>
          )}
        </div>
      ))}

      {/* Add form */}
      {adding ? (
        <div className="rounded-[var(--radius-md)] border border-[var(--color-accent)]/30 bg-[var(--color-bg-primary)] p-2 flex flex-col gap-1.5">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Command name" className={INPUT} autoFocus
            onKeyDown={(e) => { if (e.key === 'Enter') handleAdd(); if (e.key === 'Escape') setAdding(false) }} />
          <textarea value={command} onChange={(e) => setCommand(e.target.value)} placeholder="Command or prompt..." rows={3} className={cn(INPUT, 'resize-none')}
            onKeyDown={(e) => { if (e.key === 'Enter' && e.ctrlKey) handleAdd(); if (e.key === 'Escape') setAdding(false) }} />
          <div className="flex justify-end gap-1.5">
            <button onClick={() => setAdding(false)} className="px-2 py-1 text-[var(--ui-font-xs)] text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]">Cancel</button>
            <button onClick={handleAdd} className="px-2 py-1 rounded-[var(--radius-sm)] bg-[var(--color-accent)] text-[var(--ui-font-xs)] text-white hover:opacity-90">Add</button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setAdding(true)}
          className="flex items-center justify-center gap-1.5 rounded-[var(--radius-md)] border border-dashed border-[var(--color-border)] py-2 text-[var(--ui-font-xs)] text-[var(--color-text-tertiary)] hover:border-[var(--color-accent)] hover:text-[var(--color-accent)] transition-colors"
        >
          <Plus size={13} /> Add Command
        </button>
      )}
    </div>
  )
}
