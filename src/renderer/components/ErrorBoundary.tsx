import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[ErrorBoundary]', error, info.componentStack)
  }

  handleReset = (): void => {
    this.setState({ hasError: false, error: null })
  }

  handleClearData = (): void => {
    window.api.config.write('groups', [])
    window.api.config.write('projects', [])
    window.api.config.write('sessions', [])
    window.api.config.write('ui', {})
    window.location.reload()
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div
          style={{
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 16,
            padding: 32,
            backgroundColor: '#1a1a1e',
            color: '#e8e8ec',
            fontFamily: 'system-ui, sans-serif',
          }}
        >
          <h2 style={{ fontSize: 18, fontWeight: 600, color: '#ef5757' }}>Something went wrong</h2>
          <pre
            style={{
              maxWidth: 600,
              padding: 16,
              backgroundColor: '#222226',
              borderRadius: 8,
              fontSize: 12,
              color: '#8e8e96',
              overflow: 'auto',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}
          >
            {this.state.error?.message}
            {'\n\n'}
            {this.state.error?.stack}
          </pre>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={this.handleReset}
              style={{
                padding: '8px 16px',
                backgroundColor: '#2a2a2e',
                color: '#e8e8ec',
                border: '1px solid #333338',
                borderRadius: 6,
                cursor: 'pointer',
                fontSize: 13,
              }}
            >
              Retry
            </button>
            <button
              onClick={this.handleClearData}
              style={{
                padding: '8px 16px',
                backgroundColor: '#7c6aef',
                color: '#ffffff',
                border: 'none',
                borderRadius: 6,
                cursor: 'pointer',
                fontSize: 13,
              }}
            >
              Clear Data & Reload
            </button>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}
