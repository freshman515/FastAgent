import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

const MENU_MARGIN = 8

export function getCanvasMenuPosition(x: number, y: number, width = 180, height = 220): { left: number; top: number } {
  return {
    left: Math.max(MENU_MARGIN, Math.min(x, window.innerWidth - width - MENU_MARGIN)),
    top: Math.max(MENU_MARGIN, Math.min(y, window.innerHeight - height - MENU_MARGIN)),
  }
}

export function CanvasMenuPanel({
  children,
  x,
  y,
  width = 180,
  height = 220,
  className,
}: {
  children: ReactNode
  x: number
  y: number
  width?: number
  height?: number
  className?: string
}): JSX.Element {
  const position = getCanvasMenuPosition(x, y, width, height)
  return (
    <div
      className={cn(
        'fixed z-[9500] overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-bg-primary)]/96 p-1 shadow-2xl backdrop-blur',
        'animate-in fade-in zoom-in-95 duration-100',
        className,
      )}
      style={{ left: position.left, top: position.top, width }}
      onPointerDown={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.preventDefault()}
    >
      {children}
    </div>
  )
}

export function CanvasMenuItem({
  label,
  onClick,
  danger = false,
  disabled = false,
  shortcut,
}: {
  label: string
  onClick: () => void
  danger?: boolean
  disabled?: boolean
  shortcut?: string
}): JSX.Element {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'group relative flex h-8 w-full items-center gap-3 rounded-[var(--radius-md)] px-3 text-left text-[var(--ui-font-sm)] transition-colors',
        danger
          ? 'text-[var(--color-error)] hover:bg-[color-mix(in_srgb,var(--color-error)_18%,transparent)]'
          : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-accent-muted)] hover:text-[var(--color-text-primary)]',
        disabled && 'cursor-not-allowed opacity-45 hover:bg-transparent hover:text-[var(--color-text-secondary)]',
      )}
    >
      {!danger && (
        <span className="absolute left-0 top-2 bottom-2 w-0.5 scale-y-50 rounded-full bg-[var(--color-accent)] opacity-0 transition-all group-hover:scale-y-100 group-hover:opacity-100" />
      )}
      <span className="min-w-0 flex-1 truncate font-medium">{label}</span>
      {shortcut && (
        <span className="shrink-0 text-[10px] font-semibold text-[var(--color-text-tertiary)] opacity-65">
          {shortcut}
        </span>
      )}
    </button>
  )
}

export function CanvasMenuSeparator(): JSX.Element {
  return <div className="my-1 h-px bg-[var(--color-border)]" />
}
