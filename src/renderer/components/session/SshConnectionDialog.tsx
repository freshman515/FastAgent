import { KeyRound, Server, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  createSshSession,
  DEFAULT_SSH_CONNECTION_DRAFT,
  normalizeSshDestination,
  validateSshConnectionDraft,
  type SshConnectionDraft,
} from '@/lib/sshSession'
import { cn } from '@/lib/utils'
import { useUIStore } from '@/stores/ui'

const FIELD =
  'h-9 w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg-primary)] px-3 text-[var(--ui-font-sm)] text-[var(--color-text-primary)] outline-none transition-colors placeholder:text-[var(--color-text-tertiary)] focus:border-[var(--color-accent)]'

function FieldLabel({ label, children }: { label: string; children: React.ReactNode }): JSX.Element {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[var(--ui-font-2xs)] font-semibold uppercase tracking-[0.14em] text-[var(--color-text-tertiary)]">
        {label}
      </span>
      {children}
    </label>
  )
}

export function SshConnectionDialog(): JSX.Element | null {
  const prompt = useUIStore((s) => s.sshConnectionPrompt)
  const setSshConnectionPrompt = useUIStore((s) => s.setSshConnectionPrompt)
  const addToast = useUIStore((s) => s.addToast)
  const [draft, setDraft] = useState<SshConnectionDraft>(DEFAULT_SSH_CONNECTION_DRAFT)
  const [error, setError] = useState('')
  const hostInputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (!prompt) return
    setDraft(DEFAULT_SSH_CONNECTION_DRAFT)
    setError('')
    requestAnimationFrame(() => hostInputRef.current?.focus())
  }, [prompt])

  const destinationPreview = useMemo(() => {
    if (!draft.host.trim()) return ''
    return normalizeSshDestination(draft.user, draft.host)
  }, [draft.host, draft.user])

  if (!prompt) return null

  const close = (): void => setSshConnectionPrompt(null)
  const handleCancel = (): void => {
    prompt.onCancel()
    close()
  }
  const updateDraft = (key: keyof SshConnectionDraft, value: string): void => {
    setDraft((current) => ({ ...current, [key]: value }))
    if (error) setError('')
  }

  const handleSubmit = (event?: React.FormEvent): void => {
    event?.preventDefault()
    const validationError = validateSshConnectionDraft(draft)
    if (validationError) {
      setError(validationError)
      return
    }

    try {
      const sessionId = createSshSession({
        projectId: prompt.projectId,
        worktreeId: prompt.worktreeId,
        draft,
      })
      prompt.onCreated(sessionId)
      close()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setError(message)
      addToast({
        type: 'error',
        title: 'SSH 连接失败',
        body: message,
      })
    }
  }

  return createPortal(
    <>
      <div
        className="fixed inset-0 z-[9600] bg-black/55 backdrop-blur-[2px] animate-[fade-in_0.12s_ease-out]"
        onClick={handleCancel}
      />
      <form
        onSubmit={handleSubmit}
        className={cn(
          'fixed left-1/2 top-1/2 z-[9601] max-h-[calc(100vh-32px)] w-[min(520px,calc(100vw-28px))] -translate-x-1/2 -translate-y-1/2',
          'overflow-y-auto rounded-[var(--radius-xl)] border border-[var(--color-border)] bg-[var(--color-bg-secondary)] shadow-2xl shadow-black/55',
          'animate-[fade-in_0.12s_ease-out]',
        )}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            handleCancel()
          }
        }}
      >
        <div
          className="pointer-events-none absolute inset-x-0 top-0 h-24 opacity-70"
          style={{
            background: 'radial-gradient(120% 100% at 50% 0%, rgba(34,211,238,0.18) 0%, transparent 62%)',
          }}
        />
        <div className="relative border-b border-[var(--color-border)] px-5 py-4">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--radius-lg)] border border-cyan-300/20 bg-cyan-500/12 text-cyan-200 shadow-[0_0_24px_rgba(34,211,238,0.16)]">
              <Server size={18} strokeWidth={2.3} />
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="text-[var(--ui-font-md)] font-semibold leading-tight text-[var(--color-text-primary)]">
                SSH 连接
              </h3>
              {destinationPreview && (
                <div className="mt-1 truncate font-mono text-[var(--ui-font-xs)] text-[var(--color-text-tertiary)]">
                  ssh {destinationPreview}
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={handleCancel}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius-md)] text-[var(--color-text-tertiary)] transition-colors hover:bg-[var(--color-bg-tertiary)] hover:text-[var(--color-text-primary)]"
              title="关闭"
              aria-label="关闭"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        <div className="relative grid gap-4 px-5 py-4">
          <FieldLabel label="主机">
            <input
              ref={hostInputRef}
              value={draft.host}
              onChange={(event) => updateDraft('host', event.target.value)}
              placeholder="example.com"
              className={FIELD}
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
            />
          </FieldLabel>

          <div className="grid grid-cols-[minmax(0,1fr)_112px] gap-3">
            <FieldLabel label="用户名">
              <input
                value={draft.user}
                onChange={(event) => updateDraft('user', event.target.value)}
                placeholder="root"
                className={FIELD}
                spellCheck={false}
                autoCapitalize="off"
                autoCorrect="off"
              />
            </FieldLabel>
            <FieldLabel label="端口">
              <input
                value={draft.port}
                onChange={(event) => updateDraft('port', event.target.value)}
                placeholder="22"
                inputMode="numeric"
                className={FIELD}
                spellCheck={false}
              />
            </FieldLabel>
          </div>

          <FieldLabel label="身份密钥">
            <div className="relative">
              <KeyRound
                size={14}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-tertiary)]"
              />
              <input
                value={draft.identityFile}
                onChange={(event) => updateDraft('identityFile', event.target.value)}
                placeholder="~/.ssh/id_ed25519"
                className={cn(FIELD, 'pl-9')}
                spellCheck={false}
                autoCapitalize="off"
                autoCorrect="off"
              />
            </div>
          </FieldLabel>

          <FieldLabel label="额外参数">
            <input
              value={draft.extraArgs}
              onChange={(event) => updateDraft('extraArgs', event.target.value)}
              placeholder="-L 3000:localhost:3000"
              className={FIELD}
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
            />
          </FieldLabel>

          <FieldLabel label="会话名称">
            <input
              value={draft.name}
              onChange={(event) => updateDraft('name', event.target.value)}
              placeholder={destinationPreview ? `SSH ${destinationPreview}` : 'SSH'}
              className={FIELD}
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
            />
          </FieldLabel>

          {error && (
            <div className="rounded-[var(--radius-md)] border border-[var(--color-error)]/35 bg-[var(--color-error)]/10 px-3 py-2 text-[var(--ui-font-sm)] text-[var(--color-error)]">
              {error}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-[var(--color-border)] px-5 py-3">
          <button
            type="button"
            onClick={handleCancel}
            className="h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] px-4 text-[var(--ui-font-sm)] text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-bg-tertiary)] hover:text-[var(--color-text-primary)]"
          >
            取消
          </button>
          <button
            type="submit"
            className="inline-flex h-9 items-center gap-2 rounded-[var(--radius-md)] bg-[var(--color-accent)] px-4 text-[var(--ui-font-sm)] font-medium text-white shadow-md shadow-[var(--color-accent)]/25 transition-colors hover:bg-[var(--color-accent-hover)]"
          >
            <Server size={14} />
            连接
          </button>
        </div>
      </form>
    </>,
    document.body,
  )
}
