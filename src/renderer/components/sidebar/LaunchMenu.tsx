import { Play, Plus, Edit3, Trash2, X, Check } from 'lucide-react'
import { createPortal } from 'react-dom'
import { useCallback, useMemo, useState } from 'react'
import { cn } from '@/lib/utils'
import { useLaunchesStore, LAUNCH_PRESETS, type LaunchProfile } from '@/stores/launches'
import { useSessionsStore } from '@/stores/sessions'
import { usePanesStore } from '@/stores/panes'
import { useProjectsStore } from '@/stores/projects'
import { getDefaultWorktreeIdForProject } from '@/lib/project-context'

interface LaunchMenuProps {
  projectId: string
  projectPath: string
  position: { x: number; y: number }
  onClose: () => void
}

const INPUT = 'w-full rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-bg-primary)] px-2 py-1 text-[var(--ui-font-xs)] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-tertiary)] outline-none focus:border-[var(--color-accent)]'

function ProfileEditor({ projectId, initial, onSave, onCancel }: {
  projectId: string
  initial?: LaunchProfile
  onSave: (data: Omit<LaunchProfile, 'id' | 'projectId'>) => void
  onCancel: () => void
}): JSX.Element {
  const [name, setName] = useState(initial?.name ?? '')
  const [command, setCommand] = useState(initial?.command ?? '')
  const [args, setArgs] = useState(initial?.args ?? '')
  const [cwd, setCwd] = useState(initial?.cwd ?? '')
  const [env, setEnv] = useState(initial?.env ?? '')
  const [icon, setIcon] = useState(initial?.icon ?? '▶')
  const [color, setColor] = useState(initial?.color ?? '#3ecf7b')

  return (
    <div className="flex flex-col gap-2 p-3">
      {/* Presets */}
      {!initial && (
        <div className="flex flex-wrap gap-1 pb-1 border-b border-[var(--color-border)]">
          {LAUNCH_PRESETS.map((p) => (
            <button
              key={p.name}
              onClick={() => { setName(p.name); setCommand(p.command); setArgs(p.args); setIcon(p.icon); setColor(p.color) }}
              className="rounded px-1.5 py-0.5 text-[10px] bg-[var(--color-bg-surface)] text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)] transition-colors"
            >
              {p.icon} {p.name}
            </button>
          ))}
        </div>
      )}

      <div className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-1.5 items-center">
        <span className="text-[var(--ui-font-2xs)] text-[var(--color-text-tertiary)]">名称</span>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="我的应用" className={INPUT} autoFocus />

        <span className="text-[var(--ui-font-2xs)] text-[var(--color-text-tertiary)]">命令</span>
        <input value={command} onChange={(e) => setCommand(e.target.value)} placeholder="dotnet / npm / python" className={INPUT} />

        <span className="text-[var(--ui-font-2xs)] text-[var(--color-text-tertiary)]">参数</span>
        <input value={args} onChange={(e) => setArgs(e.target.value)} placeholder="run --project ./MyApp" className={INPUT} />

        <span className="text-[var(--ui-font-2xs)] text-[var(--color-text-tertiary)]">工作目录</span>
        <input value={cwd} onChange={(e) => setCwd(e.target.value)} placeholder="(项目根目录)" className={INPUT} />

        <span className="text-[var(--ui-font-2xs)] text-[var(--color-text-tertiary)]">环境变量</span>
        <textarea value={env} onChange={(e) => setEnv(e.target.value)} placeholder="KEY=VALUE（每行一条）" rows={2} className={cn(INPUT, 'resize-none')} />

        <span className="text-[var(--ui-font-2xs)] text-[var(--color-text-tertiary)]">颜色</span>
        <div className="flex gap-1.5">
          {['#3ecf7b', '#5fa0f5', '#7c6aef', '#f0a23b', '#ef5757', '#61dafb', '#512bd4', '#8e8e96'].map((c) => (
            <button
              key={c}
              onClick={() => setColor(c)}
              className={cn('h-4 w-4 rounded-full border-2 transition-transform hover:scale-125', color === c ? 'border-white' : 'border-transparent')}
              style={{ backgroundColor: c }}
            />
          ))}
        </div>
      </div>

      <div className="flex justify-end gap-1.5 pt-1">
        <button onClick={onCancel} className="px-2 py-1 text-[var(--ui-font-xs)] text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]">取消</button>
        <button
          onClick={() => { if (name.trim() && command.trim()) onSave({ name, command, args, cwd, env, icon, color }) }}
          disabled={!name.trim() || !command.trim()}
          className="flex items-center gap-1 rounded-[var(--radius-sm)] bg-[var(--color-accent)] px-3 py-1 text-[var(--ui-font-xs)] text-white hover:opacity-90 disabled:opacity-40"
        >
          <Check size={11} /> {initial ? '保存' : '添加'}
        </button>
      </div>
    </div>
  )
}

export function LaunchMenu({ projectId, projectPath, position, onClose }: LaunchMenuProps): JSX.Element {
  const allProfiles = useLaunchesStore((s) => s.profiles)
  const profiles = useMemo(() => allProfiles.filter((p) => p.projectId === projectId), [allProfiles, projectId])
  const addProfile = useLaunchesStore((s) => s.addProfile)
  const updateProfile = useLaunchesStore((s) => s.updateProfile)
  const removeProfile = useLaunchesStore((s) => s.removeProfile)

  const [mode, setMode] = useState<'list' | 'add' | 'edit'>('list')
  const [editingId, setEditingId] = useState<string | null>(null)

  const handleRun = useCallback((profile: LaunchProfile) => {
    // Parse env string into Record
    const envMap: Record<string, string> = {}
    for (const line of profile.env.split('\n')) {
      const eq = line.indexOf('=')
      if (eq > 0) envMap[line.slice(0, eq).trim()] = line.slice(eq + 1).trim()
    }

    // Build command string to send to a new terminal session
    const fullCmd = profile.args ? `${profile.command} ${profile.args}` : profile.command
    const cwd = profile.cwd ? `${projectPath}/${profile.cwd}` : projectPath

    // Create a terminal session
    const worktreeId = getDefaultWorktreeIdForProject(projectId)
    const sid = useSessionsStore.getState().addSession(projectId, 'terminal', worktreeId)
    useSessionsStore.getState().updateSession(sid, { name: `${profile.icon} ${profile.name}`, color: profile.color })

    const paneStore = usePanesStore.getState()
    paneStore.addSessionToPane(paneStore.activePaneId, sid)
    paneStore.setPaneActiveSession(paneStore.activePaneId, sid)
    useSessionsStore.getState().setActive(sid)
    useProjectsStore.getState().selectProject(projectId)

    // Wait for PTY to be ready, then send the command
    const checkAndSend = (attempts = 0): void => {
      if (attempts > 30) return
      const session = useSessionsStore.getState().sessions.find((s) => s.id === sid)
      if (session?.ptyId) {
        // Set env vars first, then cd and run
        const envCmds = Object.entries(envMap).map(([k, v]) => `$env:${k}="${v}"`).join('; ')
        const cdCmd = profile.cwd ? `cd "${cwd}"` : ''
        const parts = [envCmds, cdCmd, fullCmd].filter(Boolean).join('; ')
        setTimeout(() => {
          const s = useSessionsStore.getState().sessions.find((x) => x.id === sid)
          if (s?.ptyId) window.api.session.write(s.ptyId, parts + '\r')
        }, 500)
      } else {
        setTimeout(() => checkAndSend(attempts + 1), 300)
      }
    }
    setTimeout(checkAndSend, 300)

    onClose()
  }, [projectId, projectPath, onClose])

  const editingProfile = editingId ? profiles.find((p) => p.id === editingId) : undefined

  return createPortal(
    <>
      <div className="fixed inset-0" style={{ zIndex: 9998 }} onClick={onClose} />
      <div
        style={{ top: position.y, left: position.x, zIndex: 9999 }}
        className="fixed w-[340px] rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg-tertiary)] shadow-xl shadow-black/40 overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--color-border)]">
          <span className="text-[var(--ui-font-sm)] font-semibold text-[var(--color-text-primary)]">
            {mode === 'add' ? '新建启动配置' : mode === 'edit' ? '编辑配置' : '运行'}
          </span>
          {mode === 'list' && (
            <button
              onClick={() => setMode('add')}
              className="flex items-center gap-1 text-[var(--ui-font-xs)] text-[var(--color-accent)] hover:text-[var(--color-text-primary)]"
            >
              <Plus size={12} /> 添加
            </button>
          )}
        </div>

        {mode === 'list' && (
          <div className="max-h-[300px] overflow-y-auto">
            {profiles.length === 0 ? (
              <div className="p-4 text-center">
                <p className="text-[var(--ui-font-xs)] text-[var(--color-text-tertiary)] mb-2">暂无启动配置</p>
                <button
                  onClick={() => setMode('add')}
                  className="flex items-center gap-1 mx-auto rounded-[var(--radius-sm)] border border-dashed border-[var(--color-border)] px-3 py-1.5 text-[var(--ui-font-xs)] text-[var(--color-text-tertiary)] hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]"
                >
                  <Plus size={12} /> 创建第一个配置
                </button>
              </div>
            ) : (
              profiles.map((p) => (
                <div key={p.id} className="group flex items-center gap-2 px-3 py-2 hover:bg-[var(--color-bg-surface)] transition-colors">
                  <button
                    onClick={() => handleRun(p)}
                    className="flex flex-1 items-center gap-2 min-w-0"
                  >
                    <span className="shrink-0 text-sm" style={{ color: p.color }}>{p.icon}</span>
                    <div className="flex flex-col items-start min-w-0">
                      <span className="text-[var(--ui-font-xs)] font-medium text-[var(--color-text-primary)] truncate">{p.name}</span>
                      <span className="text-[10px] text-[var(--color-text-tertiary)] truncate font-mono">{p.command} {p.args}</span>
                    </div>
                  </button>
                  <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onClick={() => handleRun(p)} className="p-1 rounded text-[var(--color-success)] hover:bg-[var(--color-bg-tertiary)]" title="运行">
                      <Play size={12} fill="currentColor" />
                    </button>
                    <button onClick={() => { setEditingId(p.id); setMode('edit') }} className="p-1 rounded text-[var(--color-text-tertiary)] hover:bg-[var(--color-bg-tertiary)]" title="编辑">
                      <Edit3 size={12} />
                    </button>
                    <button onClick={() => removeProfile(p.id)} className="p-1 rounded text-[var(--color-error)] hover:bg-[var(--color-bg-tertiary)]" title="删除">
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {mode === 'add' && (
          <ProfileEditor
            projectId={projectId}
            onSave={(data) => { addProfile({ ...data, projectId }); setMode('list') }}
            onCancel={() => setMode('list')}
          />
        )}

        {mode === 'edit' && editingProfile && (
          <ProfileEditor
            projectId={projectId}
            initial={editingProfile}
            onSave={(data) => { updateProfile(editingProfile.id, data); setMode('list'); setEditingId(null) }}
            onCancel={() => { setMode('list'); setEditingId(null) }}
          />
        )}
      </div>
    </>,
    document.body,
  )
}
