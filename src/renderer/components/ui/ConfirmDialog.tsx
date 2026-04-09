import { createPortal } from 'react-dom'
import { cn } from '@/lib/utils'

interface ConfirmDialogProps {
  title: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmDialog({
  title, message, confirmLabel = 'Confirm', cancelLabel = 'Cancel', danger, onConfirm, onCancel,
}: ConfirmDialogProps): JSX.Element {
  return createPortal(
    <>
      <div className="fixed inset-0 z-[300] bg-black/40" onClick={onCancel} />
      <div
        className={cn(
          'fixed left-1/2 top-1/2 z-[301] w-[340px] -translate-x-1/2 -translate-y-1/2',
          'rounded-[var(--radius-xl)] border border-[var(--color-border)]',
          'bg-[var(--color-bg-secondary)] shadow-2xl shadow-black/40 p-5',
          'animate-[fade-in_0.1s_ease-out]',
        )}
      >
        <h3 className="text-[var(--ui-font-md)] font-semibold text-[var(--color-text-primary)] mb-2">{title}</h3>
        <p className="text-[var(--ui-font-sm)] text-[var(--color-text-secondary)] mb-5">{message}</p>
        <div className="flex justify-end gap-2">
          <button
            onClick={onCancel}
            className={cn(
              'rounded-[var(--radius-md)] border border-[var(--color-border)] px-4 py-1.5',
              'text-[var(--ui-font-sm)] text-[var(--color-text-secondary)]',
              'hover:bg-[var(--color-bg-tertiary)] transition-colors',
            )}
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            autoFocus
            className={cn(
              'rounded-[var(--radius-md)] px-4 py-1.5 text-[var(--ui-font-sm)] font-medium transition-colors',
              danger
                ? 'bg-[var(--color-error)] text-white hover:brightness-110'
                : 'bg-[var(--color-accent)] text-white hover:bg-[var(--color-accent-hover)]',
            )}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </>,
    document.body,
  )
}
