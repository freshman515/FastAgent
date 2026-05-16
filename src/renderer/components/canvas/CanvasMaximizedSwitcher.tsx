import { FolderTree, Minimize2, Star } from 'lucide-react'
import { SESSION_TYPE_CONFIG } from '@shared/types'
import { isCanvasCardHidden, useCanvasStore } from '@/stores/canvas'
import { useSessionsStore } from '@/stores/sessions'
import { FILE_ICONS, useEditorsStore } from '@/stores/editors'
import { formatSessionCardTitle } from '@/lib/canvasSessionLabel'
import { getSessionIcon } from '@/lib/sessionIcon'
import { cn } from '@/lib/utils'
import { SessionIconView } from '@/components/session/SessionIconView'
import { useIsDarkTheme } from '@/hooks/useIsDarkTheme'

export function CanvasMaximizedSwitcher(): JSX.Element | null {
  const cards = useCanvasStore((state) => state.getLayout().cards)
  const maximizedCardId = useCanvasStore((state) => state.maximizedCardId)
  const sessions = useSessionsStore((state) => state.sessions)
  const editors = useEditorsStore((state) => state.tabs)
  const isDarkTheme = useIsDarkTheme()
  if (!maximizedCardId) return null

  const sessionById = new Map(sessions.map((session) => [session.id, session]))
  const editorById = new Map(editors.map((tab) => [tab.id, tab]))
  const items = cards
    .filter((card) => (
      card.kind === 'session'
      || card.kind === 'terminal'
      || card.kind === 'editor'
      || card.kind === 'directory'
    ) && (!isCanvasCardHidden(card) || card.id === maximizedCardId))
    .map((card) => {
      if (card.kind === 'directory') {
        return { card, title: card.directoryTitle?.trim() || '目录', detail: card.directoryPath ?? '目录' }
      }
      if (card.kind === 'editor') {
        const tab = card.refId ? editorById.get(card.refId) : undefined
        return tab ? { card, tab, title: tab.fileName, detail: tab.language } : null
      }
      const session = card.refId ? sessionById.get(card.refId) : undefined
      return session ? { card, session, title: formatSessionCardTitle(session.name, card.sessionRemark), detail: SESSION_TYPE_CONFIG[session.type]?.label ?? session.type } : null
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
    .sort((a, b) => Number(Boolean(b.card.favorite)) - Number(Boolean(a.card.favorite)))

  const setMaximizedCard = useCanvasStore.getState().setMaximizedCard
  const clearMaximizedCard = useCanvasStore.getState().clearMaximizedCard

  return (
    <div className="absolute left-1/2 top-3 z-[100010] flex max-w-[min(820px,calc(100vw-96px))] -translate-x-1/2 items-center gap-1 overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-bg-primary)]/88 p-1 shadow-2xl backdrop-blur">
      <div className="flex min-w-0 gap-1 overflow-x-auto">
        {items.map((item) => {
          const { card, title, detail } = item
          const active = card.id === maximizedCardId
          const session = 'session' in item ? item.session : null
          const tab = 'tab' in item ? item.tab : null
          const directory = card.kind === 'directory'
          const icon = session ? getSessionIcon(session.type, isDarkTheme) : null
          const editorIcon = tab ? (FILE_ICONS[tab.language] ?? FILE_ICONS.plaintext) : null
          return (
            <button
              key={card.id}
              type="button"
              onClick={() => setMaximizedCard(card.id)}
              className={cn(
                'flex h-8 max-w-[180px] shrink-0 items-center gap-2 rounded-[var(--radius-md)] px-2 text-left text-[var(--ui-font-xs)] transition-colors',
                active
                  ? 'bg-[var(--color-accent-muted)] text-[var(--color-text-primary)]'
                  : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)]',
              )}
              title={`${title} · ${detail}`}
            >
              {session ? (
                <SessionIconView icon={session.customSessionIcon} fallbackSrc={icon ?? undefined} className="h-4 w-4" imageClassName="h-4 w-4 object-contain" />
              ) : directory ? (
                <FolderTree size={15} className="shrink-0 text-[var(--color-accent)]" />
              ) : editorIcon ? (
                <span
                  className="inline-flex h-4 min-w-[20px] shrink-0 items-center justify-center rounded px-1 text-[8px] font-bold leading-none"
                  style={{ color: editorIcon.color, backgroundColor: `${editorIcon.color}18` }}
                >
                  {editorIcon.icon}
                </span>
              ) : null}
              {card.favorite && <Star size={10} className="shrink-0 fill-[var(--color-accent)] text-[var(--color-accent)]" />}
              <span className="min-w-0 truncate font-medium">{title}</span>
            </button>
          )
        })}
      </div>
      <div className="mx-0.5 h-5 w-px bg-[var(--color-border)]" />
      <button
        type="button"
        onClick={clearMaximizedCard}
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius-md)] text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)]"
        title="还原"
      >
        <Minimize2 size={15} />
      </button>
    </div>
  )
}
