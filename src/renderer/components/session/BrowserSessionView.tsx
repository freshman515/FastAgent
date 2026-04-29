import { ArrowLeft, ArrowRight, Camera, Check, Clipboard, ExternalLink, FileText, Home, LoaderCircle, RotateCw, Send, ShieldAlert, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { DEFAULT_BROWSER_URL, type Session } from '@shared/types'
import { cn } from '@/lib/utils'
import { useSessionsStore } from '@/stores/sessions'
import { useUIStore } from '@/stores/ui'

const BROWSER_PARTITION = 'persist:fastagents-browser'
const BROWSER_CONTEXT_TEXT_LIMIT = 12000
const BROWSER_CONTEXT_HEADING_LIMIT = 24
const BROWSER_CONTEXT_LINK_LIMIT = 24
const WEBVIEW_NAVIGATION_PROTOCOLS = new Set(['http:', 'https:', 'file:', 'about:', 'data:', 'blob:'])
const EXTERNAL_OPEN_PROTOCOLS = new Set(['http:', 'https:'])

type BrowserWebviewElement = HTMLElement & {
  canGoBack: () => boolean
  canGoForward: () => boolean
  capturePage: () => Promise<{ toDataURL: () => string }>
  executeJavaScript: <T = unknown>(code: string, userGesture?: boolean) => Promise<T>
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

interface BrowserPageContext {
  url: string
  title: string
  description: string
  headings: string[]
  links: Array<{ text: string; href: string }>
  text: string
  screenshotPath?: string
  capturedAt: number
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

function getUrlProtocol(raw: string): string | null {
  try {
    return new URL(raw).protocol.toLowerCase()
  } catch {
    return null
  }
}

function isAllowedWebviewNavigation(raw: string): boolean {
  const protocol = getUrlProtocol(raw)
  return protocol !== null && WEBVIEW_NAVIGATION_PROTOCOLS.has(protocol)
}

function isExternalOpenTarget(raw: string): boolean {
  const protocol = getUrlProtocol(raw)
  return protocol !== null && EXTERNAL_OPEN_PROTOCOLS.has(protocol)
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

function isBrowserContextTarget(session: Session, sourceSession: Session): boolean {
  if (session.id === sourceSession.id || session.projectId !== sourceSession.projectId || !session.ptyId) return false
  if (session.type === 'browser' || session.type === 'claude-gui') return false
  if (session.type === 'terminal' || session.type === 'terminal-wsl') return Boolean(session.customSessionCommand)
  return true
}

function trimContextText(value: unknown, limit: number): string {
  if (typeof value !== 'string') return ''
  const normalized = value
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim()
  return normalized.length > limit
    ? `${normalized.slice(0, limit)}\n\n[truncated ${normalized.length - limit} chars]`
    : normalized
}

function normalizePageContext(raw: unknown, fallbackUrl: string): BrowserPageContext {
  const obj = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {}
  const headings = Array.isArray(obj.headings)
    ? obj.headings
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, BROWSER_CONTEXT_HEADING_LIMIT)
    : []
  const links = Array.isArray(obj.links)
    ? obj.links.flatMap((item) => {
      if (!item || typeof item !== 'object') return []
      const link = item as { text?: unknown; href?: unknown }
      if (typeof link.href !== 'string' || !link.href.trim()) return []
      return [{
        text: trimContextText(link.text, 120) || link.href,
        href: link.href,
      }]
    }).slice(0, BROWSER_CONTEXT_LINK_LIMIT)
    : []

  return {
    url: typeof obj.url === 'string' && obj.url ? obj.url : fallbackUrl,
    title: trimContextText(obj.title, 200) || 'Untitled page',
    description: trimContextText(obj.description, 500),
    headings,
    links,
    text: trimContextText(obj.text, BROWSER_CONTEXT_TEXT_LIMIT),
    capturedAt: Date.now(),
  }
}

function browserContextScript(): string {
  return `
(() => {
  const textOf = (node) => (node?.textContent || '').replace(/\\s+/g, ' ').trim()
  const description = Array.from(document.querySelectorAll('meta[name="description"], meta[property="og:description"]'))
    .map((node) => node.getAttribute('content') || '')
    .find((value) => value.trim()) || ''
  const headings = Array.from(document.querySelectorAll('h1,h2,h3'))
    .map((node) => {
      const text = textOf(node)
      return text ? node.tagName.toLowerCase() + ': ' + text : ''
    })
    .filter(Boolean)
    .slice(0, ${BROWSER_CONTEXT_HEADING_LIMIT})
  const links = Array.from(document.querySelectorAll('a[href]'))
    .map((node) => ({ text: textOf(node), href: node.href }))
    .filter((item) => item.href)
    .slice(0, ${BROWSER_CONTEXT_LINK_LIMIT})
  const text = (document.body?.innerText || '')
    .replace(/\\r/g, '')
    .replace(/[ \\t]+\\n/g, '\\n')
    .replace(/\\n{4,}/g, '\\n\\n\\n')
    .trim()
  return {
    url: location.href,
    title: document.title || '',
    description,
    headings,
    links,
    text: text.slice(0, ${BROWSER_CONTEXT_TEXT_LIMIT + 2000}),
  }
})()
`
}

function formatBrowserContextPrompt(context: BrowserPageContext): string {
  const headings = context.headings.length > 0
    ? context.headings.map((heading) => `- ${heading}`).join('\n')
    : '- [none]'
  const links = context.links.length > 0
    ? context.links.map((link) => `- ${link.text}: ${link.href}`).join('\n')
    : '- [none]'

  return [
    '请基于下面的浏览器页面上下文继续工作。',
    '',
    `URL: ${context.url}`,
    `Title: ${context.title}`,
    context.description ? `Description: ${context.description}` : '',
    context.screenshotPath ? `Screenshot file: ${context.screenshotPath}` : '',
    '',
    '## Headings',
    headings,
    '',
    '## Links',
    links,
    '',
    '## Page text',
    context.text || '[empty]',
  ].filter((part) => part !== '').join('\n')
}

export function BrowserSessionView({ session, isActive }: BrowserSessionViewProps): JSX.Element {
  const initialUrl = session.browserUrl ?? DEFAULT_BROWSER_URL
  const webviewRef = useRef<BrowserWebviewElement | null>(null)
  const sessions = useSessionsStore((state) => state.sessions)
  const updateSession = useSessionsStore((state) => state.updateSession)
  const updateStatus = useSessionsStore((state) => state.updateStatus)
  const addToast = useUIStore((state) => state.addToast)
  const [webviewSrc, setWebviewSrc] = useState(initialUrl)
  const [currentUrl, setCurrentUrl] = useState(initialUrl)
  const [address, setAddress] = useState(initialUrl)
  const [loading, setLoading] = useState(false)
  const [canGoBack, setCanGoBack] = useState(false)
  const [canGoForward, setCanGoForward] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [contextPanelOpen, setContextPanelOpen] = useState(false)
  const [pageContext, setPageContext] = useState<BrowserPageContext | null>(null)
  const [contextLoading, setContextLoading] = useState(false)
  const [contextError, setContextError] = useState<string | null>(null)
  const [targetSessionId, setTargetSessionId] = useState<string>('')
  const [copied, setCopied] = useState(false)

  const targetSessions = useMemo(
    () => sessions.filter((item) => isBrowserContextTarget(item, session)),
    [session, sessions],
  )
  const targetSession = targetSessions.find((item) => item.id === targetSessionId) ?? targetSessions[0] ?? null

  useEffect(() => {
    if (targetSessionId && targetSessions.some((item) => item.id === targetSessionId)) return
    setTargetSessionId(targetSessions[0]?.id ?? '')
  }, [targetSessionId, targetSessions])

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
    const handleWillNavigate = (event: Event): void => {
      const nextUrl = (event as WebviewUrlEvent).url
      if (!nextUrl || isAllowedWebviewNavigation(nextUrl)) return
      event.preventDefault()
      setLoading(false)
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
      if (!isExternalOpenTarget(nextUrl)) return
      void window.api.shell.openExternal(nextUrl)
    }

    webview.addEventListener('did-start-loading', handleStart)
    webview.addEventListener('did-stop-loading', handleStop)
    webview.addEventListener('will-navigate', handleWillNavigate)
    webview.addEventListener('will-frame-navigate', handleWillNavigate)
    webview.addEventListener('did-navigate', handleNavigate)
    webview.addEventListener('did-navigate-in-page', handleNavigate)
    webview.addEventListener('did-fail-load', handleFail)
    webview.addEventListener('dom-ready', syncNavigationState)
    webview.addEventListener('new-window', handleNewWindow)
    syncNavigationState()

    return () => {
      webview.removeEventListener('did-start-loading', handleStart)
      webview.removeEventListener('did-stop-loading', handleStop)
      webview.removeEventListener('will-navigate', handleWillNavigate)
      webview.removeEventListener('will-frame-navigate', handleWillNavigate)
      webview.removeEventListener('did-navigate', handleNavigate)
      webview.removeEventListener('did-navigate-in-page', handleNavigate)
      webview.removeEventListener('did-fail-load', handleFail)
      webview.removeEventListener('dom-ready', syncNavigationState)
      webview.removeEventListener('new-window', handleNewWindow)
    }
  }, [persistUrl, syncNavigationState])

  const navigateTo = useCallback((target: string) => {
    const nextUrl = normalizeBrowserTarget(target)
    if (!isAllowedWebviewNavigation(nextUrl)) {
      setLoadError('已阻止打开外部应用链接')
      setAddress(nextUrl)
      return
    }
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

  const collectPageContext = useCallback(async (): Promise<BrowserPageContext | null> => {
    const webview = webviewRef.current
    if (!webview) return null

    setContextLoading(true)
    setContextError(null)
    setContextPanelOpen(true)
    try {
      const fallbackUrl = getCurrentWebviewUrl(webview) ?? currentUrl
      const rawContext = await webview.executeJavaScript(browserContextScript(), false)
      const nextContext = normalizePageContext(rawContext, fallbackUrl)
      try {
        const image = await webview.capturePage()
        const dataUrl = image.toDataURL()
        if (dataUrl.startsWith('data:image/')) {
          nextContext.screenshotPath = await window.api.fs.writeTempDataUrl(
            `browser-${nextContext.title || 'page'}`,
            dataUrl,
            dataUrl.startsWith('data:image/jpeg') ? 'jpg' : 'png',
          )
        }
      } catch (error) {
        console.warn('[browser] screenshot capture failed:', error)
      }
      setPageContext(nextContext)
      return nextContext
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setContextError(message)
      addToast({ type: 'error', title: '页面上下文提取失败', body: message })
      return null
    } finally {
      setContextLoading(false)
    }
  }, [addToast, currentUrl])

  const copyPageContext = useCallback(async () => {
    const context = pageContext ?? await collectPageContext()
    if (!context) return
    await navigator.clipboard.writeText(formatBrowserContextPrompt(context))
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1200)
  }, [collectPageContext, pageContext])

  const sendPageContext = useCallback(async () => {
    const context = pageContext ?? await collectPageContext()
    const target = targetSession
    if (!context || !target?.ptyId) {
      addToast({ type: 'warning', title: '没有可用 Agent', body: '请先启动同项目下的 Agent 会话。' })
      return
    }
    await window.api.session.submit(target.ptyId, formatBrowserContextPrompt(context), true)
    addToast({ type: 'success', title: '已发送浏览器上下文', body: target.name, sessionId: target.id, projectId: target.projectId })
  }, [addToast, collectPageContext, pageContext, targetSession])

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
        <div className="mx-1 h-5 w-px bg-[var(--color-border)]" />
        <button
          type="button"
          onClick={() => { void collectPageContext() }}
          title="提取页面上下文"
          className={toolbarButtonClass}
          disabled={contextLoading}
        >
          {contextLoading ? <LoaderCircle size={15} className="animate-spin" /> : <FileText size={15} />}
        </button>
        <button
          type="button"
          onClick={() => { void sendPageContext() }}
          title="发送页面上下文给 Agent"
          className={toolbarButtonClass}
          disabled={contextLoading || targetSessions.length === 0}
        >
          <Send size={15} />
        </button>
        <button
          type="button"
          onClick={() => { void collectPageContext() }}
          title="截图并提取上下文"
          className={toolbarButtonClass}
          disabled={contextLoading}
        >
          <Camera size={15} />
        </button>
      </div>
      {loadError && (
        <div className="flex shrink-0 items-center gap-2 border-b border-[var(--color-border)] bg-[color-mix(in_srgb,var(--color-error)_14%,var(--color-bg-secondary))] px-3 py-1.5 text-[var(--ui-font-xs)] text-[var(--color-error)]">
          <ShieldAlert size={13} />
          <span className="truncate">{loadError}</span>
        </div>
      )}
      {contextPanelOpen && (
        <div className="flex max-h-56 shrink-0 flex-col gap-2 border-b border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-3 py-2">
          <div className="flex items-center gap-2">
            <FileText size={14} className="text-[var(--color-accent)]" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[var(--ui-font-sm)] font-semibold text-[var(--color-text-primary)]">
                {pageContext?.title ?? '浏览器上下文'}
              </div>
              <div className="truncate text-[var(--ui-font-xs)] text-[var(--color-text-tertiary)]">
                {pageContext?.url ?? currentUrl}
              </div>
            </div>
            <select
              value={targetSession?.id ?? ''}
              onChange={(event) => setTargetSessionId(event.target.value)}
              className="h-7 max-w-52 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-bg-primary)] px-2 text-[var(--ui-font-xs)] text-[var(--color-text-primary)] outline-none"
              disabled={targetSessions.length === 0}
            >
              {targetSessions.length === 0
                ? <option value="">无运行中的 Agent</option>
                : targetSessions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
            <button type="button" onClick={copyPageContext} className={toolbarButtonClass} title="复制上下文">
              {copied ? <Check size={15} /> : <Clipboard size={15} />}
            </button>
            <button type="button" onClick={() => { void sendPageContext() }} className={toolbarButtonClass} title="发送给 Agent" disabled={targetSessions.length === 0}>
              <Send size={15} />
            </button>
            <button type="button" onClick={() => setContextPanelOpen(false)} className={toolbarButtonClass} title="关闭">
              <X size={15} />
            </button>
          </div>
          {contextError ? (
            <div className="text-[var(--ui-font-xs)] text-[var(--color-error)]">{contextError}</div>
          ) : (
            <div className="min-h-0 overflow-y-auto whitespace-pre-wrap rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-bg-primary)] p-2 text-[11px] leading-5 text-[var(--color-text-secondary)]">
              {pageContext
                ? [
                    pageContext.description,
                    pageContext.screenshotPath ? `Screenshot: ${pageContext.screenshotPath}` : '',
                    pageContext.headings.slice(0, 8).join('\n'),
                    pageContext.text.slice(0, 1800),
                  ].filter(Boolean).join('\n\n')
                : contextLoading ? '正在提取页面正文、DOM 摘要和截图...' : '尚未提取。'}
            </div>
          )}
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
