import { Download, RefreshCw, RotateCcw, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import type { UpdaterEvent } from '@shared/types'
import { cn } from '@/lib/utils'

type UpdaterState =
  | { kind: 'hidden' }
  | { kind: 'available'; version: string; notes: string | null }
  | { kind: 'downloading'; version: string; percent: number; speed: number; transferred: number; total: number }
  | { kind: 'downloaded'; version: string }
  | { kind: 'error'; message: string; version: string | null }

function formatSpeed(bytesPerSec: number): string {
  if (bytesPerSec <= 0) return '—'
  const mb = bytesPerSec / (1024 * 1024)
  if (mb >= 1) return `${mb.toFixed(1)} MB/s`
  const kb = bytesPerSec / 1024
  return `${kb.toFixed(0)} KB/s`
}

function formatSize(bytes: number): string {
  const mb = bytes / (1024 * 1024)
  if (mb >= 100) return `${mb.toFixed(0)} MB`
  if (mb >= 1) return `${mb.toFixed(1)} MB`
  return `${(bytes / 1024).toFixed(0)} KB`
}

export function UpdateDialog(): JSX.Element | null {
  const [state, setState] = useState<UpdaterState>({ kind: 'hidden' })

  useEffect(() => {
    const unsubscribe = window.api.updater.onEvent((event: UpdaterEvent) => {
      switch (event.type) {
        case 'available':
          setState({ kind: 'available', version: event.version, notes: event.releaseNotes })
          break
        case 'progress':
          setState((prev) => {
            const fallbackVersion = prev.kind === 'downloading' || prev.kind === 'available' || prev.kind === 'downloaded'
              ? prev.version
              : '?'
            return {
              kind: 'downloading',
              version: fallbackVersion,
              percent: event.percent,
              speed: event.bytesPerSecond,
              transferred: event.transferred,
              total: event.total,
            }
          })
          break
        case 'downloaded':
          setState({ kind: 'downloaded', version: event.version })
          break
        case 'error':
          setState((prev) => ({
            kind: 'error',
            message: event.error,
            version: prev.kind === 'available' || prev.kind === 'downloading' || prev.kind === 'downloaded' ? prev.version : null,
          }))
          break
        case 'checking':
        case 'not-available':
          // Keep hidden — we only surface the dialog for actionable states.
          break
      }
    })
    return unsubscribe
  }, [])

  if (state.kind === 'hidden') return null

  const dismiss = (): void => setState({ kind: 'hidden' })

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="w-full max-w-md rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-bg-secondary)] shadow-2xl shadow-black/50">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[var(--color-border)]/60 px-4 py-3">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--color-accent-muted)] text-[var(--color-accent)]">
              <RefreshCw size={14} />
            </div>
            <div>
              <div className="text-[var(--ui-font-sm)] font-semibold text-[var(--color-text-primary)]">
                {state.kind === 'available' && '发现新版本'}
                {state.kind === 'downloading' && '正在下载新版本'}
                {state.kind === 'downloaded' && '更新已下载完成'}
                {state.kind === 'error' && '更新失败'}
              </div>
              {state.kind !== 'error' && (
                <div className="text-[10px] text-[var(--color-text-tertiary)]">v{state.version}</div>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={dismiss}
            className="flex h-6 w-6 items-center justify-center rounded-[var(--radius-sm)] text-[var(--color-text-tertiary)] hover:bg-[var(--color-bg-tertiary)] hover:text-[var(--color-text-primary)]"
            title="关闭"
          >
            <X size={14} />
          </button>
        </div>

        {/* Body */}
        <div className="px-4 py-4">
          {state.kind === 'available' && (
            <>
              <p className="text-[var(--ui-font-sm)] text-[var(--color-text-secondary)]">
                FastAgents 有新版本可用，是否立即下载并升级？
              </p>
              {state.notes && (
                <div className="mt-3 max-h-40 overflow-y-auto rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-bg-primary)] px-3 py-2 text-[11px] leading-5 text-[var(--color-text-secondary)] whitespace-pre-wrap">
                  {state.notes}
                </div>
              )}
            </>
          )}

          {state.kind === 'downloading' && (
            <>
              <div className="h-2 w-full overflow-hidden rounded-full bg-[var(--color-bg-primary)]">
                <div
                  className="h-full rounded-full bg-[var(--color-accent)] transition-all"
                  style={{ width: `${Math.max(2, state.percent)}%` }}
                />
              </div>
              <div className="mt-2 flex items-center justify-between text-[11px] text-[var(--color-text-tertiary)] tabular-nums">
                <span>{state.percent}%</span>
                <span>
                  {formatSize(state.transferred)} / {formatSize(state.total)} · {formatSpeed(state.speed)}
                </span>
              </div>
            </>
          )}

          {state.kind === 'downloaded' && (
            <p className="text-[var(--ui-font-sm)] text-[var(--color-text-secondary)]">
              新版本已下载完成。点击"立即安装"后会自动关闭当前应用、运行安装程序，并在完成后重新启动。
            </p>
          )}

          {state.kind === 'error' && (
            <div className="rounded-[var(--radius-sm)] border border-[var(--color-error)]/40 bg-[var(--color-error)]/10 px-3 py-2 text-[11px] text-[var(--color-error)]">
              {state.message}
            </div>
          )}
        </div>

        {/* Footer buttons */}
        <div className="flex items-center justify-end gap-2 border-t border-[var(--color-border)]/60 px-4 py-3">
          {state.kind === 'available' && (
            <>
              <button
                type="button"
                onClick={dismiss}
                className="h-8 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-bg-primary)] px-3 text-[11px] text-[var(--color-text-secondary)] hover:border-[var(--color-border-hover)] hover:text-[var(--color-text-primary)]"
              >
                稍后
              </button>
              <button
                type="button"
                onClick={() => void window.api.updater.download()}
                className="flex h-8 items-center gap-1.5 rounded-[var(--radius-sm)] bg-[var(--color-accent)] px-3 text-[11px] font-medium text-white hover:opacity-90"
              >
                <Download size={12} /> 立即下载更新
              </button>
            </>
          )}

          {state.kind === 'downloading' && (
            <button
              type="button"
              onClick={dismiss}
              className="h-8 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-bg-primary)] px-3 text-[11px] text-[var(--color-text-secondary)] hover:border-[var(--color-border-hover)]"
            >
              后台下载
            </button>
          )}

          {state.kind === 'downloaded' && (
            <>
              <button
                type="button"
                onClick={dismiss}
                className="h-8 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-bg-primary)] px-3 text-[11px] text-[var(--color-text-secondary)] hover:border-[var(--color-border-hover)]"
              >
                下次启动再安装
              </button>
              <button
                type="button"
                onClick={() => void window.api.updater.install()}
                className="flex h-8 items-center gap-1.5 rounded-[var(--radius-sm)] bg-[var(--color-accent)] px-3 text-[11px] font-medium text-white hover:opacity-90"
              >
                <RotateCcw size={12} /> 立即安装并重启
              </button>
            </>
          )}

          {state.kind === 'error' && (
            <>
              <button
                type="button"
                onClick={dismiss}
                className="h-8 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-bg-primary)] px-3 text-[11px] text-[var(--color-text-secondary)] hover:border-[var(--color-border-hover)]"
              >
                关闭
              </button>
              <button
                type="button"
                onClick={() => void window.api.updater.check()}
                className={cn(
                  'flex h-8 items-center gap-1.5 rounded-[var(--radius-sm)]',
                  'bg-[var(--color-accent)] px-3 text-[11px] font-medium text-white hover:opacity-90',
                )}
              >
                <RefreshCw size={12} /> 重试
              </button>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}
