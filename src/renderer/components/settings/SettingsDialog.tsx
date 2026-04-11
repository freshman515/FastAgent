import { X, Settings, Type, Terminal, Layers, AudioLines, BarChart3, ExternalLink, Trash2 } from 'lucide-react'
import { useCallback, useState } from 'react'
import { cn } from '@/lib/utils'
import { useUIStore, type AppSettings } from '@/stores/ui'
import { useGroupsStore } from '@/stores/groups'
import { useSessionsStore } from '@/stores/sessions'
import { usePanesStore } from '@/stores/panes'
import { TemplatesPage } from './TemplatesPage'

type SettingsPage = 'general' | 'appearance' | 'terminal' | 'templates'

const NAV_ITEMS: Array<{ id: SettingsPage; label: string; icon: typeof Settings }> = [
  { id: 'general', label: 'General', icon: Settings },
  { id: 'appearance', label: 'Appearance', icon: Type },
  { id: 'terminal', label: 'Terminal', icon: Terminal },
  { id: 'templates', label: 'Templates', icon: Layers },
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

function ToggleRow({ label, description, checked, onChange }: {
  label: string; description: string; checked: boolean; onChange: (v: boolean) => void
}): JSX.Element {
  return (
    <div className="flex items-center justify-between">
      <div className="flex flex-col">
        <span className="text-[var(--ui-font-sm)] text-[var(--color-text-secondary)]">{label}</span>
        <span className="text-[var(--ui-font-2xs)] text-[var(--color-text-tertiary)]">{description}</span>
      </div>
      <button
        onClick={() => onChange(!checked)}
        className={cn(
          'relative h-5 w-9 shrink-0 rounded-full transition-colors duration-200',
          checked ? 'bg-[var(--color-accent)]' : 'bg-[var(--color-bg-surface)]',
        )}
      >
        <span
          className={cn(
            'absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform duration-200',
            checked && 'translate-x-4',
          )}
        />
      </button>
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
        {(['claude-code', 'claude-code-yolo', 'codex', 'codex-yolo', 'opencode', 'terminal'] as const).map((t) => (
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
            {t === 'claude-code' ? 'Claude Code' : t === 'claude-code-yolo' ? 'Claude Code YOLO' : t === 'codex-yolo' ? 'Codex YOLO' : t === 'opencode' ? 'OpenCode' : t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {/* Pop-out window */}
      <div className="h-px bg-[var(--color-border)]" />
      <div className="flex items-center gap-2 mb-1">
        <ExternalLink size={14} className="text-[var(--color-accent)]" />
        <span className="text-[var(--ui-font-sm)] font-semibold uppercase tracking-wider text-[var(--color-text-tertiary)]">
          Pop-out Window
        </span>
      </div>
      <p className="text-[var(--ui-font-xs)] text-[var(--color-text-tertiary)]">
        Default size and position when popping out a session tab.
      </p>
      <div className="flex gap-3">
        <FontSizeSlider label="Width" value={settings.popoutWidth} min={400} max={1920} onChange={(v) => onUpdate('popoutWidth', v)} />
        <FontSizeSlider label="Height" value={settings.popoutHeight} min={300} max={1080} onChange={(v) => onUpdate('popoutHeight', v)} />
      </div>
      <div className="flex gap-2">
        {([
          { id: 'cursor' as const, label: 'Follow Cursor', desc: 'Window appears at mouse position' },
          { id: 'center' as const, label: 'Screen Center', desc: 'Window always opens centered' },
        ]).map(({ id, label, desc }) => (
          <button
            key={id}
            onClick={() => onUpdate('popoutPosition', id)}
            className={cn(
              'flex flex-1 flex-col rounded-[var(--radius-md)] border px-3 py-2 transition-colors',
              settings.popoutPosition === id
                ? 'border-[var(--color-accent)] bg-[var(--color-accent-muted)] text-[var(--color-text-primary)]'
                : 'border-[var(--color-border)] text-[var(--color-text-secondary)] hover:border-[var(--color-border-hover)]',
            )}
          >
            <span className="text-[var(--ui-font-sm)] font-medium">{label}</span>
            <span className="text-[var(--ui-font-2xs)] text-[var(--color-text-tertiary)]">{desc}</span>
          </button>
        ))}
      </div>

      {/* Music player toggle + visualizer mode */}
      <div className="h-px bg-[var(--color-border)]" />
      <div className="flex items-center gap-2 mb-1">
        <AudioLines size={14} className="text-[var(--color-accent)]" />
        <span className="text-[var(--ui-font-sm)] font-semibold uppercase tracking-wider text-[var(--color-text-tertiary)]">
          Music Player
        </span>
      </div>
      <div className="flex items-center justify-between">
        <div className="flex flex-col">
          <span className="text-[var(--ui-font-sm)] text-[var(--color-text-secondary)]">Show in title bar</span>
          <span className="text-[var(--ui-font-2xs)] text-[var(--color-text-tertiary)]">
            {settings.showMusicPlayer ? 'Music player with visualizer' : 'Current project name'}
          </span>
        </div>
        <button
          onClick={() => onUpdate('showMusicPlayer', !settings.showMusicPlayer)}
          className={cn(
            'relative h-5 w-9 rounded-full transition-colors duration-200',
            settings.showMusicPlayer ? 'bg-[var(--color-accent)]' : 'bg-[var(--color-bg-surface)]',
          )}
        >
          <span
            className={cn(
              'absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform duration-200',
              settings.showMusicPlayer && 'translate-x-4',
            )}
          />
        </button>
      </div>
      {settings.showMusicPlayer && (
        <>
      <p className="text-[var(--ui-font-xs)] text-[var(--color-text-tertiary)]">
        Visualizer style for the title bar music player.
      </p>
      <div className="flex gap-2">
        {([
          { id: 'melody' as const, label: 'Melody', icon: AudioLines, desc: 'Flowing curves & particles' },
          { id: 'bars' as const, label: 'Bars', icon: BarChart3, desc: 'Spectrum bar chart' },
        ]).map(({ id, label, icon: Icon, desc }) => (
          <button
            key={id}
            onClick={() => onUpdate('visualizerMode', id)}
            className={cn(
              'flex flex-1 items-center gap-2.5 rounded-[var(--radius-md)] border px-3 py-2.5 transition-colors',
              settings.visualizerMode === id
                ? 'border-[var(--color-accent)] bg-[var(--color-accent-muted)] text-[var(--color-text-primary)]'
                : 'border-[var(--color-border)] text-[var(--color-text-secondary)] hover:border-[var(--color-border-hover)]',
            )}
          >
            <Icon size={16} />
            <div className="flex flex-col items-start">
              <span className="text-[var(--ui-font-sm)] font-medium">{label}</span>
              <span className="text-[var(--ui-font-2xs)] text-[var(--color-text-tertiary)]">{desc}</span>
            </div>
          </button>
        ))}
      </div>

      {/* Visualizer width */}
      <FontSizeSlider
        label="Visualizer Width"
        value={settings.visualizerWidth}
        min={80}
        max={Math.max(400, window.innerWidth)}
        onChange={(v) => onUpdate('visualizerWidth', v)}
      />

      {/* Show controls toggle */}
      <ToggleRow
        label="Play Controls"
        description="Previous / Play-Pause / Next buttons"
        checked={settings.showPlayerControls}
        onChange={(v) => onUpdate('showPlayerControls', v)}
      />

      {/* Show track info toggle */}
      <ToggleRow
        label="Track Info"
        description="Song title, artist name and artwork"
        checked={settings.showTrackInfo}
        onChange={(v) => onUpdate('showTrackInfo', v)}
      />
        </>
      )}

      {/* Clear all sessions */}
      <div className="h-px bg-[var(--color-border)]" />
      <div className="flex items-center gap-2 mb-1">
        <Trash2 size={14} className="text-[var(--color-error)]" />
        <span className="text-[var(--ui-font-sm)] font-semibold uppercase tracking-wider text-[var(--color-text-tertiary)]">
          Data
        </span>
      </div>
      <p className="text-[var(--ui-font-xs)] text-[var(--color-text-tertiary)]">
        Clear all session tabs and pane layouts. Projects and groups are preserved.
      </p>
      <button
        onClick={() => {
          // Kill all PTYs
          const sessions = useSessionsStore.getState().sessions
          for (const s of sessions) {
            if (s.ptyId) window.api.session.kill(s.ptyId).catch(() => {})
          }
          // Reset stores
          useSessionsStore.setState({ sessions: [], activeSessionId: null, outputStates: {}, closedStack: [] })
          usePanesStore.getState().initPane([], null)
          // Persist
          window.api.config.write('sessions', [])
          window.api.config.write('panes', {})
        }}
        className={cn(
          'flex items-center gap-2 self-start rounded-[var(--radius-md)] border border-[var(--color-error)]/30 px-4 py-2',
          'text-[var(--ui-font-sm)] text-[var(--color-error)]',
          'hover:bg-[var(--color-error)]/10 transition-colors',
        )}
      >
        <Trash2 size={13} />
        Clear All Sessions
      </button>
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
          'h-[520px] w-[680px] overflow-hidden',
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
            {page === 'templates' && <TemplatesPage />}
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
