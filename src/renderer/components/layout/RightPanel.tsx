import { Activity, Command, FolderTree, GitBranch, History, PanelRightClose, PanelRightOpen } from 'lucide-react'
import { useCallback, useRef } from 'react'
import { cn } from '@/lib/utils'
import { useUIStore } from '@/stores/ui'
import { AgentMonitor } from '@/components/rightpanel/AgentMonitor'
import { QuickCommands } from '@/components/rightpanel/QuickCommands'
import { FileTree } from '@/components/rightpanel/FileTree'
import { SessionTimeline } from '@/components/rightpanel/SessionTimeline'
import { GitChanges } from '@/components/rightpanel/GitChanges'

const TABS = [
  { id: 'agent', label: 'Agent', icon: Activity },
  { id: 'commands', label: 'Commands', icon: Command },
  { id: 'files', label: 'Files', icon: FolderTree },
  { id: 'timeline', label: 'Timeline', icon: History },
  { id: 'git', label: 'Git', icon: GitBranch },
] as const

export function RightPanel(): JSX.Element {
  const collapsed = useUIStore((s) => s.rightPanelCollapsed)
  const toggle = useUIStore((s) => s.toggleRightPanel)
  const activeTab = useUIStore((s) => s.rightPanelTab)
  const setTab = useUIStore((s) => s.setRightPanelTab)
  const width = useUIStore((s) => s.rightPanelWidth)
  const setWidth = useUIStore((s) => s.setRightPanelWidth)
  const isDragging = useRef(false)

  const handleResizeMouseDown = useCallback(() => {
    isDragging.current = true
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'

    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging.current) return
      const newWidth = Math.max(240, Math.min(600, window.innerWidth - e.clientX))
      setWidth(newWidth)
    }

    const handleMouseUp = () => {
      isDragging.current = false
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
  }, [setWidth])

  if (collapsed) {
    return (
      <div className="flex h-full shrink-0 flex-col items-center border-l border-[var(--color-border)] bg-[var(--color-bg-secondary)] py-2 px-1 gap-1">
        <button
          onClick={toggle}
          className="flex h-7 w-7 items-center justify-center rounded-[var(--radius-sm)] text-[var(--color-text-tertiary)] hover:bg-[var(--color-bg-tertiary)] hover:text-[var(--color-text-secondary)] transition-colors"
          title="Expand Panel"
        >
          <PanelRightOpen size={14} />
        </button>
        <div className="h-px w-5 bg-[var(--color-border)] my-1" />
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setTab(tab.id)}
            className={cn(
              'flex h-7 w-7 items-center justify-center rounded-[var(--radius-sm)] transition-colors',
              activeTab === tab.id
                ? 'bg-[var(--color-accent-muted)] text-[var(--color-accent)]'
                : 'text-[var(--color-text-tertiary)] hover:bg-[var(--color-bg-tertiary)] hover:text-[var(--color-text-secondary)]',
            )}
            title={tab.label}
          >
            <tab.icon size={14} />
          </button>
        ))}
      </div>
    )
  }

  return (
    <div className="flex h-full shrink-0 bg-[var(--color-bg-secondary)]" style={{ width }}>
      {/* Resize handle */}
      <div
        onMouseDown={handleResizeMouseDown}
        className="group relative z-10 w-px shrink-0 cursor-col-resize bg-[var(--color-border)]"
      >
        <div className="absolute inset-y-0 -left-1 -right-1 group-hover:bg-[var(--color-accent)]/20" />
      </div>

      {/* Tab strip */}
      <div className="flex shrink-0 flex-col items-center border-r border-[var(--color-border)] bg-[var(--color-bg-primary)] py-2 px-1 gap-1">
        <button
          onClick={toggle}
          className="flex h-7 w-7 items-center justify-center rounded-[var(--radius-sm)] text-[var(--color-text-tertiary)] hover:bg-[var(--color-bg-tertiary)] hover:text-[var(--color-text-secondary)] transition-colors"
          title="Collapse Panel"
        >
          <PanelRightClose size={14} />
        </button>
        <div className="h-px w-5 bg-[var(--color-border)] my-1" />
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setTab(tab.id)}
            className={cn(
              'flex h-7 w-7 items-center justify-center rounded-[var(--radius-sm)] transition-colors',
              activeTab === tab.id
                ? 'bg-[var(--color-accent-muted)] text-[var(--color-accent)]'
                : 'text-[var(--color-text-tertiary)] hover:bg-[var(--color-bg-tertiary)] hover:text-[var(--color-text-secondary)]',
            )}
            title={tab.label}
          >
            <tab.icon size={14} />
          </button>
        ))}
      </div>

      {/* Content area */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Header */}
        <div className="flex h-9 shrink-0 items-center justify-between border-b border-[var(--color-border)] px-3">
          <span className="text-[var(--ui-font-sm)] font-semibold text-[var(--color-text-primary)]">
            {TABS.find((t) => t.id === activeTab)?.label}
          </span>
        </div>

        {/* Panel content */}
        <div className="flex-1 overflow-y-auto overflow-x-hidden">
          {activeTab === 'agent' && <AgentMonitor />}
          {activeTab === 'commands' && <QuickCommands />}
          {activeTab === 'files' && <FileTree />}
          {activeTab === 'timeline' && <SessionTimeline />}
          {activeTab === 'git' && <GitChanges />}
        </div>
      </div>
    </div>
  )
}
