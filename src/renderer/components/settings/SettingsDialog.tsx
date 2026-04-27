import { X, Settings, Type, Terminal, Layers, AudioLines, BarChart3, ExternalLink, Trash2, Bot, Eye, EyeOff, FileCode2, Search, Palette, GitBranch, Bell, Volume2, SplitSquareHorizontal, Briefcase, Play, Plus, Pencil } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { cn, generateId } from '@/lib/utils'
import {
  CANVAS_FOCUS_FONT_PX_MAX,
  CANVAS_FOCUS_FONT_PX_MIN,
  CANVAS_SESSION_CARD_HEIGHT_MAX,
  CANVAS_SESSION_CARD_HEIGHT_MIN,
  CANVAS_SESSION_CARD_WIDTH_MAX,
  CANVAS_SESSION_CARD_WIDTH_MIN,
  useUIStore,
  type AppSettings,
  type CustomSessionDefinition,
} from '@/stores/ui'
import { playTaskCompleteSound } from '@/lib/notificationSound'
import { useClaudeGuiStore, type ClaudeGuiPreferences } from '@/stores/claudeGui'
import { useGroupsStore } from '@/stores/groups'
import { useSessionsStore } from '@/stores/sessions'
import { usePanesStore } from '@/stores/panes'
import { TemplatesPage } from './TemplatesPage'
import { getThemeNames, getXtermTheme, getAllCustomThemeNames, getTheme, type GhosttyTheme } from '@/lib/ghosttyTheme'
import { CustomThemeEditor } from './CustomThemeEditor'
import { parseThemeAuto } from '@/lib/themeImport'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { parseCustomSessionArgs } from '@/lib/createSession'
import { SessionIconView } from '@/components/session/SessionIconView'
import { filterSessionTypesForCurrentPlatform } from '@/lib/platformSessionTypes'

type SettingsPage = 'general' | 'sessions' | 'wsl' | 'workspace' | 'notifications' | 'titlebar' | 'git' | 'appearance' | 'terminal' | 'editor' | 'templates' | 'ai' | 'claudeGui'

const NAV_ITEMS: Array<{ id: SettingsPage; label: string; description: string; icon: typeof Settings }> = [
  { id: 'general', label: '通用', description: '基础偏好与数据清理', icon: Settings },
  { id: 'sessions', label: '会话', description: '默认会话与自定义启动器', icon: Terminal },
  { id: 'wsl', label: 'WSL', description: 'WSL 会话环境与 PATH', icon: Terminal },
  { id: 'workspace', label: '工作区', description: '经典分屏与画布模式', icon: SplitSquareHorizontal },
  { id: 'notifications', label: '通知', description: '完成提醒与声音', icon: Bell },
  { id: 'titlebar', label: '标题栏', description: '顶部搜索与音乐显示', icon: Search },
  { id: 'git', label: 'Git', description: '改动视图与修复入口', icon: GitBranch },
  { id: 'appearance', label: '外观', description: '主题、字体与界面观感', icon: Type },
  { id: 'terminal', label: '终端', description: '终端字号与字体预览', icon: Terminal },
  { id: 'editor', label: '编辑器', description: '代码编辑体验与排版', icon: FileCode2 },
  { id: 'templates', label: '模板', description: '批量启动会话的预设', icon: Layers },
  { id: 'ai', label: 'AI 摘要', description: '终端摘要模型与提示词', icon: Bot },
  { id: 'claudeGui', label: 'Claude GUI', description: '内置 Claude 面板偏好', icon: Bot },
]
const isWindowsPlatform = (): boolean => window.api.platform === 'win32'

const PAGE_STACK = 'mx-auto flex w-full max-w-[980px] flex-col gap-5 pb-8'

const UI_FONT_OPTIONS = [
  "'Inter', 'Segoe UI', system-ui, sans-serif",
  "'Segoe UI', system-ui, sans-serif",
  "system-ui, sans-serif",
  "'Noto Sans SC', 'Microsoft YaHei', sans-serif",
]
const UI_FONT_LABELS = ['Inter', 'Segoe UI', 'System', 'Noto Sans SC']

const TERMINAL_FONT_OPTIONS = [
  "'JetBrainsMono Nerd Font', ui-monospace, monospace",
  "'JetBrains Mono', monospace",
  "'Cascadia Code', monospace",
  "'Fira Code', monospace",
  "'Consolas', monospace",
  "'Source Code Pro', monospace",
]
const TERMINAL_FONT_LABELS = ['JetBrainsMono NF', 'JetBrains Mono', 'Cascadia Code', 'Fira Code', 'Consolas', 'Source Code Pro']
const EDITOR_FONT_OPTIONS = TERMINAL_FONT_OPTIONS
const EDITOR_FONT_LABELS = TERMINAL_FONT_LABELS

// ─── Shared components ───

function PageIntro({ title, description }: { title: string; description: string }): JSX.Element {
  return (
    <div className="mb-4">
      <h3 className="text-[28px] font-bold tracking-tight text-white drop-shadow-sm">{title}</h3>
      <p className="mt-2 max-w-[640px] text-[13px] leading-relaxed text-[var(--color-text-secondary)]">{description}</p>
    </div>
  )
}

function FontSizeSlider({ label, value, min, max, onChange }: {
  label: string; value: number; min: number; max: number; onChange: (v: number) => void
}): JSX.Element {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-[12px] font-semibold tracking-tight text-[var(--color-text-primary)]">{label}</span>
        <span className="text-[11px] font-mono font-bold text-[var(--color-text-secondary)]">{value}px</span>
      </div>
      <input
        type="range" min={min} max={max} step={1} value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-white/[0.08] accent-[var(--color-accent)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]/50"
      />
    </div>
  )
}

function FontSelect({ label, value, options, labels, onChange }: {
  label: string; value: string; options: string[]; labels: string[]; onChange: (v: string) => void
}): JSX.Element {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-[12px] font-semibold tracking-tight text-[var(--color-text-primary)]">{label}</span>
      <div className="flex flex-wrap gap-1.5">
        {options.map((opt, i) => {
          const isSelected = value === opt;
          return (
            <button
              key={opt}
              onClick={() => onChange(opt)}
              className={cn(
                'rounded-full border px-3 py-1.5 text-[11px] font-medium transition-all duration-200',
                isSelected
                  ? 'border-[var(--color-accent)] bg-[var(--color-accent)]/15 text-[var(--color-accent)] drop-shadow-sm shadow-[inset_0_1px_4px_rgba(0,0,0,0.1)]'
                  : 'border-white/[0.06] bg-white/[0.02] text-[var(--color-text-secondary)] hover:bg-white/[0.06] hover:text-[var(--color-text-primary)]',
                'focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]/50'
              )}
              style={{ fontFamily: opt }}
            >
              {labels[i]}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function PixelNumberField({ label, value, min, max, step = 20, onChange }: {
  label: string
  value: number
  min: number
  max: number
  step?: number
  onChange: (v: number) => void
}): JSX.Element {
  const [draft, setDraft] = useState(String(value))

  useEffect(() => {
    setDraft(String(value))
  }, [value])

  const commitDraft = (): void => {
    const parsed = Number(draft)
    if (!Number.isFinite(parsed)) {
      setDraft(String(value))
      return
    }
    const nextValue = Math.round(Math.max(min, Math.min(max, parsed)))
    setDraft(String(nextValue))
    if (nextValue !== value) onChange(nextValue)
  }

  return (
    <label className="flex flex-1 flex-col gap-2">
      <span className="text-[12px] font-semibold tracking-tight text-[var(--color-text-primary)]">{label}</span>
      <div className="relative">
        <input
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commitDraft}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.currentTarget.blur()
            } else if (event.key === 'Escape') {
              setDraft(String(value))
              event.currentTarget.blur()
            }
          }}
          className={cn(
            'peer h-8 w-full rounded-md border border-white/[0.1] bg-black/20 pl-3 pr-8',
            'text-[12px] font-mono font-medium text-white placeholder:text-[var(--color-text-tertiary)]',
            'outline-none transition-all duration-200',
            'hover:bg-black/40 hover:border-white/[0.15]',
            'focus:border-[var(--color-accent)]/60 focus:bg-black/60 focus:shadow-[0_0_0_3px_var(--color-accent-muted)]'
          )}
        />
        <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-[10px] font-bold text-[var(--color-text-tertiary)]">px</span>
      </div>
    </label>
  )
}

function SettingsSection({ icon: Icon, title, description, children }: {
  icon: typeof Settings
  title: string
  description?: string
  children: React.ReactNode
}): JSX.Element {
  return (
    <section className="relative overflow-hidden rounded-[var(--radius-xl)] border border-white/[0.05] bg-[var(--color-bg-primary)]/30 px-6 py-5 shadow-sm backdrop-blur-md">
      {/* Subtle top glow */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/[0.05] to-transparent" />
      <header className="mb-5 flex items-center gap-3">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-[var(--color-accent)]/10 text-[var(--color-accent)] ring-1 ring-inset ring-[var(--color-accent)]/20 shadow-[inset_0_0_8px_var(--color-accent-muted)]">
          <Icon size={15} strokeWidth={2.5} />
        </div>
        <div className="flex flex-col">
          <h4 className="text-[13px] font-bold tracking-tight text-[var(--color-text-primary)]">{title}</h4>
          {description && (
            <p className="mt-0.5 text-[11px] text-[var(--color-text-tertiary)]">{description}</p>
          )}
        </div>
      </header>
      <div className="flex flex-col gap-4">
        {children}
      </div>
    </section>
  )
}

function PercentSlider({ label, value, onChange, trailing }: {
  label: string
  value: number // 0..1
  onChange: (v: number) => void
  trailing?: React.ReactNode
}): JSX.Element {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-[12px] font-semibold tracking-tight text-[var(--color-text-primary)]">{label}</span>
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-mono font-bold text-[var(--color-text-secondary)]">{Math.round(value * 100)}%</span>
          {trailing}
        </div>
      </div>
      <input
        type="range" min={0} max={100} step={1} value={Math.round(value * 100)}
        onChange={(e) => onChange(Number(e.target.value) / 100)}
        className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-white/[0.08] accent-[var(--color-accent)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]/50"
      />
    </div>
  )
}

function ToggleRow({ label, description, checked, onChange }: {
  label: string; description: string; checked: boolean; onChange: (v: boolean) => void
}): JSX.Element {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="flex flex-col min-w-0">
        <span className="text-[12px] font-semibold tracking-tight text-[var(--color-text-primary)]">{label}</span>
        <span className="text-[11px] text-[var(--color-text-tertiary)] mt-0.5 leading-snug">{description}</span>
      </div>
      <button
        onClick={() => onChange(!checked)}
        className={cn(
          'relative h-6 w-10 shrink-0 rounded-full transition-colors duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]/50',
          checked ? 'bg-[var(--color-accent)]' : 'bg-white/[0.08] hover:bg-white/[0.12]',
          'shadow-[inset_0_2px_4px_rgba(0,0,0,0.3)]'
        )}
      >
        <span
          className={cn(
            'absolute top-[2px] left-[2px] h-5 w-5 rounded-full bg-white transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]',
            'shadow-[0_2px_4px_rgba(0,0,0,0.4),0_0_1px_rgba(0,0,0,0.5)]',
            checked ? 'translate-x-4' : 'translate-x-0',
          )}
        />
      </button>
    </div>
  )
}

// ─── Pages ───

function SegmentedChoice<T extends string>({ value, options, onChange }: {
  value: T
  options: Array<{ id: T; label: string; desc?: string; icon?: typeof Settings }>
  onChange: (v: T) => void
}): JSX.Element {
  return (
    <div className="flex gap-2">
      {options.map(({ id, label, desc, icon: Icon }) => {
        const isSelected = value === id
        return (
          <button
            key={id}
            onClick={() => onChange(id)}
            className={cn(
              'group relative flex flex-1 flex-col overflow-hidden rounded-[var(--radius-md)] border px-3 py-2.5 text-left transition-all duration-200',
              isSelected
                ? 'border-[var(--color-accent)]/50 bg-[var(--color-accent)]/10 ring-1 ring-inset ring-[var(--color-accent)]/30 shadow-[inset_0_2px_10px_rgba(0,0,0,0.2)]'
                : 'border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.05] hover:border-white/[0.1]',
              'focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]/50'
            )}
          >
            {isSelected && (
              <div className="absolute inset-0 bg-gradient-to-b from-[var(--color-accent)]/10 to-transparent pointer-events-none" />
            )}
            <span className={cn(
              'relative z-10 flex items-center gap-1.5 text-[12px] font-bold tracking-tight transition-colors duration-200',
              isSelected ? 'text-[var(--color-accent)] drop-shadow-sm' : 'text-[var(--color-text-primary)] group-hover:text-[var(--color-accent)]/70'
            )}>
              {Icon && <Icon size={14} strokeWidth={2.5} />}
              {label}
            </span>
            {desc && (
              <span className={cn(
                'relative z-10 mt-1 text-[10px] leading-snug transition-colors duration-200',
                isSelected ? 'text-[var(--color-text-secondary)]' : 'text-[var(--color-text-tertiary)]'
              )}>{desc}</span>
            )}
          </button>
        )
      })}
    </div>
  )
}

const SESSION_TYPE_OPTIONS = [
  { id: 'browser', label: 'Browser' },
  { id: 'terminal', label: 'Terminal' },
  { id: 'terminal-wsl', label: 'Terminal(WSL)' },
  { id: 'claude-code', label: 'Claude Code' },
  { id: 'claude-code-yolo', label: 'Claude Code YOLO' },
  { id: 'claude-code-wsl', label: 'Claude Code(WSL)' },
  { id: 'claude-code-yolo-wsl', label: 'Claude Code YOLO(WSL)' },
  { id: 'codex', label: 'Codex' },
  { id: 'codex-yolo', label: 'Codex YOLO' },
  { id: 'codex-wsl', label: 'Codex(WSL)' },
  { id: 'codex-yolo-wsl', label: 'Codex YOLO(WSL)' },
  { id: 'gemini', label: 'Gemini' },
  { id: 'gemini-yolo', label: 'Gemini YOLO' },
  { id: 'opencode', label: 'OpenCode' },
] as const

function GeneralPage({ settings, onUpdate }: { settings: AppSettings; onUpdate: (k: keyof AppSettings, v: unknown) => void }): JSX.Element {
  const groups = useGroupsStore((s) => s.groups)
  const [confirmClearSessionsOpen, setConfirmClearSessionsOpen] = useState(false)

  const clearAllSessions = useCallback(() => {
    const sessions = useSessionsStore.getState().sessions
    for (const s of sessions) {
      if (s.ptyId) window.api.session.kill(s.ptyId).catch(() => {})
    }
    useSessionsStore.setState({ sessions: [], activeSessionId: null, outputStates: {}, closedStack: [] })
    usePanesStore.getState().initPane([], null)
    window.api.config.write('sessions', [])
    window.api.config.write('panes', {})
    setConfirmClearSessionsOpen(false)
  }, [])

  return (
    <div className={PAGE_STACK}>
      <PageIntro
        title="通用设置"
        description="只保留最基础的工作区偏好和数据清理，其余设置已按功能拆到独立页面。"
      />

      <SettingsSection icon={Briefcase} title="基础工作区" description="设置默认展示范围和启动窗口状态。">
        <div className="flex flex-col gap-1.5">
          <span className="text-[var(--ui-font-xs)] text-[var(--color-text-tertiary)]">默认显示的分组</span>
          <div className="flex flex-wrap gap-1">
            <button
              onClick={() => onUpdate('visibleGroupId', null)}
              className={cn(
                'flex items-center gap-2 rounded-[var(--radius-md)] border px-2.5 py-1 text-[var(--ui-font-sm)] transition-colors',
                settings.visibleGroupId === null
                  ? 'border-[var(--color-accent)] bg-[var(--color-accent-muted)] text-[var(--color-text-primary)]'
                  : 'border-[var(--color-border)] text-[var(--color-text-secondary)] hover:border-[var(--color-border-hover)]',
              )}
            >
              <div className="h-2 w-2 rounded-full bg-[var(--color-text-tertiary)]" />
              全部分组
            </button>
            {groups.map((g) => (
              <button
                key={g.id}
                onClick={() => onUpdate('visibleGroupId', g.id)}
                className={cn(
                  'flex items-center gap-2 rounded-[var(--radius-md)] border px-2.5 py-1 text-[var(--ui-font-sm)] transition-colors',
                  settings.visibleGroupId === g.id
                    ? 'border-[var(--color-accent)] bg-[var(--color-accent-muted)] text-[var(--color-text-primary)]'
                    : 'border-[var(--color-border)] text-[var(--color-text-secondary)] hover:border-[var(--color-border-hover)]',
                )}
              >
                <div className="h-2 w-2 rounded-full" style={{ backgroundColor: g.color }} />
                {g.name}
              </button>
            ))}
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="text-[var(--ui-font-xs)] text-[var(--color-text-tertiary)]">启动时窗口状态</span>
          <SegmentedChoice
            value={settings.startupWindowState}
            options={[
              { id: 'maximized', label: '最大化', desc: '启动后直接铺满屏幕' },
              { id: 'normal', label: '正常窗口', desc: '使用默认窗口尺寸启动' },
            ]}
            onChange={(v) => onUpdate('startupWindowState', v)}
          />
        </div>
      </SettingsSection>

      <SettingsSection icon={Trash2} title="数据清理" description="清空全部会话标签与分栏布局。项目、分组、主题会保留。">
        <button
          onClick={() => setConfirmClearSessionsOpen(true)}
          className={cn(
            'flex items-center gap-2 self-start rounded-[var(--radius-md)] border border-[var(--color-error)]/30 px-4 py-2',
            'text-[var(--ui-font-sm)] text-[var(--color-error)]',
            'hover:bg-[var(--color-error)]/10 transition-colors',
          )}
        >
          <Trash2 size={13} />
          清空全部会话
        </button>
      </SettingsSection>

      {confirmClearSessionsOpen && (
        <ConfirmDialog
          title="清空全部会话"
          message="确认清空所有会话标签和分栏布局吗？正在运行的会话会被停止。项目、分组、主题会保留。"
          confirmLabel="清空"
          cancelLabel="取消"
          danger
          onConfirm={clearAllSessions}
          onCancel={() => setConfirmClearSessionsOpen(false)}
        />
      )}
    </div>
  )
}

function SessionsPage({ settings, onUpdate }: { settings: AppSettings; onUpdate: (k: keyof AppSettings, v: unknown) => void }): JSX.Element {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState<CustomSessionDefinition>({
    id: '',
    name: '',
    icon: '⚙',
    command: '',
    args: '',
  })
  const [error, setError] = useState('')
  const editing = editingId !== null

  const startCreate = useCallback(() => {
    setEditingId('')
    setDraft({ id: '', name: '', icon: '⚙', command: '', args: '' })
    setError('')
  }, [])

  const startEdit = useCallback((definition: CustomSessionDefinition) => {
    setEditingId(definition.id)
    setDraft({ ...definition })
    setError('')
  }, [])

  const cancelEdit = useCallback(() => {
    setEditingId(null)
    setError('')
  }, [])

  const saveDefinition = useCallback(() => {
    const name = draft.name.trim()
    const command = draft.command.trim()
    if (!name) {
      setError('请输入会话名称')
      return
    }
    if (!command) {
      setError('请输入启动命令')
      return
    }

    const id = editingId || generateId()
    const nextDefinition: CustomSessionDefinition = {
      id,
      name,
      icon: draft.icon.trim() || '⚙',
      command,
      args: draft.args.trim(),
    }
    const exists = settings.customSessionDefinitions.some((definition) => definition.id === id)
    const definitions = exists
      ? settings.customSessionDefinitions.map((definition) => definition.id === id ? nextDefinition : definition)
      : [...settings.customSessionDefinitions, nextDefinition]
    onUpdate('customSessionDefinitions', definitions)
    if (!settings.defaultCustomSessionId && settings.customSessionDefinitions.length === 0) {
      onUpdate('defaultCustomSessionId', id)
    }
    setEditingId(null)
    setError('')
  }, [draft, editingId, onUpdate, settings.customSessionDefinitions, settings.defaultCustomSessionId])

  const deleteDefinition = useCallback((id: string) => {
    const definitions = settings.customSessionDefinitions.filter((definition) => definition.id !== id)
    onUpdate('customSessionDefinitions', definitions)
    if (settings.defaultCustomSessionId === id) onUpdate('defaultCustomSessionId', null)
    if (editingId === id) cancelEdit()
  }, [cancelEdit, editingId, onUpdate, settings.customSessionDefinitions, settings.defaultCustomSessionId])

  const parsedArgs = useMemo(() => parseCustomSessionArgs(draft.args), [draft.args])
  const visibleSessionTypeOptions = useMemo(() => filterSessionTypesForCurrentPlatform(SESSION_TYPE_OPTIONS), [])

  return (
    <div className={PAGE_STACK}>
      <PageIntro title="会话设置" description="管理默认新建会话，以及可自定义名称、图标、启动命令和启动参数的会话类型。" />

      <SettingsSection icon={Terminal} title="默认新建会话" description="标题栏新建、双击标签栏空白处都会使用这里的默认项。">
        <div className="flex flex-col gap-1.5">
          <span className="text-[var(--ui-font-xs)] text-[var(--color-text-tertiary)]">内置会话</span>
          <div className="flex flex-wrap gap-1">
            {visibleSessionTypeOptions.map((opt) => (
              <button
                key={opt.id}
                onClick={() => {
                  onUpdate('defaultSessionType', opt.id)
                  onUpdate('defaultCustomSessionId', null)
                }}
                className={cn(
                  'rounded-[var(--radius-md)] border px-3 py-1 text-[var(--ui-font-sm)] transition-colors',
                  settings.defaultCustomSessionId === null && settings.defaultSessionType === opt.id
                    ? 'border-[var(--color-accent)] bg-[var(--color-accent-muted)] text-[var(--color-text-primary)]'
                    : 'border-[var(--color-border)] text-[var(--color-text-secondary)] hover:border-[var(--color-border-hover)]',
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
        {settings.customSessionDefinitions.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <span className="text-[var(--ui-font-xs)] text-[var(--color-text-tertiary)]">自定义会话</span>
            <div className="flex flex-wrap gap-1">
              {settings.customSessionDefinitions.map((definition) => (
                <button
                  key={definition.id}
                  onClick={() => onUpdate('defaultCustomSessionId', definition.id)}
                  className={cn(
                    'flex items-center gap-2 rounded-[var(--radius-md)] border px-3 py-1 text-[var(--ui-font-sm)] transition-colors',
                    settings.defaultCustomSessionId === definition.id
                      ? 'border-[var(--color-accent)] bg-[var(--color-accent-muted)] text-[var(--color-text-primary)]'
                      : 'border-[var(--color-border)] text-[var(--color-text-secondary)] hover:border-[var(--color-border-hover)]',
                  )}
                >
                  <SessionIconView icon={definition.icon} className="h-4 w-4" imageClassName="h-4 w-4" />
                  {definition.name}
                </button>
              ))}
            </div>
          </div>
        )}
        <ToggleRow
          label="新建会话时询问名称"
          description={settings.promptSessionNameOnCreate
            ? '弹出输入框命名，或使用默认名称'
            : '直接使用自动生成的默认名称'}
          checked={settings.promptSessionNameOnCreate}
          onChange={(v) => onUpdate('promptSessionNameOnCreate', v)}
        />
      </SettingsSection>

      <SettingsSection icon={Plus} title="自定义会话" description="用于添加任意 CLI，例如自定义 Agent、脚本或项目命令。">
        <div className="flex flex-col gap-2">
          {settings.customSessionDefinitions.length === 0 && (
            <div className="rounded-[var(--radius-md)] border border-dashed border-[var(--color-border)] px-3 py-4 text-[var(--ui-font-sm)] text-[var(--color-text-tertiary)]">
              还没有自定义会话。添加后会出现在新建会话菜单里。
            </div>
          )}
          {settings.customSessionDefinitions.map((definition) => (
            <div key={definition.id} className="flex items-center gap-3 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg-secondary)]/35 px-3 py-2">
              <SessionIconView icon={definition.icon} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[var(--ui-font-sm)] font-semibold text-[var(--color-text-primary)]">{definition.name}</div>
                <div className="truncate font-mono text-[var(--ui-font-xs)] text-[var(--color-text-tertiary)]">
                  {definition.command}{definition.args ? ` ${definition.args}` : ''}
                </div>
              </div>
              <button
                onClick={() => startEdit(definition)}
                className="flex h-7 w-7 items-center justify-center rounded-[var(--radius-sm)] text-[var(--color-text-secondary)] hover:bg-white/[0.06] hover:text-white"
                title="编辑"
              >
                <Pencil size={13} />
              </button>
              <button
                onClick={() => deleteDefinition(definition.id)}
                className="flex h-7 w-7 items-center justify-center rounded-[var(--radius-sm)] text-[var(--color-error)] hover:bg-[var(--color-error)]/10"
                title="删除"
              >
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </div>

        {editing ? (
          <div className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-bg-secondary)]/35 p-3">
            <div className="mb-3 text-[var(--ui-font-sm)] font-semibold text-[var(--color-text-primary)]">
              {editingId ? '编辑自定义会话' : '新增自定义会话'}
            </div>
            <div className="grid grid-cols-[80px_1fr] gap-3">
              <label className="flex flex-col gap-1.5">
                <span className="text-[var(--ui-font-xs)] text-[var(--color-text-tertiary)]">图标</span>
                <input
                  value={draft.icon}
                  onChange={(event) => setDraft((current) => ({ ...current, icon: event.target.value }))}
                  placeholder="⚙"
                  className="h-8 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-bg-primary)] px-2 text-center text-[var(--ui-font-sm)] text-[var(--color-text-primary)] outline-none focus:border-[var(--color-accent)]"
                />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-[var(--ui-font-xs)] text-[var(--color-text-tertiary)]">名称</span>
                <input
                  value={draft.name}
                  onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
                  placeholder="My Agent"
                  className="h-8 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-bg-primary)] px-2.5 text-[var(--ui-font-sm)] text-[var(--color-text-primary)] outline-none focus:border-[var(--color-accent)]"
                />
              </label>
            </div>
            <div className="mt-3 grid gap-3">
              <label className="flex flex-col gap-1.5">
                <span className="text-[var(--ui-font-xs)] text-[var(--color-text-tertiary)]">启动命令</span>
                <input
                  value={draft.command}
                  onChange={(event) => setDraft((current) => ({ ...current, command: event.target.value }))}
                  placeholder="my-agent"
                  className="h-8 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-bg-primary)] px-2.5 font-mono text-[var(--ui-font-sm)] text-[var(--color-text-primary)] outline-none focus:border-[var(--color-accent)]"
                />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-[var(--ui-font-xs)] text-[var(--color-text-tertiary)]">启动参数</span>
                <input
                  value={draft.args}
                  onChange={(event) => setDraft((current) => ({ ...current, args: event.target.value }))}
                  placeholder="--model xxx --yolo"
                  className="h-8 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-bg-primary)] px-2.5 font-mono text-[var(--ui-font-sm)] text-[var(--color-text-primary)] outline-none focus:border-[var(--color-accent)]"
                />
                <span className="text-[var(--ui-font-2xs)] text-[var(--color-text-tertiary)]">
                  参数会按空格拆分，支持单引号和双引号。当前解析：{parsedArgs.length > 0 ? parsedArgs.map((arg) => `"${arg}"`).join(' ') : '无'}
                </span>
              </label>
            </div>
            {error && <div className="mt-2 text-[var(--ui-font-xs)] text-[var(--color-error)]">{error}</div>}
            <div className="mt-4 flex gap-2">
              <button
                onClick={saveDefinition}
                className="rounded-[var(--radius-md)] border border-[var(--color-accent)] bg-[var(--color-accent-muted)] px-4 py-1.5 text-[var(--ui-font-sm)] text-[var(--color-accent)] hover:bg-[var(--color-accent)]/15"
              >
                保存
              </button>
              <button
                onClick={cancelEdit}
                className="rounded-[var(--radius-md)] border border-[var(--color-border)] px-4 py-1.5 text-[var(--ui-font-sm)] text-[var(--color-text-secondary)] hover:border-[var(--color-border-hover)] hover:text-white"
              >
                取消
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={startCreate}
            className="flex items-center gap-2 self-start rounded-[var(--radius-md)] border border-[var(--color-accent)]/35 px-4 py-2 text-[var(--ui-font-sm)] text-[var(--color-accent)] hover:bg-[var(--color-accent)]/10"
          >
            <Plus size={13} />
            添加自定义会话
          </button>
        )}
      </SettingsSection>
    </div>
  )
}

function WslPage({ settings, onUpdate }: { settings: AppSettings; onUpdate: (k: keyof AppSettings, v: unknown) => void }): JSX.Element {
  const inputClass = cn(
    'h-8 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-bg-primary)] px-2.5',
    'font-mono text-[var(--ui-font-sm)] text-[var(--color-text-primary)] outline-none transition-colors',
    'placeholder:text-[var(--color-text-tertiary)] focus:border-[var(--color-accent)]',
  )
  const textareaClass = cn(
    'min-h-[88px] rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-bg-primary)] px-2.5 py-2',
    'font-mono text-[var(--ui-font-sm)] leading-relaxed text-[var(--color-text-primary)] outline-none transition-colors',
    'placeholder:text-[var(--color-text-tertiary)] focus:border-[var(--color-accent)]',
  )

  return (
    <div className={PAGE_STACK}>
      <PageIntro title="WSL 设置" description="配置 Claude Code(WSL) / Codex(WSL) 会话启动前的 shell、PATH 和环境变量。" />

      <SettingsSection icon={Terminal} title="启动环境" description="WSL 会话会先进入项目目录，再通过这里配置的 shell 执行初始化脚本和 Agent 命令。">
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1.5">
            <span className="text-[var(--ui-font-xs)] text-[var(--color-text-tertiary)]">发行版名称</span>
            <input
              value={settings.wslDistroName}
              onChange={(event) => onUpdate('wslDistroName', event.target.value)}
              placeholder="留空使用默认，例如 Ubuntu"
              className={inputClass}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-[var(--ui-font-xs)] text-[var(--color-text-tertiary)]">Shell</span>
            <input
              value={settings.wslShell}
              onChange={(event) => onUpdate('wslShell', event.target.value)}
              placeholder="bash"
              className={inputClass}
            />
          </label>
        </div>

        <ToggleRow
          label="使用登录 shell"
          description="开启后使用 -lc；如果你的 PATH 在 ~/.profile 或 ~/.bash_profile 中配置，可以打开。"
          checked={settings.wslUseLoginShell}
          onChange={(v) => onUpdate('wslUseLoginShell', v)}
        />

        <label className="flex flex-col gap-1.5">
          <span className="text-[var(--ui-font-xs)] text-[var(--color-text-tertiary)]">PATH 前缀</span>
          <input
            value={settings.wslPathPrefix}
            onChange={(event) => onUpdate('wslPathPrefix', event.target.value)}
            placeholder="/home/mf/.nvm/versions/node/v24.15.0/bin"
            className={inputClass}
          />
          <span className="text-[var(--ui-font-2xs)] text-[var(--color-text-tertiary)]">
            会追加到 PATH 最前面，优先使用 WSL 内的 node/codex/claude，避免命中 Windows npm shim。
          </span>
        </label>
      </SettingsSection>

      <SettingsSection icon={FileCode2} title="初始化脚本" description="每次启动 WSL Agent 前都会先执行。默认会加载 nvm。">
        <textarea
          value={settings.wslInitScript}
          onChange={(event) => onUpdate('wslInitScript', event.target.value)}
          spellCheck={false}
          className={textareaClass}
        />
      </SettingsSection>

      <SettingsSection icon={FileCode2} title="额外环境变量" description="每行一个 KEY=value，会在 WSL shell 内 export。">
        <textarea
          value={settings.wslEnvVars}
          onChange={(event) => onUpdate('wslEnvVars', event.target.value)}
          placeholder={'OPENAI_API_KEY=...\nANTHROPIC_API_KEY=...'}
          spellCheck={false}
          className={textareaClass}
        />
      </SettingsSection>
    </div>
  )
}

function WorkspacePage({ settings, onUpdate }: { settings: AppSettings; onUpdate: (k: keyof AppSettings, v: unknown) => void }): JSX.Element {
  const applyClassicCompactPreset = useCallback(() => {
    onUpdate('workspaceLayout', 'panes')
    onUpdate('paneUiMode', 'classic')
    onUpdate('tabUiMode', 'square')
    onUpdate('paneDensityMode', 'compact')
  }, [onUpdate])

  return (
    <div className={PAGE_STACK}>
      <PageIntro title="工作区设置" description="集中管理经典分屏、标签页样式、画布行为和弹出窗口。 " />
      <SettingsSection icon={SplitSquareHorizontal} title="布局模式" description="选择会话和终端的排布方式，快捷键 Ctrl+Shift+M 可随时切换。">
        <SegmentedChoice
          value={settings.workspaceLayout}
          options={[
            { id: 'panes', label: '分屏模式', desc: '经典标签 + 分屏（默认）' },
            { id: 'canvas', label: '无限画布', desc: '卡片自由缩放与摆放' },
          ]}
          onChange={(v) => onUpdate('workspaceLayout', v)}
        />
        <SegmentedChoice
          value={settings.paneUiMode}
          options={[
            { id: 'separated', label: '分离式', desc: '每个 pane 保持独立圆角外观' },
            { id: 'classic', label: '经典分隔线', desc: 'pane 之间只保留一条分隔线' },
          ]}
          onChange={(v) => onUpdate('paneUiMode', v)}
        />
        <SegmentedChoice
          value={settings.tabUiMode}
          options={[
            { id: 'rounded', label: '圆角标签页', desc: '保留当前 Chrome 风格圆角选中态' },
            { id: 'square', label: '直角标签页', desc: '选中标签页使用直角边缘' },
          ]}
          onChange={(v) => onUpdate('tabUiMode', v)}
        />
        <SegmentedChoice
          value={settings.paneDensityMode}
          options={[
            { id: 'comfortable', label: '标准密度', desc: '保留当前标签高度和间距' },
            { id: 'compact', label: '紧凑密度', desc: '降低标签栏高度和横向留白' },
          ]}
          onChange={(v) => onUpdate('paneDensityMode', v)}
        />
        <button
          type="button"
          onClick={applyClassicCompactPreset}
          className={cn(
            'flex w-full items-center justify-between rounded-[var(--radius-md)] border px-3 py-2.5 text-left transition-all duration-200',
            'border-[var(--color-border)] bg-[var(--color-bg-secondary)]/40 text-[var(--color-text-secondary)]',
            'hover:border-[var(--color-accent)]/45 hover:bg-[var(--color-accent)]/10 hover:text-[var(--color-text-primary)]',
          )}
        >
          <span className="flex flex-col gap-0.5">
            <span className="text-[12px] font-bold text-[var(--color-text-primary)]">应用经典紧凑预设</span>
            <span className="text-[10px] text-[var(--color-text-tertiary)]">切到分屏模式、经典分隔线、直角标签页和紧凑密度。</span>
          </span>
          <span className="text-[10px] font-bold text-[var(--color-accent)]">APPLY</span>
        </button>
        <ToggleRow
          label="活动分屏高亮"
          description={settings.showActivePaneBorder ? '当前分屏显示高亮边框' : '不显示高亮边框'}
          checked={settings.showActivePaneBorder}
          onChange={(v) => onUpdate('showActivePaneBorder', v)}
        />
      </SettingsSection>

      <SettingsSection icon={SplitSquareHorizontal} title="画布" description="无限画布的默认尺寸、聚焦缩放和网格行为。">
        <div className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-bg-secondary)]/35 p-3">
          <div className="mb-2 flex flex-col gap-0.5">
            <span className="text-[var(--ui-font-sm)] text-[var(--color-text-secondary)]">新建会话卡片默认尺寸</span>
            <span className="text-[var(--ui-font-2xs)] text-[var(--color-text-tertiary)]">
              只影响之后新建的终端、Claude Code、Codex 等会话卡片，已有卡片不自动改尺寸。
            </span>
          </div>
          <div className="flex gap-2">
            <PixelNumberField label="宽度" value={settings.canvasSessionCardWidth} min={CANVAS_SESSION_CARD_WIDTH_MIN} max={CANVAS_SESSION_CARD_WIDTH_MAX} onChange={(v) => onUpdate('canvasSessionCardWidth', v)} />
            <PixelNumberField label="高度" value={settings.canvasSessionCardHeight} min={CANVAS_SESSION_CARD_HEIGHT_MIN} max={CANVAS_SESSION_CARD_HEIGHT_MAX} onChange={(v) => onUpdate('canvasSessionCardHeight', v)} />
          </div>
        </div>
        <div className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-bg-secondary)]/35 p-3">
          <div className="mb-2 flex flex-col gap-0.5">
            <span className="text-[var(--ui-font-sm)] text-[var(--color-text-secondary)]">点击聚焦缩放字体</span>
            <span className="text-[var(--ui-font-2xs)] text-[var(--color-text-tertiary)]">
              字体显示大小在范围内时只居中；小于或大于范围时缩放到目标字体大小。
            </span>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <PixelNumberField label="最小" value={settings.canvasFocusReadableFontMinPx} min={CANVAS_FOCUS_FONT_PX_MIN} max={CANVAS_FOCUS_FONT_PX_MAX} step={1} onChange={(v) => onUpdate('canvasFocusReadableFontMinPx', v)} />
            <PixelNumberField label="最大" value={settings.canvasFocusReadableFontMaxPx} min={CANVAS_FOCUS_FONT_PX_MIN} max={CANVAS_FOCUS_FONT_PX_MAX} step={1} onChange={(v) => onUpdate('canvasFocusReadableFontMaxPx', v)} />
            <PixelNumberField label="目标" value={settings.canvasFocusTargetFontPx} min={CANVAS_FOCUS_FONT_PX_MIN} max={CANVAS_FOCUS_FONT_PX_MAX} step={1} onChange={(v) => onUpdate('canvasFocusTargetFontPx', v)} />
          </div>
        </div>
        <ToggleRow label="显示网格" description="在画布上渲染点状背景网格，辅助对齐" checked={settings.canvasGridEnabled} onChange={(v) => onUpdate('canvasGridEnabled', v)} />
        <ToggleRow label="吸附到网格" description="拖动和缩放卡片时自动吸附到网格与相邻卡片边缘" checked={settings.canvasSnapEnabled} onChange={(v) => onUpdate('canvasSnapEnabled', v)} />
        <SegmentedChoice
          value={settings.canvasOverlapMode}
          options={[
            { id: 'free', label: '允许重叠', desc: '卡片可自由覆盖，保持当前行为' },
            { id: 'avoid', label: '避免重叠', desc: '拖动时自动推开相邻卡片' },
          ]}
          onChange={(v) => onUpdate('canvasOverlapMode', v)}
        />
        <ToggleRow label="显示缩略图" description="右下角小地图显示画布全貌和当前视口" checked={settings.canvasShowMinimap} onChange={(v) => onUpdate('canvasShowMinimap', v)} />
      </SettingsSection>

      <SettingsSection icon={ExternalLink} title="弹出窗口" description="标签页拖出为独立窗口时使用的默认尺寸和位置。">
        <div className="flex flex-col gap-1.5">
          <span className="text-[var(--ui-font-xs)] text-[var(--color-text-tertiary)]">弹出窗口默认尺寸</span>
          <div className="flex gap-3">
            <FontSizeSlider label="宽度" value={settings.popoutWidth} min={400} max={1920} onChange={(v) => onUpdate('popoutWidth', v)} />
            <FontSizeSlider label="高度" value={settings.popoutHeight} min={300} max={1080} onChange={(v) => onUpdate('popoutHeight', v)} />
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="text-[var(--ui-font-xs)] text-[var(--color-text-tertiary)]">弹出位置</span>
          <SegmentedChoice
            value={settings.popoutPosition}
            options={[
              { id: 'cursor', label: '跟随鼠标', desc: '在鼠标位置附近打开' },
              { id: 'center', label: '屏幕居中', desc: '总是在屏幕中央打开' },
            ]}
            onChange={(v) => onUpdate('popoutPosition', v)}
          />
        </div>
      </SettingsSection>
    </div>
  )
}

function NotificationsPage({ settings, onUpdate }: { settings: AppSettings; onUpdate: (k: keyof AppSettings, v: unknown) => void }): JSX.Element {
  return (
    <div className={PAGE_STACK}>
      <PageIntro title="通知设置" description="控制 Agent 完成任务时是否弹出提醒和播放声音。" />
      <SettingsSection icon={Bell} title="完成提醒" description="会话任务完成时的桌面通知与音效。">
        <ToggleRow label="弹出通知" description="在右下角弹出 toast 和系统桌面通知（仅当未在查看该会话时）" checked={settings.notificationToastEnabled} onChange={(v) => onUpdate('notificationToastEnabled', v)} />
        <ToggleRow label="完成音效" description="播放像素风提示音（正在查看时也会响）" checked={settings.notificationSoundEnabled} onChange={(v) => onUpdate('notificationSoundEnabled', v)} />
        {settings.notificationSoundEnabled && (
          <PercentSlider
            label="音量"
            value={settings.notificationSoundVolume}
            onChange={(v) => onUpdate('notificationSoundVolume', v)}
            trailing={(
              <button
                onClick={() => playTaskCompleteSound(settings.notificationSoundVolume)}
                className={cn(
                  'flex items-center gap-1 rounded-[var(--radius-sm)] border border-[var(--color-border)] px-2 py-0.5',
                  'text-[var(--ui-font-2xs)] text-[var(--color-text-secondary)]',
                  'hover:border-[var(--color-accent)] hover:text-[var(--color-accent)] transition-colors',
                )}
                title="试听"
              >
                <Play size={10} />
                试听
              </button>
            )}
          />
        )}
      </SettingsSection>
    </div>
  )
}

function TitleBarPage({ settings, onUpdate }: { settings: AppSettings; onUpdate: (k: keyof AppSettings, v: unknown) => void }): JSX.Element {
  return (
    <div className={PAGE_STACK}>
      <PageIntro title="标题栏设置" description="控制顶部区域的搜索、菜单显示方式和音乐播放器。" />
      <SettingsSection icon={Search} title="标题栏" description="顶部区域的搜索与菜单显示策略。">
        <ToggleRow label="标题栏搜索" description={settings.showTitleBarSearch ? '可直接从顶部搜索文件与会话' : '中间显示音乐播放器或当前项目名'} checked={settings.showTitleBarSearch} onChange={(v) => onUpdate('showTitleBarSearch', v)} />
        {settings.showTitleBarSearch && (
          <SegmentedChoice
            value={settings.titleBarSearchScope}
            options={[
              { id: 'project', label: '当前项目', desc: '只搜索当前项目 / worktree' },
              { id: 'all-projects', label: '全部项目', desc: '跨所有项目搜索' },
            ]}
            onChange={(v) => onUpdate('titleBarSearchScope', v)}
          />
        )}
        <div className="flex flex-col gap-1.5">
          <span className="text-[var(--ui-font-xs)] text-[var(--color-text-tertiary)]">菜单显示方式</span>
          <SegmentedChoice
            value={settings.titleBarMenuVisibility}
            options={[
              { id: 'always', label: '始终显示', desc: '菜单一直可见' },
              { id: 'hover', label: '悬停显示', desc: '鼠标移到标题时显示' },
            ]}
            onChange={(v) => onUpdate('titleBarMenuVisibility', v)}
          />
        </div>
      </SettingsSection>
      <SettingsSection icon={AudioLines} title="音乐播放器" description="标题栏内嵌播放器与可视化。">
        <ToggleRow
          label="在标题栏显示"
          description={settings.showTitleBarSearch ? '标题栏搜索启用时会自动隐藏' : settings.showMusicPlayer ? '显示播放器与可视化效果' : '显示当前项目名称'}
          checked={settings.showMusicPlayer}
          onChange={(v) => onUpdate('showMusicPlayer', v)}
        />
        {settings.showMusicPlayer && (
          <>
            <div className="flex flex-col gap-1.5">
              <span className="text-[var(--ui-font-xs)] text-[var(--color-text-tertiary)]">可视化风格</span>
              <SegmentedChoice
                value={settings.visualizerMode}
                options={[
                  { id: 'melody', label: '旋律流线', desc: '柔和曲线与粒子', icon: AudioLines },
                  { id: 'bars', label: '频谱柱状', desc: '经典频谱柱状图', icon: BarChart3 },
                ]}
                onChange={(v) => onUpdate('visualizerMode', v)}
              />
            </div>
            <FontSizeSlider label="可视化宽度" value={settings.visualizerWidth} min={80} max={Math.max(400, window.innerWidth)} onChange={(v) => onUpdate('visualizerWidth', v)} />
            <ToggleRow label="播放控制按钮" description="上一首 / 播放暂停 / 下一首" checked={settings.showPlayerControls} onChange={(v) => onUpdate('showPlayerControls', v)} />
            <ToggleRow label="歌曲信息" description="显示歌曲名、歌手与封面" checked={settings.showTrackInfo} onChange={(v) => onUpdate('showTrackInfo', v)} />
          </>
        )}
      </SettingsSection>
    </div>
  )
}

function GitPage({ settings, onUpdate }: { settings: AppSettings; onUpdate: (k: keyof AppSettings, v: unknown) => void }): JSX.Element {
  return (
    <div className={PAGE_STACK}>
      <PageIntro title="Git 设置" description="调整 Git 侧栏的显示方式和 AI 修复入口。" />
      <SettingsSection icon={GitBranch} title="Git 面板" description="Git 侧栏的改动文件视图与 AI 修复流程。">
        <div className="flex flex-col gap-1.5">
          <span className="text-[var(--ui-font-xs)] text-[var(--color-text-tertiary)]">改动文件展示方式</span>
          <SegmentedChoice
            value={settings.gitChangesViewMode}
            options={[
              { id: 'flat', label: '平铺列表', desc: '简洁的文件列表' },
              { id: 'tree', label: '目录树', desc: '按文件夹层级组织' },
            ]}
            onChange={(v) => onUpdate('gitChangesViewMode', v)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="text-[var(--ui-font-xs)] text-[var(--color-text-tertiary)]">审查报告的 AI 修复方式</span>
          <SegmentedChoice
            value={settings.gitReviewFixMode}
            options={[
              { id: 'claude-gui', label: 'Claude GUI', desc: '在 Claude GUI 标签页展示完整过程' },
              { id: 'claude-code-cli', label: 'Claude Code CLI', desc: '打开 CLI 标签并发送任务' },
            ]}
            onChange={(v) => onUpdate('gitReviewFixMode', v)}
          />
        </div>
      </SettingsSection>
    </div>
  )
}

function ThemeSwatches({ themeName }: { themeName: string }): JSX.Element {
  const t = getXtermTheme(themeName)
  if (!t) return <div className="h-4 w-16 rounded bg-[var(--color-bg-surface)]" />
  const swatches = [t.background, t.red, t.green, t.yellow, t.blue, t.magenta, t.cyan, t.foreground]
  return (
    <div className="flex gap-0.5 items-center">
      {swatches.map((color, i) => (
        <span key={i} className="inline-block h-3 w-3 rounded-[2px] shrink-0" style={{ backgroundColor: color }} />
      ))}
    </div>
  )
}

type AppearanceView = 'list' | 'editor-new' | 'editor-edit' | 'import'

function AppearancePage({ settings, onUpdate }: { settings: AppSettings; onUpdate: (k: keyof AppSettings, v: unknown) => void }): JSX.Element {
  const [view, setView] = useState<AppearanceView>('list')
  const [editingThemeName, setEditingThemeName] = useState<string | undefined>()
  const [editingBaseTheme, setEditingBaseTheme] = useState<{ theme: GhosttyTheme; suggested: string } | undefined>()
  const [importText, setImportText] = useState('')
  const [importName, setImportName] = useState('')
  const [importError, setImportError] = useState('')

  const allThemeNames = useMemo(() => getThemeNames(), [settings.customThemes])
  const customThemeNames = useMemo(() => getAllCustomThemeNames(), [settings.customThemes])
  const builtinThemeNames = useMemo(() => allThemeNames.filter((n) => !customThemeNames.includes(n)), [allThemeNames, customThemeNames])
  const displayThemeName = useCallback((name: string): string => (
    name === 'FastAgents Default' ? 'FastAgents 默认' : name
  ), [])

  function saveCustomTheme(name: string, theme: GhosttyTheme): void {
    const next = { ...settings.customThemes, [name]: theme }
    onUpdate('customThemes', next)
    onUpdate('terminalTheme', name)
    setView('list')
    setEditingThemeName(undefined)
  }

  function deleteCustomTheme(name: string): void {
    const next = { ...settings.customThemes }
    delete next[name]
    onUpdate('customThemes', next)
    if (settings.terminalTheme === name) onUpdate('terminalTheme', 'FastAgents Default')
  }

  function handleImport(): void {
    setImportError('')
    const name = importName.trim()
    if (!name) { setImportError('请输入主题名称'); return }
    if (allThemeNames.includes(name)) { setImportError('该名称已存在，请换一个'); return }
    const result = parseThemeAuto(importText, name)
    if (!result.ok) { setImportError(result.error); return }
    saveCustomTheme(name, result.theme)
    setImportText('')
    setImportName('')
  }

  async function handleImportFile(): Promise<void> {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json,.jsonc,.conf,.theme'
    input.onchange = async () => {
      const file = input.files?.[0]
      if (!file) return
      const text = await file.text()
      const guessedName = file.name.replace(/\.(json|jsonc|conf|theme)$/i, '').trim()
      setImportName(guessedName)
      setImportText(text)
      setView('import')
    }
    input.click()
  }

  // ── Editor / Import views ─────────────────────────────────────────────────
  if (view === 'editor-new' || view === 'editor-edit') {
    const isEditExisting = view === 'editor-edit' && editingThemeName !== undefined
    const editingTheme = isEditExisting
      ? settings.customThemes[editingThemeName!]
      : editingBaseTheme?.theme
    const title = isEditExisting
      ? `编辑「${editingThemeName}」`
      : editingBaseTheme
        ? `基于「${editingBaseTheme.suggested}」创建`
        : '新建自定义主题'

    function resetEditor(): void {
      setView('list')
      setEditingThemeName(undefined)
      setEditingBaseTheme(undefined)
    }

    return (
      <div className={PAGE_STACK}>
        <PageIntro title="外观设置" description="创建、导入和切换主题，并统一调整应用界面的主字体风格。" />
        <button
          onClick={resetEditor}
          className="flex items-center gap-1.5 self-start text-[var(--ui-font-xs)] text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]"
        >
          ← 返回主题列表
        </button>
        <div className="text-[var(--ui-font-sm)] font-semibold text-[var(--color-text-primary)]">{title}</div>
        <CustomThemeEditor
          initialTheme={editingTheme}
          initialName={isEditExisting ? editingThemeName : undefined}
          suggestedName={editingBaseTheme?.suggested}
          existingNames={allThemeNames}
          onSave={saveCustomTheme}
          onCancel={resetEditor}
        />
      </div>
    )
  }

  if (view === 'import') {
    return (
      <div className={PAGE_STACK}>
        <PageIntro title="导入主题" description="支持粘贴或直接导入 VSCode / Ghostty 主题内容，快速生成可编辑的自定义主题。" />
        <button
          onClick={() => { setView('list'); setImportText(''); setImportName(''); setImportError('') }}
          className="flex items-center gap-1.5 self-start text-[var(--ui-font-xs)] text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]"
        >
          ← 返回主题列表
        </button>
        <div className="text-[var(--ui-font-sm)] font-semibold text-[var(--color-text-primary)]">导入主题</div>
        <p className="text-[var(--ui-font-xs)] text-[var(--color-text-tertiary)]">
          支持 VSCode 主题 JSON（.json）和 Ghostty 主题文件（.conf / .theme）。粘贴内容或通过文件选择器导入。
        </p>
        <input
          type="text"
          value={importName}
          onChange={(e) => { setImportName(e.target.value); setImportError('') }}
          placeholder="主题名称"
          className={cn(
            'rounded-[var(--radius-md)] border bg-[var(--color-bg-secondary)]',
            'px-3 py-1.5 text-[var(--ui-font-sm)] text-[var(--color-text-primary)] outline-none',
            importError && !importText ? 'border-[var(--color-error)]' : 'border-[var(--color-border)] focus:border-[var(--color-accent)]',
          )}
        />
        <textarea
          value={importText}
          onChange={(e) => { setImportText(e.target.value); setImportError('') }}
          placeholder={'粘贴 VSCode 主题 JSON 或 Ghostty 主题文件内容…'}
          rows={10}
          className={cn(
            'rounded-[var(--radius-md)] border bg-[var(--color-bg-secondary)] font-mono resize-none',
            'px-3 py-2 text-[var(--ui-font-xs)] text-[var(--color-text-primary)] outline-none',
            importError && importText ? 'border-[var(--color-error)]' : 'border-[var(--color-border)] focus:border-[var(--color-accent)]',
          )}
        />
        {importError && (
          <span className="text-[var(--ui-font-2xs)] text-[var(--color-error)]">{importError}</span>
        )}
        <div className="flex gap-2">
          <button
            onClick={handleImport}
            className="flex-1 rounded-[var(--radius-md)] bg-[var(--color-accent)] px-4 py-2 text-[var(--ui-font-sm)] font-medium text-white hover:opacity-90 transition-opacity"
          >
            导入
          </button>
          <button
            onClick={() => void handleImportFile()}
            className="rounded-[var(--radius-md)] border border-[var(--color-border)] px-4 py-2 text-[var(--ui-font-sm)] text-[var(--color-text-secondary)] hover:border-[var(--color-border-hover)] transition-colors"
          >
            选择文件…
          </button>
        </div>
      </div>
    )
  }

  // ── Main list view ────────────────────────────────────────────────────────
  return (
    <div className={PAGE_STACK}>
      <PageIntro title="外观设置" description="主题决定整体视觉气质，字体决定日常阅读手感。这里可以一起调顺。"/>
      {/* Theme header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Palette size={14} className="text-[var(--color-accent)]" />
          <span className="text-[var(--ui-font-sm)] font-semibold uppercase tracking-wider text-[var(--color-text-tertiary)]">
            颜色主题
          </span>
        </div>
        <div className="flex gap-1.5">
          <button
            onClick={() => void handleImportFile()}
            className="rounded-[var(--radius-sm)] border border-[var(--color-border)] px-2.5 py-1 text-[var(--ui-font-2xs)] text-[var(--color-text-secondary)] hover:border-[var(--color-border-hover)] transition-colors"
          >
            导入…
          </button>
          <button
            onClick={() => setView('editor-new')}
            className="rounded-[var(--radius-sm)] bg-[var(--color-accent-muted)] border border-[var(--color-accent)]/30 px-2.5 py-1 text-[var(--ui-font-2xs)] text-[var(--color-accent)] hover:opacity-80 transition-opacity"
          >
            + 新建
          </button>
        </div>
      </div>

      {/* 当前主题 */}
      <div className="flex items-center gap-3 rounded-[var(--radius-md)] border border-[var(--color-accent)] bg-[var(--color-accent-muted)] px-3 py-2">
        <ThemeSwatches themeName={settings.terminalTheme} />
        <span className="text-[var(--ui-font-sm)] text-[var(--color-text-primary)] font-medium flex-1 truncate">{displayThemeName(settings.terminalTheme)}</span>
        <button
          onClick={() => {
            const n = settings.terminalTheme
            if (customThemeNames.includes(n)) {
              setEditingThemeName(n)
              setEditingBaseTheme(undefined)
              setView('editor-edit')
            } else {
              const raw = getTheme(n)
              if (!raw) return
              setEditingBaseTheme({ theme: raw, suggested: n })
              setEditingThemeName(undefined)
              setView('editor-new')
            }
          }}
          className="text-[var(--ui-font-2xs)] text-[var(--color-accent)] hover:opacity-70 shrink-0"
        >
          编辑
        </button>
      </div>

      {/* 自定义主题区 */}
      {customThemeNames.length > 0 && (
        <>
          <div className="text-[var(--ui-font-2xs)] font-semibold uppercase tracking-wider text-[var(--color-text-tertiary)]">
            自定义主题
          </div>
          <div className="flex flex-col gap-0.5 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-1">
            {customThemeNames.map((name) => (
              <div key={name} className="flex items-center gap-2">
                <button
                  onClick={() => onUpdate('terminalTheme', name)}
                  className={cn(
                    'flex flex-1 items-center gap-3 rounded-[var(--radius-sm)] px-2.5 py-1.5 text-left transition-colors',
                    settings.terminalTheme === name
                      ? 'bg-[var(--color-accent-muted)] text-[var(--color-text-primary)]'
                      : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-tertiary)] hover:text-[var(--color-text-primary)]',
                  )}
                >
                  <ThemeSwatches themeName={name} />
                  <span className="text-[var(--ui-font-xs)] truncate">{displayThemeName(name)}</span>
                </button>
                <button
                  onClick={() => { setEditingThemeName(name); setView('editor-edit') }}
                  className="shrink-0 px-1.5 py-1 text-[var(--ui-font-2xs)] text-[var(--color-text-tertiary)] hover:text-[var(--color-accent)]"
                >
                  编辑
                </button>
                <button
                  onClick={() => deleteCustomTheme(name)}
                  className="shrink-0 px-1.5 py-1 text-[var(--ui-font-2xs)] text-[var(--color-text-tertiary)] hover:text-[var(--color-error)]"
                >
                  删除
                </button>
              </div>
            ))}
          </div>
        </>
      )}

      {/* 内置主题 */}
      <div className="text-[var(--ui-font-2xs)] font-semibold uppercase tracking-wider text-[var(--color-text-tertiary)]">
        内置主题
      </div>
      <div className="flex flex-col gap-0.5 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-1">
        {builtinThemeNames.map((name) => (
          <div key={name} className="flex items-center gap-2">
            <button
              onClick={() => onUpdate('terminalTheme', name)}
              className={cn(
                'flex flex-1 items-center gap-3 rounded-[var(--radius-sm)] px-2.5 py-1.5 text-left transition-colors',
                settings.terminalTheme === name
                  ? 'bg-[var(--color-accent-muted)] text-[var(--color-text-primary)]'
                  : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-tertiary)] hover:text-[var(--color-text-primary)]',
              )}
            >
              <ThemeSwatches themeName={name} />
              <span className="text-[var(--ui-font-xs)] truncate">{displayThemeName(name)}</span>
            </button>
            <button
              onClick={() => {
                const raw = getTheme(name)
                if (!raw) return
                setEditingBaseTheme({ theme: raw, suggested: name })
                setEditingThemeName(undefined)
                setView('editor-new')
              }}
              className="shrink-0 px-1.5 py-1 text-[var(--ui-font-2xs)] text-[var(--color-text-tertiary)] hover:text-[var(--color-accent)]"
            >
              基于此新建
            </button>
          </div>
        ))}
      </div>

      {/* Interface */}
      <div className="h-px bg-[var(--color-border)]" />
      <div className="flex items-center gap-2 mb-1">
        <Type size={14} className="text-[var(--color-accent)]" />
        <span className="text-[var(--ui-font-sm)] font-semibold uppercase tracking-wider text-[var(--color-text-tertiary)]">
          界面字体
        </span>
      </div>
      <FontSizeSlider label="字号" value={settings.uiFontSize} min={11} max={18} onChange={(v) => onUpdate('uiFontSize', v)} />
      <FontSelect label="字体" value={settings.uiFontFamily} options={UI_FONT_OPTIONS} labels={UI_FONT_LABELS} onChange={(v) => onUpdate('uiFontFamily', v)} />
      <div
        className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg-primary)] px-3 py-2"
        style={{ fontSize: settings.uiFontSize, fontFamily: settings.uiFontFamily }}
      >
        <span className="text-[var(--color-text-secondary)]">预览：界面层级、按钮标题和说明文字都会使用这里的设置。</span>
      </div>
    </div>
  )
}

function TerminalPage({ settings, onUpdate }: { settings: AppSettings; onUpdate: (k: keyof AppSettings, v: unknown) => void }): JSX.Element {
  return (
    <div className={PAGE_STACK}>
      <PageIntro title="终端设置" description="统一终端的字号与字体，确保长时间阅读输出时依然紧凑、清晰。" />
      <div className="flex items-center gap-2 mb-1">
        <Terminal size={14} className="text-[var(--color-success)]" />
        <span className="text-[var(--ui-font-sm)] font-semibold uppercase tracking-wider text-[var(--color-text-tertiary)]">
          终端排版
        </span>
      </div>
      <FontSizeSlider label="字号" value={settings.terminalFontSize} min={10} max={24} onChange={(v) => onUpdate('terminalFontSize', v)} />
      <FontSelect label="字体" value={settings.terminalFontFamily} options={TERMINAL_FONT_OPTIONS} labels={TERMINAL_FONT_LABELS} onChange={(v) => onUpdate('terminalFontFamily', v)} />
      <div
        className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[#1a1a1e] px-3 py-2"
        style={{ fontSize: settings.terminalFontSize, fontFamily: settings.terminalFontFamily }}
      >
        <span style={{ color: '#3ecf7b' }}>$</span>
        <span style={{ color: '#e8e8ec' }}> git status</span>
        <br />
        <span style={{ color: '#8e8e96' }}>当前分支为 main，输出内容在这里预览</span>
      </div>
    </div>
  )
}

function EditorPage({ settings, onUpdate }: { settings: AppSettings; onUpdate: (k: keyof AppSettings, v: unknown) => void }): JSX.Element {
  return (
    <div className={PAGE_STACK}>
      <PageIntro title="编辑器设置" description="控制代码阅读与编辑体验，包括字体、辅助信息、换行和预览效果。" />
      <div className="flex items-center gap-2 mb-1">
        <FileCode2 size={14} className="text-[var(--color-accent)]" />
        <span className="text-[var(--ui-font-sm)] font-semibold uppercase tracking-wider text-[var(--color-text-tertiary)]">
          编辑器排版
        </span>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <FontSizeSlider label="字号" value={settings.editorFontSize} min={11} max={28} onChange={(v) => onUpdate('editorFontSize', v)} />
        <FontSelect
          label="字体"
          value={settings.editorFontFamily}
          options={EDITOR_FONT_OPTIONS}
          labels={EDITOR_FONT_LABELS}
          onChange={(v) => onUpdate('editorFontFamily', v)}
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <ToggleRow
          label="自动换行"
          description="超长代码行自动换行，不再横向滚动"
          checked={settings.editorWordWrap}
          onChange={(v) => onUpdate('editorWordWrap', v)}
        />
        <ToggleRow
          label="缩略图"
          description="在右侧显示代码概览缩略图"
          checked={settings.editorMinimap}
          onChange={(v) => onUpdate('editorMinimap', v)}
        />
        <ToggleRow
          label="行号"
          description="在左侧边栏显示行号"
          checked={settings.editorLineNumbers}
          onChange={(v) => onUpdate('editorLineNumbers', v)}
        />
        <ToggleRow
          label="粘性滚动"
          description="滚动时固定当前作用域标题"
          checked={settings.editorStickyScroll}
          onChange={(v) => onUpdate('editorStickyScroll', v)}
        />
        <ToggleRow
          label="连字"
          description="渲染 =>、=== 之类的组合字形"
          checked={settings.editorFontLigatures}
          onChange={(v) => onUpdate('editorFontLigatures', v)}
        />
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-[var(--ui-font-sm)] text-[var(--color-text-secondary)]">预览</span>
        <div className="overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[#1a1a1e]">
          {settings.editorStickyScroll && (
            <div
              className="border-b border-white/5 bg-[#202026] px-4 py-2 text-[11px] text-[#8e8e96]"
              style={{ fontFamily: settings.editorFontFamily }}
            >
              function updateSessionState(session, patch)
            </div>
          )}
          <div className="flex min-h-[220px]">
            {settings.editorLineNumbers && (
              <div
                className="select-none border-r border-white/5 px-3 py-3 text-right text-[#5e5e66]"
                style={{ fontFamily: settings.editorFontFamily, fontSize: settings.editorFontSize }}
              >
                <div>1</div>
                <div>2</div>
                <div>3</div>
                <div>4</div>
                <div>5</div>
                <div>6</div>
              </div>
            )}
            <pre
              className="flex-1 overflow-hidden px-4 py-3 leading-7 text-[#e8e8ec]"
              style={{
                fontFamily: settings.editorFontFamily,
                fontSize: settings.editorFontSize,
                whiteSpace: settings.editorWordWrap ? 'pre-wrap' : 'pre',
                wordBreak: settings.editorWordWrap ? 'break-word' : 'normal',
                fontVariantLigatures: settings.editorFontLigatures ? 'normal' : 'none',
              }}
            >
              <span style={{ color: '#c084fc' }}>function</span>{' '}
              <span style={{ color: '#5fa0f5' }}>updateSessionState</span>
              <span>(</span>
              <span style={{ color: '#45c8c8' }}>session</span>
              <span>, </span>
              <span style={{ color: '#45c8c8' }}>patch</span>
              <span>) {'{'}</span>
              {'\n'}  <span style={{ color: '#c084fc' }}>return</span> {'{'} ...session, ...patch {'}'}
              {'\n'}{'}'}
              {'\n\n'}
              <span style={{ color: '#5e5e66', fontStyle: 'italic' }}>
                // 这里会根据当前设置预览常见的编辑器效果
              </span>
              {'\n'}
              <span style={{ color: '#45c8c8' }}>const</span> path =
              <span style={{ color: '#3ecf7b' }}> "D:/pragma/MyProject/FastAgents/src/renderer/components/settings/SettingsDialog.tsx"</span>
            </pre>
            {settings.editorMinimap && (
              <div className="flex w-14 shrink-0 items-stretch border-l border-white/5 bg-[#17171b] px-2 py-3">
                <div className="flex w-full flex-col gap-1">
                  <div className="h-1.5 rounded bg-[#5fa0f544]" />
                  <div className="h-1 rounded bg-[#c084fc33]" />
                  <div className="h-1 rounded bg-[#3ecf7b30]" />
                  <div className="h-1 rounded bg-[#8e8e9626]" />
                  <div className="mt-4 h-2 rounded bg-[#7c6aef55]" />
                  <div className="h-1 rounded bg-[#5fa0f533]" />
                  <div className="h-1 rounded bg-[#8e8e9626]" />
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

const DEFAULT_AI_PROMPT = `你是一个简洁的终端输出分析助手。请用 3 到 5 条要点总结终端输出：
- 执行了哪些命令
- 关键结果或错误
- 当前状态与下一步建议
保持简短、可执行，并尽量与终端输出使用同一种语言。`

const AI_PROVIDERS = [
  { id: 'openai' as const, label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', models: ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1-mini', 'gpt-4.1-nano'] },
  { id: 'anthropic' as const, label: 'Anthropic', baseUrl: 'https://api.anthropic.com', models: ['claude-haiku-4-5-20251001', 'claude-sonnet-4-6-20250514'] },
  { id: 'minimax' as const, label: 'MiniMax', baseUrl: 'https://api.minimax.chat/v1', models: ['MiniMax-M2.7'] },
  { id: 'custom' as const, label: 'Custom', baseUrl: '', models: [] },
]

function AiSettingsPage({ settings, onUpdate }: { settings: AppSettings; onUpdate: (k: keyof AppSettings, v: unknown) => void }): JSX.Element {
  const [showKey, setShowKey] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null)
  const [testing, setTesting] = useState(false)

  const provider = AI_PROVIDERS.find((p) => p.id === settings.aiProvider) ?? AI_PROVIDERS[0]

  const handleTest = async (): Promise<void> => {
    setTesting(true)
    setTestResult(null)
    try {
      const { aiProvider, aiBaseUrl, aiApiKey, aiModel } = settings
      if (!aiApiKey) { setTestResult({ ok: false, msg: 'API Key 不能为空' }); setTesting(false); return }

      const result = await window.api.ai.chat({
        baseUrl: aiBaseUrl,
        apiKey: aiApiKey,
        model: aiModel,
        provider: aiProvider,
        messages: [{ role: 'user', content: 'Say "ok"' }],
        maxTokens: 32,
      })
      if (result.error) setTestResult({ ok: false, msg: result.error })
      else setTestResult({ ok: true, msg: `连接成功，当前模型：${aiModel}` })
    } catch (err) {
      setTestResult({ ok: false, msg: err instanceof Error ? err.message : String(err) })
    }
    setTesting(false)
  }

  const INPUT = 'w-full rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-bg-primary)] px-2.5 py-1.5 text-[var(--ui-font-sm)] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-tertiary)] outline-none focus:border-[var(--color-accent)]'

  return (
    <div className={PAGE_STACK}>
      <PageIntro title="AI 摘要设置" description="配置终端输出摘要使用的模型、接口地址和系统提示词。" />
      <div className="flex items-center gap-2 mb-1">
        <Bot size={14} className="text-[var(--color-accent)]" />
        <span className="text-[var(--ui-font-sm)] font-semibold uppercase tracking-wider text-[var(--color-text-tertiary)]">
          AI 接口配置
        </span>
      </div>
      <p className="text-[var(--ui-font-xs)] text-[var(--color-text-tertiary)]">
        为终端输出摘要配置 AI 服务，支持 OpenAI、Anthropic 以及兼容 OpenAI 协议的接口。
      </p>

      {/* Provider */}
      <div className="flex flex-col gap-1.5">
        <span className="text-[var(--ui-font-sm)] text-[var(--color-text-secondary)]">服务商</span>
        <div className="flex gap-1.5">
          {AI_PROVIDERS.map((p) => (
            <button
              key={p.id}
              onClick={() => {
                onUpdate('aiProvider', p.id)
                if (p.baseUrl) onUpdate('aiBaseUrl', p.baseUrl)
                if (p.models.length > 0) onUpdate('aiModel', p.models[0])
              }}
              className={cn(
                'flex-1 rounded-[var(--radius-md)] border px-3 py-2 text-[var(--ui-font-sm)] transition-colors',
                settings.aiProvider === p.id
                  ? 'border-[var(--color-accent)] bg-[var(--color-accent-muted)] text-[var(--color-text-primary)]'
                  : 'border-[var(--color-border)] text-[var(--color-text-secondary)] hover:border-[var(--color-border-hover)]',
              )}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* Base URL */}
      <div className="flex flex-col gap-1.5">
        <span className="text-[var(--ui-font-sm)] text-[var(--color-text-secondary)]">接口地址</span>
        <input
          value={settings.aiBaseUrl}
          onChange={(e) => onUpdate('aiBaseUrl', e.target.value)}
          placeholder="https://api.openai.com/v1"
          className={INPUT}
        />
      </div>

      {/* API Key */}
      <div className="flex flex-col gap-1.5">
        <span className="text-[var(--ui-font-sm)] text-[var(--color-text-secondary)]">API 密钥</span>
        <div className="relative">
          <input
            type={showKey ? 'text' : 'password'}
            value={settings.aiApiKey}
            onChange={(e) => onUpdate('aiApiKey', e.target.value)}
            placeholder="sk-..."
            className={cn(INPUT, 'pr-8')}
          />
          <button
            onClick={() => setShowKey(!showKey)}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]"
          >
            {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
        </div>
      </div>

      {/* Model */}
      <div className="flex flex-col gap-1.5">
        <span className="text-[var(--ui-font-sm)] text-[var(--color-text-secondary)]">模型</span>
        {provider.models.length > 0 ? (
          <div className="flex flex-col gap-1">
            <div className="flex flex-wrap gap-1">
              {provider.models.map((m) => (
                <button
                  key={m}
                  onClick={() => onUpdate('aiModel', m)}
                  className={cn(
                    'rounded-[var(--radius-md)] border px-2.5 py-1 text-[var(--ui-font-xs)] transition-colors',
                    settings.aiModel === m
                      ? 'border-[var(--color-accent)] bg-[var(--color-accent-muted)] text-[var(--color-text-primary)]'
                      : 'border-[var(--color-border)] text-[var(--color-text-secondary)] hover:border-[var(--color-border-hover)]',
                  )}
                >
                  {m}
                </button>
              ))}
            </div>
            <input
              value={settings.aiModel}
              onChange={(e) => onUpdate('aiModel', e.target.value)}
              placeholder="也可以直接输入自定义模型名…"
              className={cn(INPUT, 'mt-1')}
            />
          </div>
        ) : (
          <input
            value={settings.aiModel}
            onChange={(e) => onUpdate('aiModel', e.target.value)}
            placeholder="模型名称"
            className={INPUT}
          />
        )}
      </div>

      {/* System Prompt */}
      <div className="h-px bg-[var(--color-border)]" />
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <span className="text-[var(--ui-font-sm)] text-[var(--color-text-secondary)]">系统提示词</span>
          <button
            onClick={() => onUpdate('aiSystemPrompt', DEFAULT_AI_PROMPT)}
            className="text-[10px] text-[var(--color-text-tertiary)] hover:text-[var(--color-accent)]"
          >
            恢复默认
          </button>
        </div>
        <textarea
          value={settings.aiSystemPrompt}
          onChange={(e) => onUpdate('aiSystemPrompt', e.target.value)}
          rows={5}
          className={cn(INPUT, 'resize-y min-h-[80px] text-[var(--ui-font-xs)] font-mono leading-relaxed')}
          placeholder="请输入用于生成终端摘要的系统提示词…"
        />
      </div>

      {/* Test connection */}
      <div className="flex items-center gap-2">
        <button
          onClick={handleTest}
          disabled={testing}
          className={cn(
            'flex items-center gap-1.5 rounded-[var(--radius-md)] border border-[var(--color-accent)] px-4 py-1.5',
            'text-[var(--ui-font-sm)] text-[var(--color-accent)] hover:bg-[var(--color-accent-muted)] transition-colors',
            'disabled:opacity-40',
          )}
        >
          {testing ? '测试中...' : '测试连接'}
        </button>
        {testResult && (
          <span className={cn('text-[var(--ui-font-xs)]', testResult.ok ? 'text-[var(--color-success)]' : 'text-[var(--color-error)]')}>
            {testResult.msg}
          </span>
        )}
      </div>
    </div>
  )
}

function ClaudeGuiSettingsPage(): JSX.Element {
  const preferences = useClaudeGuiStore((state) => state.preferences)
  const conversations = useClaudeGuiStore((state) => state.conversations)
  const updatePreferences = useClaudeGuiStore((state) => state.updatePreferences)
  const updateConversationPreferences = useClaudeGuiStore((state) => state.updateConversationPreferences)

  const applyPreferenceUpdate = useCallback((updates: Partial<ClaudeGuiPreferences>) => {
    updatePreferences(updates)
    for (const conversation of conversations) {
      updateConversationPreferences(conversation.id, updates)
    }
  }, [conversations, updateConversationPreferences, updatePreferences])

  const INPUT = 'w-full rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-bg-primary)] px-2.5 py-1.5 text-[var(--ui-font-sm)] text-[var(--color-text-primary)] outline-none focus:border-[var(--color-accent)]'

  return (
    <div className={PAGE_STACK}>
      <PageIntro title="Claude GUI 设置" description="统一调整内置 Claude GUI 的消息样式、模型与默认交互方式。" />
      <div className="flex items-center gap-2 mb-1">
        <Bot size={14} className="text-[var(--color-accent)]" />
        <span className="text-[var(--ui-font-sm)] font-semibold uppercase tracking-wider text-[var(--color-text-tertiary)]">
          Claude GUI
        </span>
      </div>
      <p className="text-[var(--ui-font-xs)] text-[var(--color-text-tertiary)]">
        这些设置会立即生效，并同步到现有的 Claude GUI 对话中。
      </p>

      <label className="grid gap-1">
        <span className="text-[10px] uppercase tracking-[0.16em] text-[var(--color-text-tertiary)]">权限模式</span>
        <select value={preferences.permissionMode} onChange={(event) => applyPreferenceUpdate({ permissionMode: event.target.value as ClaudeGuiPreferences['permissionMode'] })} className={INPUT}>
          <option value="default">编辑前询问</option>
          <option value="acceptEdits">直接接受编辑</option>
          <option value="plan">规划模式</option>
          <option value="dontAsk">不再询问</option>
          <option value="bypassPermissions">绕过权限限制</option>
        </select>
      </label>

      <label className="grid gap-1">
        <span className="text-[10px] uppercase tracking-[0.16em] text-[var(--color-text-tertiary)]">消息字号</span>
        <select value={preferences.messageTextSize} onChange={(event) => applyPreferenceUpdate({ messageTextSize: event.target.value as ClaudeGuiPreferences['messageTextSize'] })} className={INPUT}>
          <option value="md">中</option>
          <option value="lg">大</option>
          <option value="xl">超大</option>
        </select>
      </label>

      <label className="grid gap-1">
        <span className="text-[10px] uppercase tracking-[0.16em] text-[var(--color-text-tertiary)]">模型</span>
        <select value={preferences.selectedModel} onChange={(event) => applyPreferenceUpdate({ selectedModel: event.target.value })} className={INPUT}>
          <option value="claude-sonnet-4-6">Sonnet 4.6</option>
          <option value="claude-opus-4-6">Opus 4.6</option>
          <option value="claude-haiku-4-5-20251001">Haiku 4.5</option>
          <option value="sonnet">Sonnet</option>
          <option value="opus">Opus</option>
          <option value="default">默认</option>
        </select>
      </label>

      <label className="grid gap-1">
        <span className="text-[10px] uppercase tracking-[0.16em] text-[var(--color-text-tertiary)]">计算模式</span>
        <select value={preferences.computeMode} onChange={(event) => applyPreferenceUpdate({ computeMode: event.target.value as ClaudeGuiPreferences['computeMode'] })} className={INPUT}>
          <option value="auto">自动</option>
          <option value="max">最大</option>
        </select>
      </label>

      <label className="grid gap-1">
        <span className="text-[10px] uppercase tracking-[0.16em] text-[var(--color-text-tertiary)]">语言</span>
        <select value={preferences.language ?? 'zh'} onChange={(event) => applyPreferenceUpdate({ language: event.target.value as NonNullable<ClaudeGuiPreferences['language']> })} className={INPUT}>
          <option value="zh">中文</option>
          <option value="ja">日本語</option>
          <option value="ko">한국어</option>
          <option value="es">Español</option>
          <option value="fr">Français</option>
          <option value="de">Deutsch</option>
          <option value="ar">العربية</option>
        </select>
      </label>

      <ToggleRow
        label="只使用目标语言交流"
        description="让 Claude 尽量只用选中的语言回复。"
        checked={preferences.onlyCommunicate}
        onChange={(value) => applyPreferenceUpdate({ onlyCommunicate: value })}
      />
      <ToggleRow
        label="默认先规划"
        description="让新请求默认进入规划模式。"
        checked={preferences.planMode}
        onChange={(value) => applyPreferenceUpdate({ planMode: value })}
      />
      <ToggleRow
        label="思考模式"
        description="默认请求更深入的推理过程。"
        checked={preferences.thinkingMode}
        onChange={(value) => applyPreferenceUpdate({ thinkingMode: value })}
      />
      <ToggleRow
        label="默认附带编辑器上下文"
        description="自动附带当前编辑器选区或文件上下文。"
        checked={preferences.includeEditorContext}
        onChange={(value) => applyPreferenceUpdate({ includeEditorContext: value })}
      />

      <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg-primary)] px-3 py-2 text-[var(--ui-font-xs)] text-[var(--color-text-tertiary)]">
        已同步到现有对话：{conversations.length} 个
      </div>
    </div>
  )
}

// ─── Main Dialog ───

export function SettingsDialog(): JSX.Element | null {
  const open = useUIStore((s) => s.settingsOpen)
  const close = useUIStore((s) => s.closeSettings)
  const settingsPage = useUIStore((s) => s.settingsPage)
  const setSettingsPage = useUIStore((s) => s.setSettingsPage)
  const settings = useUIStore((s) => s.settings)
  const updateSettings = useUIStore((s) => s.updateSettings)
  const visibleNavItems = useMemo(() => NAV_ITEMS.filter((item) => item.id !== 'wsl' || isWindowsPlatform()), [])
  const requestedPage = (settingsPage || 'general') as SettingsPage
  const page = visibleNavItems.some((item) => item.id === requestedPage) ? requestedPage : 'general'

  useEffect(() => {
    if (page !== requestedPage) setSettingsPage(page)
  }, [page, requestedPage, setSettingsPage])

  useEffect(() => {
    if (isWindowsPlatform()) return
    if (settings.defaultSessionType.includes('wsl')) {
      updateSettings({ defaultSessionType: 'terminal' })
    }
  }, [settings.defaultSessionType, updateSettings])

  const handleUpdate = useCallback(
    (key: keyof AppSettings, value: unknown) => {
      updateSettings({ [key]: value })
    },
    [updateSettings],
  )

  if (!open) return null

  return (
    <>
      <div className="fixed inset-0 z-[9000] bg-black/60 backdrop-blur-sm transition-opacity" onClick={close} />
      <div
        className={cn(
          'fixed left-1/2 top-1/2 z-[9001] flex -translate-x-1/2 -translate-y-1/2',
          'w-[calc(100vw-64px)] max-w-[1080px] h-[calc(100vh-64px)] max-h-[840px] overflow-hidden',
          'rounded-[24px] border border-white/[0.1] ring-1 ring-black/50',
          'bg-[var(--color-bg-secondary)]/95 shadow-[0_32px_64px_rgba(0,0,0,0.6),inset_0_1px_1px_rgba(255,255,255,0.05)] backdrop-blur-3xl',
          'animate-[fade-in_0.2s_ease-out]',
        )}
      >
        {/* Close Button (Absolute) */}
        <button
          onClick={close}
          className={cn(
            'absolute right-4 top-4 z-[9010] flex h-8 w-8 items-center justify-center rounded-full',
            'bg-white/[0.05] text-[var(--color-text-secondary)] backdrop-blur-md',
            'border border-white/[0.05] shadow-[0_2px_8px_rgba(0,0,0,0.3)]',
            'transition-all duration-200 hover:bg-white/[0.1] hover:text-white hover:scale-105 active:scale-95',
            'focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]/80'
          )}
          title="关闭设置"
        >
          <X size={14} strokeWidth={2.5} />
        </button>

        {/* Left nav */}
        <div className="flex w-[240px] shrink-0 flex-col border-r border-white/[0.05] bg-black/20 p-4">
          <div className="mb-6 mt-2 px-2">
            <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-[var(--color-accent)] drop-shadow-[0_0_8px_var(--color-accent-muted)]">FastAgents</div>
            <h2 className="mt-1 text-[22px] font-bold tracking-tight text-white drop-shadow-sm">设置中心</h2>
          </div>
          
          <div className="flex flex-col gap-1 overflow-y-auto scrollbar-none pb-4">
            {visibleNavItems.map((item) => {
              const isActive = page === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => setSettingsPage(item.id)}
                  className={cn(
                    'group relative flex items-center gap-3 rounded-[var(--radius-lg)] px-3 py-3 text-left transition-all duration-200',
                    isActive
                      ? 'bg-[var(--color-accent)]/15 ring-1 ring-inset ring-[var(--color-accent)]/30 shadow-[inset_0_2px_8px_rgba(0,0,0,0.2)]'
                      : 'hover:bg-white/[0.06]'
                  )}
                >
                  {isActive && (
                    <div className="absolute left-0 top-2 bottom-2 w-1 rounded-r-full bg-[var(--color-accent)] shadow-[0_0_12px_var(--color-accent)]" />
                  )}
                  <div className={cn(
                    'flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius-md)] transition-colors duration-200',
                    isActive
                      ? 'bg-white/[0.05] text-[var(--color-accent)] shadow-sm'
                      : 'bg-black/20 text-[var(--color-text-tertiary)] group-hover:text-[var(--color-text-secondary)]',
                  )}>
                    <item.icon size={15} strokeWidth={isActive ? 2.5 : 2} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className={cn(
                      'text-[13px] transition-colors duration-200',
                      isActive ? 'font-bold text-white' : 'font-medium text-[var(--color-text-secondary)] group-hover:text-[var(--color-text-primary)]'
                    )}>{item.label}</div>
                    <div className={cn(
                      'mt-0.5 text-[10px] leading-tight transition-colors duration-200',
                      isActive ? 'text-[var(--color-text-secondary)]' : 'text-[var(--color-text-tertiary)]/70'
                    )}>{item.description}</div>
                  </div>
                </button>
              )
            })}
          </div>
        </div>

        {/* Right content */}
        <div className="relative flex flex-1 flex-col bg-[linear-gradient(180deg,rgba(0,0,0,0.1),transparent)]">
          <div className="flex-1 overflow-y-auto scrollbar-none px-10 py-10 pb-20">
            {page === 'general' && <GeneralPage settings={settings} onUpdate={handleUpdate} />}
            {page === 'sessions' && <SessionsPage settings={settings} onUpdate={handleUpdate} />}
            {page === 'wsl' && <WslPage settings={settings} onUpdate={handleUpdate} />}
            {page === 'workspace' && <WorkspacePage settings={settings} onUpdate={handleUpdate} />}
            {page === 'notifications' && <NotificationsPage settings={settings} onUpdate={handleUpdate} />}
            {page === 'titlebar' && <TitleBarPage settings={settings} onUpdate={handleUpdate} />}
            {page === 'git' && <GitPage settings={settings} onUpdate={handleUpdate} />}
            {page === 'appearance' && <AppearancePage settings={settings} onUpdate={handleUpdate} />}
            {page === 'terminal' && <TerminalPage settings={settings} onUpdate={handleUpdate} />}
            {page === 'editor' && <EditorPage settings={settings} onUpdate={handleUpdate} />}
            {page === 'templates' && <TemplatesPage />}
            {page === 'ai' && <AiSettingsPage settings={settings} onUpdate={handleUpdate} />}
            {page === 'claudeGui' && <ClaudeGuiSettingsPage />}
          </div>
          
          {/* Subtle footer gradient to show scrollability */}
          <div className="pointer-events-none absolute bottom-0 left-0 right-0 h-16 bg-gradient-to-t from-[var(--color-bg-secondary)] to-transparent" />
        </div>
      </div>
    </>
  )
}
