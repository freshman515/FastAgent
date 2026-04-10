import { Minus, Square, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import { useSessionsStore } from '@/stores/sessions'
import { useUIStore } from '@/stores/ui'
import { useXterm } from '@/hooks/useXterm'
import type { Session } from '@shared/types'

function DetachedTerminal({ session }: { session: Session }): JSX.Element {
  const { containerRef } = useXterm(session, true)
  return <div ref={containerRef} className="h-full w-full" />
}

export function DetachedApp(): JSX.Element {
  const sessionIds = useRef(window.api.detach.getSessionIds()).current
  const windowId = useRef(window.api.detach.getWindowId()).current
  const [title] = useState(window.api.detach.getTitle())
  const [maximized, setMaximized] = useState(false)
  const [activeId, setActiveId] = useState(sessionIds[0] ?? null)
  const [ready, setReady] = useState(false)

  // Load UI settings + pull live session data from main process
  useEffect(() => {
    const init = async (): Promise<void> => {
      // Load terminal font settings
      const data = await window.api.config.read()
      useUIStore.getState()._loadSettings(data.ui)

      // Pull live session data (with ptyId + status) stored by main process
      const sessionData = await window.api.detach.getSessions(windowId)
      for (const raw of sessionData) {
        const s = raw as Session
        if (s.id) {
          useSessionsStore.setState((state) => ({
            sessions: [...state.sessions.filter((x) => x.id !== s.id), s],
          }))
        }
      }

      setReady(true)
    }
    init()
  }, [windowId])

  const allSessions = useSessionsStore((s) => s.sessions)
  const sessions = useMemo(
    () => allSessions.filter((s) => sessionIds.includes(s.id)),
    [allSessions, sessionIds],
  )

  const handleMinimize = useCallback(() => window.api.detach.minimize(), [])
  const handleMaximize = useCallback(async () => {
    await window.api.detach.maximize()
    setMaximized((m) => !m)
  }, [])
  const handleClose = useCallback(() => window.api.detach.close(), [])

  const activeSession = sessions.find((s) => s.id === activeId) ?? sessions[0]

  if (!ready || !activeSession) {
    return (
      <div className="flex h-full items-center justify-center bg-[var(--color-bg-primary)]">
        <div className="text-xs text-[var(--color-text-tertiary)]">Loading...</div>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col bg-[var(--color-bg-primary)]">
      {/* Title bar */}
      <div className="drag-region flex h-8 shrink-0 items-center justify-between border-b border-[var(--color-border)] bg-[var(--color-bg-secondary)]">
        <div className="flex items-center gap-2 pl-3">
          <span className="no-drag text-xs font-medium text-[var(--color-text-secondary)]">{title}</span>
        </div>

        {sessions.length > 1 && (
          <div className="no-drag flex items-center gap-1 px-2">
            {sessions.map((s) => (
              <button
                key={s.id}
                onClick={() => setActiveId(s.id)}
                className={cn(
                  'rounded px-2 py-0.5 text-[10px] transition-colors',
                  s.id === activeId
                    ? 'bg-[var(--color-accent-muted)] text-[var(--color-text-primary)]'
                    : 'text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]',
                )}
              >
                {s.name}
              </button>
            ))}
          </div>
        )}

        <div className="no-drag flex h-full">
          <button onClick={handleMinimize} className="flex h-full w-10 items-center justify-center text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-tertiary)] transition-colors">
            <Minus size={14} />
          </button>
          <button onClick={handleMaximize} className="flex h-full w-10 items-center justify-center text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-tertiary)] transition-colors">
            <Square size={maximized ? 10 : 11} />
          </button>
          <button onClick={handleClose} className="flex h-full w-10 items-center justify-center text-[var(--color-text-secondary)] hover:bg-[var(--color-error)] hover:text-white transition-colors">
            <X size={14} />
          </button>
        </div>
      </div>

      {/* Terminal content */}
      <div className="flex-1 overflow-hidden p-2">
        <div className="h-full w-full overflow-hidden rounded-[var(--radius-md)]">
          <DetachedTerminal key={activeSession.id} session={activeSession} />
        </div>
      </div>
    </div>
  )
}
