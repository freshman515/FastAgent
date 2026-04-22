import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Sparkles } from 'lucide-react'
import { cn } from '@/lib/utils'
import { getSessionIcon } from '@/lib/sessionIcon'
import { useIsDarkTheme } from '@/hooks/useIsDarkTheme'
import { useUIStore } from '@/stores/ui'

export function SessionNamePromptDialog(): JSX.Element | null {
  const prompt = useUIStore((s) => s.sessionNamePrompt)
  const setSessionNamePrompt = useUIStore((s) => s.setSessionNamePrompt)
  const isDark = useIsDarkTheme()
  const [value, setValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (prompt) {
      setValue('')
      requestAnimationFrame(() => inputRef.current?.focus())
    }
  }, [prompt])

  if (!prompt) return null

  const close = (): void => setSessionNamePrompt(null)

  const handleSubmit = (): void => {
    const trimmed = value.trim()
    const finalName = trimmed.length > 0 ? trimmed : prompt.defaultName
    prompt.onSubmit(finalName)
    close()
  }

  const handleUseDefault = (): void => {
    prompt.onUseDefault()
    close()
  }

  const handleCancel = (): void => {
    prompt.onCancel()
    close()
  }

  return createPortal(
    <>
      {/* Backdrop with blur */}
      <div
        className="fixed inset-0 z-[300] bg-black/50 backdrop-blur-[2px] animate-[fade-in_0.12s_ease-out]"
        onClick={handleCancel}
      />
      <div
        className={cn(
          'fixed left-1/2 top-1/2 z-[301] w-[420px] -translate-x-1/2 -translate-y-1/2',
          'overflow-hidden rounded-[var(--radius-xl)]',
          'border border-[var(--color-border)]',
          'bg-[var(--color-bg-secondary)]',
          'shadow-2xl shadow-black/50',
          'animate-[fade-in_0.12s_ease-out]',
        )}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            handleSubmit()
          } else if (e.key === 'Escape') {
            e.preventDefault()
            handleCancel()
          }
        }}
      >
        {/* Accent glow header */}
        <div
          className="pointer-events-none absolute inset-x-0 top-0 h-24 opacity-80"
          style={{
            background: 'radial-gradient(120% 100% at 50% 0%, var(--color-accent-muted) 0%, transparent 60%)',
          }}
        />

        <div className="relative px-6 pt-6 pb-5">
          {/* Header: icon + title + desc */}
          <div className="mb-5 flex items-start gap-3.5">
            {prompt.sessionType && (
              <div
                className={cn(
                  'relative flex h-11 w-11 shrink-0 items-center justify-center',
                  'rounded-[var(--radius-lg)] bg-[var(--color-bg-tertiary)]',
                  'ring-1 ring-[var(--color-border)]',
                )}
              >
                <img
                  src={getSessionIcon(prompt.sessionType, isDark)}
                  alt=""
                  className="h-7 w-7"
                  draggable={false}
                />
                <span
                  className="pointer-events-none absolute inset-0 rounded-[var(--radius-lg)]"
                  style={{ boxShadow: '0 0 24px var(--color-accent-muted)' }}
                />
              </div>
            )}
            <div className="min-w-0 flex-1 pt-0.5">
              <h3 className="text-[var(--ui-font-md)] font-semibold tracking-tight text-[var(--color-text-primary)] leading-tight">
                {prompt.title ?? '命名新会话'}
              </h3>
              <p className="mt-1 text-[var(--ui-font-sm)] leading-relaxed text-[var(--color-text-secondary)]">
                {prompt.description ?? '为新会话输入一个名称，留空将使用默认名称。'}
              </p>
            </div>
          </div>

          {/* Input */}
          <label className="mb-4 block">
            <span className="mb-1.5 block text-[var(--ui-font-2xs)] font-semibold uppercase tracking-[0.14em] text-[var(--color-text-tertiary)]">
              会话名称
            </span>
            <div
              className={cn(
                'group relative flex items-center rounded-[var(--radius-md)]',
                'border border-[var(--color-border)] bg-[var(--color-bg-primary)]',
                'transition-all duration-100',
                'focus-within:border-[var(--color-accent)]/70',
                'focus-within:shadow-[0_0_0_3px_var(--color-accent-muted)]',
              )}
            >
              <input
                ref={inputRef}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder={prompt.defaultName}
                spellCheck={false}
                className={cn(
                  'h-10 min-w-0 flex-1 bg-transparent px-3 text-[var(--ui-font-sm)] text-[var(--color-text-primary)]',
                  'placeholder:text-[var(--color-text-tertiary)]',
                  'outline-none',
                )}
              />
              {value.length > 0 && (
                <button
                  type="button"
                  onClick={() => setValue('')}
                  className={cn(
                    'mr-1 flex h-5 w-5 items-center justify-center rounded-[var(--radius-sm)]',
                    'text-[var(--color-text-tertiary)] hover:bg-[var(--color-bg-tertiary)] hover:text-[var(--color-text-primary)]',
                    'transition-colors',
                  )}
                  title="清空"
                >
                  <span className="text-[12px] leading-none">×</span>
                </button>
              )}
            </div>
          </label>

          {/* Footer */}
          <div className="mt-4 flex items-center justify-between gap-2">
            <button
              onClick={handleUseDefault}
              className={cn(
                'flex items-center gap-1.5 rounded-[var(--radius-md)] px-2.5 py-1.5',
                'text-[var(--ui-font-sm)] text-[var(--color-text-tertiary)]',
                'hover:bg-[var(--color-bg-tertiary)] hover:text-[var(--color-text-primary)] transition-colors',
              )}
            >
              <Sparkles size={13} />
              使用默认名称
            </button>
            <div className="flex items-center gap-2">
              <span className="hidden text-[10px] text-[var(--color-text-tertiary)] sm:inline">
                <kbd className="rounded border border-[var(--color-border)] bg-[var(--color-bg-primary)] px-1 font-mono">Esc</kbd>
                <span className="mx-1">·</span>
                <kbd className="rounded border border-[var(--color-border)] bg-[var(--color-bg-primary)] px-1 font-mono">Enter</kbd>
              </span>
              <button
                onClick={handleCancel}
                className={cn(
                  'rounded-[var(--radius-md)] border border-[var(--color-border)] px-4 py-1.5',
                  'text-[var(--ui-font-sm)] text-[var(--color-text-secondary)]',
                  'hover:bg-[var(--color-bg-tertiary)] hover:text-[var(--color-text-primary)] transition-colors',
                )}
              >
                取消
              </button>
              <button
                onClick={handleSubmit}
                autoFocus
                className={cn(
                  'rounded-[var(--radius-md)] px-4 py-1.5 text-[var(--ui-font-sm)] font-medium',
                  'bg-[var(--color-accent)] text-white shadow-md shadow-[var(--color-accent)]/25',
                  'hover:bg-[var(--color-accent-hover)] hover:shadow-[var(--color-accent)]/35',
                  'transition-all duration-100',
                )}
              >
                创建会话
              </button>
            </div>
          </div>
        </div>
      </div>
    </>,
    document.body,
  )
}
