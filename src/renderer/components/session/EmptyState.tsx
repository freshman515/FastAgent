import { Zap } from 'lucide-react'

interface EmptyStateProps {
  title: string
  description: string
}

export function EmptyState({ title, description }: EmptyStateProps): JSX.Element {
  return (
    <div className="flex flex-col items-center gap-4 px-8 text-center">
      <div className="relative flex h-14 w-14 items-center justify-center rounded-2xl bg-[linear-gradient(135deg,var(--color-bg-tertiary),color-mix(in_srgb,var(--color-accent)_8%,var(--color-bg-tertiary)))] border border-[var(--color-border)]/50 shadow-lg shadow-black/10">
        <Zap size={22} className="text-[var(--color-accent)]/60" />
        <div className="absolute -inset-px rounded-2xl bg-[var(--color-accent)]/[0.03]" />
      </div>
      <div className="flex flex-col gap-1.5">
        <h3 className="text-[var(--ui-font-md)] font-semibold text-[var(--color-text-primary)]">{title}</h3>
        <p className="max-w-[260px] text-[var(--ui-font-sm)] leading-relaxed text-[var(--color-text-tertiary)]">{description}</p>
      </div>
    </div>
  )
}
