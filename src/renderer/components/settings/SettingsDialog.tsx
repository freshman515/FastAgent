import { X, Settings, Type, Terminal, Layers } from 'lucide-react'
import { useCallback, useState } from 'react'
import { cn } from '@/lib/utils'
import { useUIStore, type AppSettings } from '@/stores/ui'
import { useGroupsStore } from '@/stores/groups'

type SettingsPage = 'general' | 'appearance' | 'terminal'

const NAV_ITEMS: Array<{ id: SettingsPage; label: string; icon: typeof Settings }> = [
  { id: 'general', label: 'General', icon: Settings },
  { id: 'appearance', label: 'Appearance', icon: Type },
  { id: 'terminal', label: 'Terminal', icon: Terminal },
]

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

// ─── Shared components ───

function FontSizeSlider({ label, value, min, max, onChange }: {
  label: string; value: number; min: number; max: number; onChange: (v: number) => void
}): JSX.Element {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <span className="text-[var(--ui-font-sm)] text-[var(--color-text-secondary)]">{label}</span>
        <span className="text-[var(--ui-font-sm)] font-mono text-[var(--color-text-primary)]">{value}px</span>
      </div>
      <input
        type="range" min={min} max={max} step={1} value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-1 w-full cursor-pointer appearance-none rounded-full bg-[var(--color-bg-surface)] accent-[var(--color-accent)]"
      />
    </div>
  )
}

function FontSelect({ label, value, options, labels, onChange }: {
  label: string; value: string; options: string[]; labels: string[]; onChange: (v: string) => void
}): JSX.Element {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[var(--ui-font-sm)] text-[var(--color-text-secondary)]">{label}</span>
      <div className="flex flex-wrap gap-1">
        {options.map((opt, i) => (
          <button
            key={opt}
            onClick={() => onChange(opt)}
            className={cn(
              'rounded-[var(--radius-md)] border px-2.5 py-1 text-[var(--ui-font-xs)] transition-colors',
              value === opt
                ? 'border-[var(--color-accent)] bg-[var(--color-accent-muted)] text-[var(--color-text-primary)]'
                : 'border-[var(--color-border)] text-[var(--color-text-secondary)] hover:border-[var(--color-border-hover)]',
            )}
            style={{ fontFamily: opt }}
          >
            {labels[i]}
          </button>
        ))}
      </div>
    </div>
  )
}

// ─── Pages ───

function GeneralPage({ settings, onUpdate }: { settings: AppSettings; onUpdate: (k: keyof AppSettings, v: unknown) => void }): JSX.Element {
  const groups = useGroupsStore((s) => s.groups)

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2 mb-1">
        <Layers size={14} className="text-[var(--color-accent)]" />
        <span className="text-[var(--ui-font-sm)] font-semibold uppercase tracking-wider text-[var(--color-text-tertiary)]">
          Group Visibility
        </span>
      </div>
      <p className="text-[var(--ui-font-xs)] text-[var(--color-text-tertiary)]">
        Choose which group to display in the sidebar, or show all groups.
      </p>
      <div className="flex flex-col gap-1">
        <button
          onClick={() => onUpdate('visibleGroupId', null)}
          className={cn(
            'flex items-center gap-2 rounded-[var(--radius-md)] px-3 py-2 text-[var(--ui-font-sm)] transition-colors',
            settings.visibleGroupId === null
              ? 'bg-[var(--color-accent-muted)] text-[var(--color-text-primary)] border border-[var(--color-accent)]'
              : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-tertiary)] border border-transparent',
          )}
        >
          <div className="h-2.5 w-2.5 rounded-full bg-[var(--color-text-tertiary)]" />
          All Groups
        </button>
        {groups.map((g) => (
          <button
            key={g.id}
            onClick={() => onUpdate('visibleGroupId', g.id)}
            className={cn(
              'flex items-center gap-2 rounded-[var(--radius-md)] px-3 py-2 text-[var(--ui-font-sm)] transition-colors',
              settings.visibleGroupId === g.id
                ? 'bg-[var(--color-accent-muted)] text-[var(--color-text-primary)] border border-[var(--color-accent)]'
                : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-tertiary)] border border-transparent',
            )}
          >
            <div className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: g.color }} />
            {g.name}
          </button>
        ))}
      </div>

      {/* Default session type */}
      <div className="h-px bg-[var(--color-border)]" />
      <div className="flex items-center gap-2 mb-1">
        <Settings size={14} className="text-[var(--color-accent)]" />
        <span className="text-[var(--ui-font-sm)] font-semibold uppercase tracking-wider text-[var(--color-text-tertiary)]">
          Default Session
        </span>
      </div>
      <p className="text-[var(--ui-font-xs)] text-[var(--color-text-tertiary)]">
        Session type created when double-clicking the tab bar.
      </p>
      <div className="flex flex-wrap gap-1">
        {(['claude-code', 'codex', 'opencode', 'terminal'] as const).map((t) => (
          <button
            key={t}
            onClick={() => onUpdate('defaultSessionType', t)}
            className={cn(
              'rounded-[var(--radius-md)] border px-3 py-1.5 text-[var(--ui-font-sm)] transition-colors',
              settings.defaultSessionType === t
                ? 'border-[var(--color-accent)] bg-[var(--color-accent-muted)] text-[var(--color-text-primary)]'
                : 'border-[var(--color-border)] text-[var(--color-text-secondary)] hover:border-[var(--color-border-hover)]',
            )}
          >
            {t === 'claude-code' ? 'Claude Code' : t === 'opencode' ? 'OpenCode' : t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>
    </div>
  )
}

function AppearancePage({ settings, onUpdate }: { settings: AppSettings; onUpdate: (k: keyof AppSettings, v: unknown) => void }): JSX.Element {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2 mb-1">
        <Type size={14} className="text-[var(--color-accent)]" />
        <span className="text-[var(--ui-font-sm)] font-semibold uppercase tracking-wider text-[var(--color-text-tertiary)]">
          Interface
        </span>
      </div>
      <FontSizeSlider label="Font Size" value={settings.uiFontSize} min={11} max={18} onChange={(v) => onUpdate('uiFontSize', v)} />
      <FontSelect label="Font Family" value={settings.uiFontFamily} options={UI_FONT_OPTIONS} labels={UI_FONT_LABELS} onChange={(v) => onUpdate('uiFontFamily', v)} />
      <div
        className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg-primary)] px-3 py-2"
        style={{ fontSize: settings.uiFontSize, fontFamily: settings.uiFontFamily }}
      >
        <span className="text-[var(--color-text-secondary)]">Preview: The quick brown fox jumps 你好世界</span>
      </div>
    </div>
  )
}

function TerminalPage({ settings, onUpdate }: { settings: AppSettings; onUpdate: (k: keyof AppSettings, v: unknown) => void }): JSX.Element {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2 mb-1">
        <Terminal size={14} className="text-[var(--color-success)]" />
        <span className="text-[var(--ui-font-sm)] font-semibold uppercase tracking-wider text-[var(--color-text-tertiary)]">
          Terminal
        </span>
      </div>
      <FontSizeSlider label="Font Size" value={settings.terminalFontSize} min={10} max={24} onChange={(v) => onUpdate('terminalFontSize', v)} />
      <FontSelect label="Font Family" value={settings.terminalFontFamily} options={TERMINAL_FONT_OPTIONS} labels={TERMINAL_FONT_LABELS} onChange={(v) => onUpdate('terminalFontFamily', v)} />
      <div
        className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[#1a1a1e] px-3 py-2"
        style={{ fontSize: settings.terminalFontSize, fontFamily: settings.terminalFontFamily }}
      >
        <span style={{ color: '#3ecf7b' }}>$</span>
        <span style={{ color: '#e8e8ec' }}> git status</span>
        <br />
        <span style={{ color: '#8e8e96' }}>On branch main 你好世界</span>
      </div>
    </div>
  )
}

// ─── Main Dialog ───

export function SettingsDialog(): JSX.Element | null {
  const open = useUIStore((s) => s.settingsOpen)
  const close = useUIStore((s) => s.closeSettings)
  const settings = useUIStore((s) => s.settings)
  const updateSettings = useUIStore((s) => s.updateSettings)
  const [page, setPage] = useState<SettingsPage>('general')

  const handleUpdate = useCallback(
    (key: keyof AppSettings, value: unknown) => {
      updateSettings({ [key]: value })
    },
    [updateSettings],
  )

  if (!open) return null

  return (
    <>
      <div className="fixed inset-0 z-[100] bg-black/40" onClick={close} />
      <div
        className={cn(
          'fixed left-1/2 top-1/2 z-[101] flex -translate-x-1/2 -translate-y-1/2',
          'h-[420px] w-[600px] overflow-hidden',
          'rounded-[var(--radius-xl)] border border-[var(--color-border)]',
          'bg-[var(--color-bg-secondary)] shadow-2xl shadow-black/40',
          'animate-[fade-in_0.15s_ease-out]',
        )}
      >
        {/* Left nav */}
        <div className="flex w-[160px] shrink-0 flex-col border-r border-[var(--color-border)] bg-[var(--color-bg-primary)] py-3">
          <div className="px-4 pb-3">
            <h2 className="text-[var(--ui-font-md)] font-semibold text-[var(--color-text-primary)]">Settings</h2>
          </div>
          <div className="flex flex-col gap-0.5 px-2">
            {NAV_ITEMS.map((item) => (
              <button
                key={item.id}
                onClick={() => setPage(item.id)}
                className={cn(
                  'flex items-center gap-2 rounded-[var(--radius-md)] px-3 py-1.5 text-[var(--ui-font-sm)] transition-colors',
                  page === item.id
                    ? 'bg-[var(--color-bg-tertiary)] text-[var(--color-text-primary)]'
                    : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-tertiary)]/50',
                )}
              >
                <item.icon size={13} />
                {item.label}
              </button>
            ))}
          </div>
        </div>

        {/* Right content */}
        <div className="flex flex-1 flex-col overflow-hidden">
          <div className="flex items-center justify-end px-4 py-2.5">
            <button
              onClick={close}
              className={cn(
                'flex h-6 w-6 items-center justify-center rounded-[var(--radius-sm)]',
                'text-[var(--color-text-tertiary)] hover:bg-[var(--color-bg-tertiary)] hover:text-[var(--color-text-secondary)]',
              )}
            >
              <X size={14} />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto px-5 pb-4">
            {page === 'general' && <GeneralPage settings={settings} onUpdate={handleUpdate} />}
            {page === 'appearance' && <AppearancePage settings={settings} onUpdate={handleUpdate} />}
            {page === 'terminal' && <TerminalPage settings={settings} onUpdate={handleUpdate} />}
          </div>
          <div className="border-t border-[var(--color-border)] px-5 py-2">
            <span className="text-[var(--ui-font-2xs)] text-[var(--color-text-tertiary)]">
              Changes apply immediately.
            </span>
          </div>
        </div>
      </div>
    </>
  )
}
