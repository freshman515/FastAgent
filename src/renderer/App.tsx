import { TitleBar } from '@/components/layout/TitleBar'
import { Sidebar } from '@/components/layout/Sidebar'
import { MainPanel } from '@/components/layout/MainPanel'
import { ToastContainer } from '@/components/notification/ToastContainer'
import { SettingsDialog } from '@/components/settings/SettingsDialog'
import { QuickSwitcher } from '@/components/QuickSwitcher'
import { usePanesStore } from '@/stores/panes'
import { useUIStore } from '@/stores/ui'
import { useGroupsStore } from '@/stores/groups'
import { useProjectsStore } from '@/stores/projects'
import { useSessionsStore } from '@/stores/sessions'
import { useActivityMonitor } from '@/hooks/useActivityMonitor'
import { useCallback, useEffect, useRef, useState } from 'react'

export function App(): JSX.Element {
  const [ready, setReady] = useState(false)

  // Load config from file on startup
  useEffect(() => {
    window.api.config.read().then((data) => {
      useGroupsStore.getState()._loadFromConfig(data.groups)
      useProjectsStore.getState()._loadFromConfig(data.projects)
      useSessionsStore.getState()._loadFromConfig(data.sessions)
      useUIStore.getState()._loadSettings(data.ui)

      // Restore pane layout if saved
      if (data.panes && typeof data.panes === 'object') {
        usePanesStore.getState().loadFromConfig(data.panes as Record<string, unknown>)
      }

      // Auto-select the project of the first active session
      const { activeSessionId, sessions } = useSessionsStore.getState()
      if (activeSessionId) {
        const session = sessions.find((s) => s.id === activeSessionId)
        if (session) {
          useProjectsStore.getState().selectProject(session.projectId)
        }
      }

      setReady(true)
    })

  }, [])

  useActivityMonitor()

  // Global keyboard shortcuts — operate on the active pane
  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      const sessStore = useSessionsStore.getState()
      const paneStore = usePanesStore.getState()
      const activePaneId = paneStore.activePaneId
      const paneSessions = paneStore.paneSessions[activePaneId] ?? []
      const activeSessionId = paneStore.paneActiveSession[activePaneId] ?? null
      const activeIdx = paneSessions.indexOf(activeSessionId ?? '')

      // Ctrl+Tab / Ctrl+Shift+Tab — cycle tabs in active pane
      if (e.ctrlKey && e.key === 'Tab') {
        e.preventDefault()
        if (paneSessions.length === 0) return
        const dir = e.shiftKey ? -1 : 1
        const next = (activeIdx + dir + paneSessions.length) % paneSessions.length
        paneStore.setPaneActiveSession(activePaneId, paneSessions[next])
        return
      }

      // Ctrl+Shift+T — restore last closed
      if (e.ctrlKey && e.shiftKey && e.key === 'T') {
        e.preventDefault()
        sessStore.restoreLastClosed()
        // Add restored session to active pane
        const restored = useSessionsStore.getState()
        const newest = restored.sessions[restored.sessions.length - 1]
        if (newest) paneStore.addSessionToPane(activePaneId, newest.id)
        return
      }

      // Ctrl+W — close active tab in active pane
      if (e.ctrlKey && e.key === 'w') {
        e.preventDefault()
        if (activeSessionId) {
          const session = sessStore.sessions.find((s) => s.id === activeSessionId)
          if (session?.pinned) return
          if (session?.ptyId) window.api.session.kill(session.ptyId)
          paneStore.removeSessionFromPane(activePaneId, activeSessionId)
          sessStore.removeSession(activeSessionId)
        }
        return
      }

      // Ctrl+Alt+Arrow — navigate between panes
      if (e.ctrlKey && e.altKey && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
        e.preventDefault()
        const dir = e.key === 'ArrowLeft' ? 'left' : e.key === 'ArrowRight' ? 'right' : e.key === 'ArrowUp' ? 'up' : 'down'
        paneStore.navigatePane(dir)
        return
      }

      // Ctrl+1~9 — jump to Nth tab in active pane
      if (e.ctrlKey && e.key >= '1' && e.key <= '9') {
        e.preventDefault()
        const idx = Number(e.key) - 1
        if (idx < paneSessions.length) {
          paneStore.setPaneActiveSession(activePaneId, paneSessions[idx])
        }
        return
      }
    }

    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  const sidebarWidth = useUIStore((s) => s.sidebarWidth)
  const setSidebarWidth = useUIStore((s) => s.setSidebarWidth)
  const sidebarCollapsed = useUIStore((s) => s.sidebarCollapsed)
  const isDragging = useRef(false)

  const handleMouseDown = useCallback(() => {
    isDragging.current = true
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'

    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging.current) return
      const width = Math.max(200, Math.min(400, e.clientX))
      setSidebarWidth(width)
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
  }, [setSidebarWidth])

  if (!ready) {
    return (
      <div className="flex h-full items-center justify-center bg-[var(--color-bg-primary)]">
        <div className="text-xs text-[var(--color-text-tertiary)]">Loading...</div>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <TitleBar />
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        {!sidebarCollapsed && (
          <>
            <div className="shrink-0" style={{ width: sidebarWidth }}>
              <Sidebar />
            </div>
            {/* Resize handle */}
            <div
              onMouseDown={handleMouseDown}
              className="group relative z-10 w-px shrink-0 cursor-col-resize bg-[var(--color-border)]"
            >
              <div className="absolute inset-y-0 -left-1 -right-1 group-hover:bg-[var(--color-accent)]/20" />
            </div>
          </>
        )}

        {/* Main panel */}
        <div className="flex-1 overflow-hidden">
          <MainPanel />
        </div>
      </div>

      {/* Settings dialog */}
      <SettingsDialog />

      {/* Quick switcher */}
      <QuickSwitcher />

      {/* Toast notifications */}
      <ToastContainer />
    </div>
  )
}
