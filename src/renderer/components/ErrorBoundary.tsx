import React, { Component, ErrorInfo, ReactNode } from 'react';
import s from './ErrorBoundary.module.css';
import { t } from '../i18n';

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
    <div className={s.root}>
      <div className={s.icon}>⚠️</div>
      <h3 className={s.title}>{t('error.title')}</h3>
      <p className={s.message}>
        {label
          ? t('error.messageWithLabel', { label })
          : t('error.messageGeneric')}
      </p>

      <div className={s.actions}>
        <button
          className={s.btnPrimary}
          onClick={onReset}
        >
          {t('error.retry')}
        </button>
        <button
          className={s.btnSecondary}
          onClick={() => setShowDetails((v) => !v)}
        >
          {showDetails ? t('error.hideDetails') : t('error.showDetails')}
        </button>
      </div>

      {showDetails && (
        <div className={s.details}>
          <p className={s.errorName}>{error.name}: {error.message}</p>
          {error.stack && (
            <pre className={s.stack}>{error.stack}</pre>
          )}
        </div>
      )}
    </div>
  );
}
