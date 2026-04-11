import { X, Settings, Type, Terminal, Layers, AudioLines, BarChart3, ExternalLink, Trash2, Bot, Eye, EyeOff, FileCode2, Search } from 'lucide-react'
import { useCallback, useState } from 'react'
import { cn } from '@/lib/utils'
import { useUIStore, type AppSettings } from '@/stores/ui'
import { useGroupsStore } from '@/stores/groups'
import { useSessionsStore } from '@/stores/sessions'
import { usePanesStore } from '@/stores/panes'
import { TemplatesPage } from './TemplatesPage'

type SettingsPage = 'general' | 'appearance' | 'terminal' | 'editor' | 'templates' | 'ai'

const NAV_ITEMS: Array<{ id: SettingsPage; label: string; icon: typeof Settings }> = [
  { id: 'general', label: 'General', icon: Settings },
  { id: 'appearance', label: 'Appearance', icon: Type },
  { id: 'terminal', label: 'Terminal', icon: Terminal },
  { id: 'editor', label: 'Editor', icon: FileCode2 },
  { id: 'templates', label: 'Templates', icon: Layers },
  { id: 'ai', label: 'AI', icon: Bot },
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
const EDITOR_FONT_OPTIONS = TERMINAL_FONT_OPTIONS
const EDITOR_FONT_LABELS = TERMINAL_FONT_LABELS

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

      {/* Title bar search */}
      <div className="h-px bg-[var(--color-border)]" />
      <div className="flex items-center gap-2 mb-1">
        <Search size={14} className="text-[var(--color-accent)]" />
        <span className="text-[var(--ui-font-sm)] font-semibold uppercase tracking-wider text-[var(--color-text-tertiary)]">
          Title Bar Search
        </span>
      </div>
      <p className="text-[var(--ui-font-xs)] text-[var(--color-text-tertiary)]">
        Show a long search box in the title bar for files and sessions. When enabled, it replaces the center music player / project name area.
      </p>
      <ToggleRow
        label="Enable title bar search"
        description={settings.showTitleBarSearch ? 'Files + sessions are searchable from the top bar' : 'Center area shows the music player or current project name'}
        checked={settings.showTitleBarSearch}
        onChange={(v) => onUpdate('showTitleBarSearch', v)}
      />
      {settings.showTitleBarSearch && (
        <div className="flex gap-2">
          {([
            { id: 'project' as const, label: 'Current Project', desc: 'Search only the selected project / worktree' },
            { id: 'all-projects' as const, label: 'All Projects', desc: 'Search files and sessions across every project' },
          ]).map(({ id, label, desc }) => (
            <button
              key={id}
              onClick={() => onUpdate('titleBarSearchScope', id)}
              className={cn(
                'flex flex-1 flex-col rounded-[var(--radius-md)] border px-3 py-2 transition-colors',
                settings.titleBarSearchScope === id
                  ? 'border-[var(--color-accent)] bg-[var(--color-accent-muted)] text-[var(--color-text-primary)]'
                  : 'border-[var(--color-border)] text-[var(--color-text-secondary)] hover:border-[var(--color-border-hover)]',
              )}
            >
              <span className="text-[var(--ui-font-sm)] font-medium">{label}</span>
              <span className="text-[var(--ui-font-2xs)] text-[var(--color-text-tertiary)]">{desc}</span>
            </button>
          ))}
        </div>
      )}

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
            {settings.showTitleBarSearch
              ? 'Hidden while title bar search is enabled'
              : settings.showMusicPlayer
                ? 'Music player with visualizer'
                : 'Current project name'}
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

function EditorPage({ settings, onUpdate }: { settings: AppSettings; onUpdate: (k: keyof AppSettings, v: unknown) => void }): JSX.Element {
  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-2 mb-1">
        <FileCode2 size={14} className="text-[var(--color-accent)]" />
        <span className="text-[var(--ui-font-sm)] font-semibold uppercase tracking-wider text-[var(--color-text-tertiary)]">
          Editor
        </span>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <FontSizeSlider label="Font Size" value={settings.editorFontSize} min={11} max={28} onChange={(v) => onUpdate('editorFontSize', v)} />
        <FontSelect
          label="Font Family"
          value={settings.editorFontFamily}
          options={EDITOR_FONT_OPTIONS}
          labels={EDITOR_FONT_LABELS}
          onChange={(v) => onUpdate('editorFontFamily', v)}
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <ToggleRow
          label="Word Wrap"
          description="Long lines wrap instead of horizontal scrolling"
          checked={settings.editorWordWrap}
          onChange={(v) => onUpdate('editorWordWrap', v)}
        />
        <ToggleRow
          label="Minimap"
          description="Show the code overview map on the right"
          checked={settings.editorMinimap}
          onChange={(v) => onUpdate('editorMinimap', v)}
        />
        <ToggleRow
          label="Line Numbers"
          description="Show line numbers on the left gutter"
          checked={settings.editorLineNumbers}
          onChange={(v) => onUpdate('editorLineNumbers', v)}
        />
        <ToggleRow
          label="Sticky Scroll"
          description="Pin the current scope header while scrolling"
          checked={settings.editorStickyScroll}
          onChange={(v) => onUpdate('editorStickyScroll', v)}
        />
        <ToggleRow
          label="Font Ligatures"
          description="Render combined glyphs like => and ==="
          checked={settings.editorFontLigatures}
          onChange={(v) => onUpdate('editorFontLigatures', v)}
        />
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-[var(--ui-font-sm)] text-[var(--color-text-secondary)]">Preview</span>
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
                // Previewing typical editor options with your current typography
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

const DEFAULT_AI_PROMPT = `You are a concise terminal output analyzer. Summarize the terminal output in 3-5 bullet points:
- What commands were run
- Key results or errors
- Current status
Keep it brief and actionable. Use the same language as the terminal output.`

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
      if (!aiApiKey) { setTestResult({ ok: false, msg: 'API key is empty' }); setTesting(false); return }

      const result = await window.api.ai.chat({
        baseUrl: aiBaseUrl,
        apiKey: aiApiKey,
        model: aiModel,
        provider: aiProvider,
        messages: [{ role: 'user', content: 'Say "ok"' }],
        maxTokens: 32,
      })
      if (result.error) setTestResult({ ok: false, msg: result.error })
      else setTestResult({ ok: true, msg: `Connected! Model: ${aiModel}` })
    } catch (err) {
      setTestResult({ ok: false, msg: err instanceof Error ? err.message : String(err) })
    }
    setTesting(false)
  }

  const INPUT = 'w-full rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-bg-primary)] px-2.5 py-1.5 text-[var(--ui-font-sm)] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-tertiary)] outline-none focus:border-[var(--color-accent)]'

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2 mb-1">
        <Bot size={14} className="text-[var(--color-accent)]" />
        <span className="text-[var(--ui-font-sm)] font-semibold uppercase tracking-wider text-[var(--color-text-tertiary)]">
          AI API Configuration
        </span>
      </div>
      <p className="text-[var(--ui-font-xs)] text-[var(--color-text-tertiary)]">
        Configure the AI provider for terminal output summaries. Supports OpenAI, Anthropic, and any OpenAI-compatible API.
      </p>

      {/* Provider */}
      <div className="flex flex-col gap-1.5">
        <span className="text-[var(--ui-font-sm)] text-[var(--color-text-secondary)]">Provider</span>
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
        <span className="text-[var(--ui-font-sm)] text-[var(--color-text-secondary)]">Base URL</span>
        <input
          value={settings.aiBaseUrl}
          onChange={(e) => onUpdate('aiBaseUrl', e.target.value)}
          placeholder="https://api.openai.com/v1"
          className={INPUT}
        />
      </div>

      {/* API Key */}
      <div className="flex flex-col gap-1.5">
        <span className="text-[var(--ui-font-sm)] text-[var(--color-text-secondary)]">API Key</span>
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
        <span className="text-[var(--ui-font-sm)] text-[var(--color-text-secondary)]">Model</span>
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
              placeholder="Or type a custom model name..."
              className={cn(INPUT, 'mt-1')}
            />
          </div>
        ) : (
          <input
            value={settings.aiModel}
            onChange={(e) => onUpdate('aiModel', e.target.value)}
            placeholder="model name"
            className={INPUT}
          />
        )}
      </div>

      {/* System Prompt */}
      <div className="h-px bg-[var(--color-border)]" />
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <span className="text-[var(--ui-font-sm)] text-[var(--color-text-secondary)]">System Prompt</span>
          <button
            onClick={() => onUpdate('aiSystemPrompt', DEFAULT_AI_PROMPT)}
            className="text-[10px] text-[var(--color-text-tertiary)] hover:text-[var(--color-accent)]"
          >
            Reset to default
          </button>
        </div>
        <textarea
          value={settings.aiSystemPrompt}
          onChange={(e) => onUpdate('aiSystemPrompt', e.target.value)}
          rows={5}
          className={cn(INPUT, 'resize-y min-h-[80px] text-[var(--ui-font-xs)] font-mono leading-relaxed')}
          placeholder="You are a concise terminal output analyzer..."
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
          'h-[640px] w-[920px] max-h-[calc(100vh-40px)] max-w-[calc(100vw-40px)] overflow-hidden',
          'rounded-[var(--radius-xl)] border border-[var(--color-border)]',
          'bg-[var(--color-bg-secondary)] shadow-2xl shadow-black/40',
          'animate-[fade-in_0.15s_ease-out]',
        )}
      >
        {/* Left nav */}
        <div className="flex w-[184px] shrink-0 flex-col border-r border-[var(--color-border)] bg-[var(--color-bg-primary)] py-3">
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
            {page === 'editor' && <EditorPage settings={settings} onUpdate={handleUpdate} />}
            {page === 'templates' && <TemplatesPage />}
            {page === 'ai' && <AiSettingsPage settings={settings} onUpdate={handleUpdate} />}
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
