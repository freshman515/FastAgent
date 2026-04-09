import { useSessionsStore } from '@/stores/sessions'
import { TerminalView } from './TerminalView'

export function TerminalContainer(): JSX.Element {
  const sessions = useSessionsStore((s) => s.sessions)
  const activeSessionId = useSessionsStore((s) => s.activeSessionId)
  const splitSessionId = useSessionsStore((s) => s.splitSessionId)
  const splitDirection = useSessionsStore((s) => s.splitDirection)

  const hasSplit = splitSessionId && splitSessionId !== activeSessionId
    && sessions.some((s) => s.id === splitSessionId)

  return (
    <>
      {sessions.map((session) => {
        const isActive = session.id === activeSessionId
        const isSplit = hasSplit && session.id === splitSessionId
        const isVisible = isActive || isSplit

        // Determine position: if split, active goes left/top, split goes right/bottom
        let style: React.CSSProperties
        if (hasSplit && isActive) {
          style = splitDirection === 'horizontal'
            ? { left: 0, top: 0, width: 'calc(50% - 0.5px)', height: '100%' }
            : { left: 0, top: 0, width: '100%', height: 'calc(50% - 0.5px)' }
        } else if (isSplit) {
          style = splitDirection === 'horizontal'
            ? { right: 0, top: 0, width: 'calc(50% - 0.5px)', height: '100%' }
            : { left: 0, bottom: 0, width: '100%', height: 'calc(50% - 0.5px)' }
        } else {
          style = { inset: 0 }
        }

        return (
          <div
            key={session.id}
            className="absolute"
            style={{
              ...style,
              visibility: isVisible ? 'visible' : 'hidden',
              zIndex: isVisible ? 1 : 0,
              pointerEvents: isVisible ? 'auto' : 'none',
            }}
          >
            <TerminalView session={session} isActive={isVisible} />
          </div>
        )
      })}

      {/* Split divider */}
      {hasSplit && (
        <div
          className="absolute bg-[var(--color-border)]"
          style={
            splitDirection === 'horizontal'
              ? { left: '50%', top: 0, width: 1, height: '100%', transform: 'translateX(-50%)', zIndex: 2 }
              : { left: 0, top: '50%', width: '100%', height: 1, transform: 'translateY(-50%)', zIndex: 2 }
          }
        />
      )}
    </>
  )
}
