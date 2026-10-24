// Shows what went wrong (and a Reload button) instead of an empty page when a screen fails to load or render.
import { Component, Suspense } from 'react'

class ErrorBoundary extends Component {
  state = { error: null }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    console.error('Screen crashed:', error, info.componentStack)
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children

    return (
      <div role="alert">
        <p className="error">Something went wrong on this screen: {error.message}</p>
        <pre className="error-details">{String(error.stack ?? '').split('\n').slice(0, 8).join('\n')}</pre>
        <button type="button" onClick={() => window.location.reload()}>Reload</button>
      </div>
    )
  }
}

// For a lazily loaded screen: "Loading…" while its code downloads, the error above if it crashes.
export function ScreenBoundary({ children }) {
  return (
    <ErrorBoundary>
      <Suspense fallback={<p className="muted">Loading…</p>}>{children}</Suspense>
    </ErrorBoundary>
  )
}

export default ErrorBoundary
