import { ArrowLeft, ArrowRight, ExternalLink, Home, RotateCw, ShieldAlert, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { DEFAULT_BROWSER_URL, type Session } from '@shared/types'
import { cn } from '@/lib/utils'
import { useSessionsStore } from '@/stores/sessions'

const BROWSER_PARTITION = 'persist:fastagents-browser'

type BrowserWebviewElement = HTMLElement & {
  canGoBack: () => boolean
  canGoForward: () => boolean
  getURL: () => string
  goBack: () => void
  goForward: () => void
  loadURL: (url: string) => Promise<void>
  reload: () => void
  stop: () => void
}

type WebviewUrlEvent = Event & {
  url?: string
  validatedURL?: string
  errorCode?: number
  errorDescription?: string
  isMainFrame?: boolean
}

interface BrowserSessionViewProps {
  session: Session
  isActive: boolean
}

function isLocalTarget(value: string): boolean {
  return /^localhost(?::\d+)?(?:[/?#]|$)/i.test(value)
    || /^127(?:\.\d{1,3}){3}(?::\d+)?(?:[/?#]|$)/.test(value)
    || /^\[(?:[a-f0-9:]+)\](?::\d+)?(?:[/?#]|$)/i.test(value)
}

function normalizeBrowserTarget(raw: string): string {
  const value = raw.trim()
  if (!value) return DEFAULT_BROWSER_URL
  if (/^[a-z][a-z\d+.-]*:\/\//i.test(value) || value.startsWith('file://')) return value
  if (/^[A-Za-z]:[\\/]/.test(value)) return `file:///${value.replace(/\\/g, '/')}`
  if (isLocalTarget(value)) return `http://${value}`
  if (/^[^\s/]+\.[^\s]+/.test(value)) return `https://${value}`
  return `https://www.google.com/search?q=${encodeURIComponent(value)}`
}

function getCurrentWebviewUrl(webview: BrowserWebviewElement | null): string | null {
  if (!webview) return null
  try {
    return webview.getURL() || null
  } catch {
    return null
  }
}

function isAbortedNavigationError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const detail = error as { errno?: unknown; code?: unknown }
  return detail.errno === -3 || detail.code === 'ERR_ABORTED'
}

export function BrowserSessionView({ session, isActive }: BrowserSessionViewProps): JSX.Element {
  const initialUrl = session.browserUrl ?? DEFAULT_BROWSER_URL
  const webviewRef = useRef<BrowserWebviewElement | null>(null)
  const updateSession = useSessionsStore((state) => state.updateSession)
  const updateStatus = useSessionsStore((state) => state.updateStatus)
  const [webviewSrc, setWebviewSrc] = useState(initialUrl)
  const [currentUrl, setCurrentUrl] = useState(initialUrl)
  const [address, setAddress] = useState(initialUrl)
  const [loading, setLoading] = useState(false)
  const [canGoBack, setCanGoBack] = useState(false)
  const [canGoForward, setCanGoForward] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    const next = session.browserUrl ?? DEFAULT_BROWSER_URL
    setWebviewSrc(next)
    setCurrentUrl(next)
    setAddress(next)
  }, [session.id])

  useEffect(() => {
    updateStatus(session.id, 'idle')
  }, [session.id, updateStatus])

  const syncNavigationState = useCallback(() => {
    const webview = webviewRef.current
    if (!webview) return
    try {
      setCanGoBack(webview.canGoBack())
      setCanGoForward(webview.canGoForward())
    } catch {
      setCanGoBack(false)
      setCanGoForward(false)
    }
  }, [])

  const persistUrl = useCallback((nextUrl: string) => {
    setCurrentUrl(nextUrl)
    setAddress(nextUrl)
    updateSession(session.id, { browserUrl: nextUrl })
  }, [session.id, updateSession])

  const loadInWebview = useCallback((nextUrl: string) => {
    const webview = webviewRef.current
    if (!webview) return
    try {
      void webview.loadURL(nextUrl).catch((error: unknown) => {
        if (!isAbortedNavigationError(error)) {
          console.warn('[browser] navigation failed:', error)
        }
      })
    } catch (error) {
      if (!isAbortedNavigationError(error)) {
        console.warn('[browser] navigation failed:', error)
      }
    }
  }, [])

  useEffect(() => {
    const webview = webviewRef.current
    if (!webview) return

    const handleStart = (): void => {
      setLoading(true)
      setLoadError(null)
      syncNavigationState()
    }
    const handleStop = (): void => {
      setLoading(false)
      syncNavigationState()
    }
    const handleNavigate = (event: Event): void => {
      const nextUrl = (event as WebviewUrlEvent).url ?? getCurrentWebviewUrl(webview)
      if (nextUrl) persistUrl(nextUrl)
      setLoadError(null)
      syncNavigationState()
    }
    const handleFail = (event: Event): void => {
      const detail = event as WebviewUrlEvent
      if (detail.errorCode === -3 || detail.isMainFrame === false) return
      setLoading(false)
      setLoadError(detail.errorDescription ?? '页面加载失败')
      const failedUrl = detail.validatedURL ?? detail.url
      if (failedUrl) setAddress(failedUrl)
      syncNavigationState()
    }
    const handleNewWindow = (event: Event): void => {
      const nextUrl = (event as WebviewUrlEvent).url
      if (!nextUrl) return
      event.preventDefault()
      void window.api.shell.openExternal(nextUrl)
    }

    webview.addEventListener('did-start-loading', handleStart)
    webview.addEventListener('did-stop-loading', handleStop)
    webview.addEventListener('did-navigate', handleNavigate)
    webview.addEventListener('did-navigate-in-page', handleNavigate)
    webview.addEventListener('did-fail-load', handleFail)
    webview.addEventListener('dom-ready', syncNavigationState)
    webview.addEventListener('new-window', handleNewWindow)
    syncNavigationState()

    return () => {
      webview.removeEventListener('did-start-loading', handleStart)
      webview.removeEventListener('did-stop-loading', handleStop)
      webview.removeEventListener('did-navigate', handleNavigate)
      webview.removeEventListener('did-navigate-in-page', handleNavigate)
      webview.removeEventListener('did-fail-load', handleFail)
      webview.removeEventListener('dom-ready', syncNavigationState)
      webview.removeEventListener('new-window', handleNewWindow)
    }
  }, [persistUrl, syncNavigationState])

  const navigateTo = useCallback((target: string) => {
    const nextUrl = normalizeBrowserTarget(target)
    setLoadError(null)
    persistUrl(nextUrl)
    loadInWebview(nextUrl)
  }, [loadInWebview, persistUrl])

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    navigateTo(address)
  }

  const goBack = (): void => {
    try { webviewRef.current?.goBack() } catch { /* ignore */ }
  }

  const goForward = (): void => {
    try { webviewRef.current?.goForward() } catch { /* ignore */ }
  }

  const reloadOrStop = (): void => {
    const webview = webviewRef.current
    if (!webview) return
    try {
      loading ? webview.stop() : webview.reload()
    } catch {
      // ignore
    }
  }

  const openExternal = (): void => {
    const current = getCurrentWebviewUrl(webviewRef.current) ?? currentUrl
    void window.api.shell.openExternal(current)
  }

  return (
    <div className="flex h-full w-full flex-col bg-[var(--color-bg-primary)]">
      <div className="flex h-10 shrink-0 items-center gap-1 border-b border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-2">
        <button
          type="button"
          onClick={goBack}
          disabled={!canGoBack}
          title="后退"
          className={toolbarButtonClass}
        >
          <ArrowLeft size={15} />
        </button>
        <button
          type="button"
          onClick={goForward}
          disabled={!canGoForward}
          title="前进"
          className={toolbarButtonClass}
        >
          <ArrowRight size={15} />
        </button>
        <button
          type="button"
          onClick={reloadOrStop}
          title={loading ? '停止' : '刷新'}
          className={toolbarButtonClass}
        >
          {loading ? <X size={15} /> : <RotateCw size={15} className={cn(loading && 'animate-spin')} />}
        </button>
        <button
          type="button"
          onClick={() => navigateTo(DEFAULT_BROWSER_URL)}
          title="主页"
          className={toolbarButtonClass}
        >
          <Home size={15} />
        </button>
        <form onSubmit={handleSubmit} className="min-w-0 flex-1">
          <input
            value={address}
            onChange={(event) => setAddress(event.target.value)}
            onFocus={(event) => event.currentTarget.select()}
            spellCheck={false}
            className="h-7 w-full min-w-0 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg-primary)] px-3 text-[var(--ui-font-sm)] text-[var(--color-text-primary)] outline-none transition-colors placeholder:text-[var(--color-text-tertiary)] focus:border-[var(--color-accent)]/70"
            placeholder="Search or enter URL"
          />
        </form>
        <button
          type="button"
          onClick={openExternal}
          title="用系统浏览器打开"
          className={toolbarButtonClass}
        >
          <ExternalLink size={15} />
        </button>
      </div>
      {loadError && (
        <div className="flex shrink-0 items-center gap-2 border-b border-[var(--color-border)] bg-[color-mix(in_srgb,var(--color-error)_14%,var(--color-bg-secondary))] px-3 py-1.5 text-[var(--ui-font-xs)] text-[var(--color-error)]">
          <ShieldAlert size={13} />
          <span className="truncate">{loadError}</span>
        </div>
      )}
      <div className={cn('relative min-h-0 flex-1 bg-white', !isActive && 'pointer-events-none')}>
        <webview
          ref={(element) => { webviewRef.current = element as BrowserWebviewElement | null }}
          src={webviewSrc}
          partition={BROWSER_PARTITION}
          webpreferences="contextIsolation=yes,nodeIntegration=no,sandbox=yes"
          className="absolute inset-0 h-full w-full"
        />
      </div>
    </div>
  )
}

const toolbarButtonClass = cn(
  'flex h-7 w-7 shrink-0 items-center justify-center rounded-[var(--radius-sm)]',
  'text-[var(--color-text-secondary)] transition-colors',
  'hover:bg-[var(--color-bg-surface)] hover:text-[var(--color-text-primary)]',
  'disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:bg-transparent disabled:hover:text-[var(--color-text-secondary)]',
)
