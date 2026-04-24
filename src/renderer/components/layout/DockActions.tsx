import { createContext, useContext, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

// ─── DockActions slot ──────────────────────────────────────────────────
// Each DockPanel exposes a DOM node on the right side of its header strip.
// Child panels render action buttons into that node via <DockActions> so the
// DockPanel's "{icon} {label}" row becomes a full toolbar and panels don't
// need their own duplicate header row.

export const DockActionsContext = createContext<HTMLElement | null>(null)

/** Render children into the active DockPanel's header action slot. Returns
 *  null (renders nothing) when no slot is available — for example when the
 *  panel appears outside a DockPanel. */
export function DockActions({ children }: { children: ReactNode }): JSX.Element | null {
  const target = useContext(DockActionsContext)
  if (!target) return null
  return createPortal(children, target)
}
