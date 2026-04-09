import { Minus, Square, X, Zap } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { cn } from '@/lib/utils'

export function TitleBar(): JSX.Element | null {
  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    window.api.window.isMaximized().then(setMaximized)
  }, [])

  const handleMinimize = useCallback(() => window.api.window.minimize(), [])
  const handleMaximize = useCallback(async () => {
    await window.api.window.maximize()
    setMaximized(await window.api.window.isMaximized())
  }, [])
  const handleClose = useCallback(() => window.api.window.close(), [])

  // Only show custom titlebar on Windows/Linux
  if (window.api.platform === 'darwin') return null

  return (
    <div className="titlebar-fixed drag-region flex h-8 shrink-0 items-center justify-between border-b border-[var(--color-border)] bg-[var(--color-bg-secondary)]">
      {/* Left: App logo + name */}
      <div className="flex items-center gap-1.5 pl-3">
        <Zap size={14} className="text-[var(--color-accent)]" />
        <span className="text-xs font-medium text-[var(--color-text-secondary)]">FastAgents</span>
      </div>

      {/* Right: Window controls */}
      <div className="no-drag flex h-full">
        <button
          onClick={handleMinimize}
          className={cn(
            'flex h-full w-11 items-center justify-center',
            'text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-tertiary)]',
            'transition-colors duration-100',
          )}
        >
          <Minus size={14} />
        </button>
        <button
          onClick={handleMaximize}
          className={cn(
            'flex h-full w-11 items-center justify-center',
            'text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-tertiary)]',
            'transition-colors duration-100',
          )}
        >
          <Square size={11} />
        </button>
        <button
          onClick={handleClose}
          className={cn(
            'flex h-full w-11 items-center justify-center',
            'text-[var(--color-text-secondary)] hover:bg-[var(--color-error)] hover:text-white',
            'transition-colors duration-100',
          )}
        >
          <X size={14} />
        </button>
      </div>
    </div>
  )
}
