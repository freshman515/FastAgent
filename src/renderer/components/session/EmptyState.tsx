import { Zap } from 'lucide-react'

interface EmptyStateProps {
  title: string
  description: string
}

export function EmptyState({ title, description }: EmptyStateProps): JSX.Element {
  return (
    <div className="flex flex-col items-center gap-3 px-8 text-center">
      <div className="flex h-10 w-10 items-center justify-center rounded-[var(--radius-lg)] bg-[var(--color-bg-tertiary)]">
        <Zap size={18} className="text-[var(--color-text-tertiary)]" />
      </div>
      <div className="flex flex-col gap-1">
        <h3 className="text-[var(--ui-font-md)] font-medium text-[var(--color-text-secondary)]">{title}</h3>
        <p className="max-w-[240px] text-[var(--ui-font-sm)] text-[var(--color-text-tertiary)]">{description}</p>
      </div>
    </div>
  )
}
