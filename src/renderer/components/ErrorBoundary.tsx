import React, { Component, ErrorInfo, ReactNode } from 'react';

// ─── Types ───

interface ErrorBoundaryProps {
  /** Component(s) to render inside the boundary */
  children: ReactNode;
  /** Optional fallback UI — receives error + reset callback */
  fallback?: (error: Error, reset: () => void) => ReactNode;
  /** Label for logging/debugging — identifies which boundary caught the error */
  label?: string;
  /** Called when an error is caught (e.g. for telemetry) */
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
}

interface ErrorBoundaryState {
  error: Error | null;
}

// ─── ErrorBoundary ───

/**
 * React Error Boundary — catches render errors in child component tree.
 *
 * Usage:
 * ```tsx
 * <ErrorBoundary label="ChatPanel">
 *   <ChatPanel />
 * </ErrorBoundary>
 * ```
 *
 * With custom fallback:
 * ```tsx
 * <ErrorBoundary fallback={(err, reset) => <MyFallback error={err} onRetry={reset} />}>
 *   <SomeComponent />
 * </ErrorBoundary>
 * ```
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    const label = this.props.label || 'Unknown';
    console.error(`[ErrorBoundary:${label}] Caught error:`, error, errorInfo);
    this.props.onError?.(error, errorInfo);
  }

  private handleReset = (): void => {
    this.setState({ error: null });
  };

  render(): ReactNode {
    const { error } = this.state;
    const { children, fallback, label } = this.props;

    if (error) {
      // Custom fallback
      if (fallback) {
        return fallback(error, this.handleReset);
      }

      // Default fallback UI
      return <DefaultErrorFallback error={error} label={label} onReset={this.handleReset} />;
    }

    return children;
  }
}

// ─── Default Fallback UI ───

interface DefaultErrorFallbackProps {
  error: Error;
  label?: string;
  onReset: () => void;
}

function DefaultErrorFallback({ error, label, onReset }: DefaultErrorFallbackProps) {
  const [showDetails, setShowDetails] = React.useState(false);

  return (
    <div className="error-boundary">
      <div className="error-boundary__icon">⚠️</div>
      <h3 className="error-boundary__title">Coś poszło nie tak</h3>
      <p className="error-boundary__message">
        {label
          ? `Wystąpił błąd w komponencie ${label}.`
          : 'Wystąpił nieoczekiwany błąd.'}
      </p>

      <div className="error-boundary__actions">
        <button
          className="error-boundary__btn error-boundary__btn--primary"
          onClick={onReset}
        >
          Spróbuj ponownie
        </button>
        <button
          className="error-boundary__btn error-boundary__btn--secondary"
          onClick={() => setShowDetails((v) => !v)}
        >
          {showDetails ? 'Ukryj szczegóły' : 'Pokaż szczegóły'}
        </button>
      </div>

      {showDetails && (
        <div className="error-boundary__details">
          <p className="error-boundary__error-name">{error.name}: {error.message}</p>
          {error.stack && (
            <pre className="error-boundary__stack">{error.stack}</pre>
          )}
        </div>
      )}
    </div>
  );
}
