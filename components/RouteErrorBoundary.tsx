import React from 'react';

type RouteErrorBoundaryProps = {
  children: React.ReactNode;
  title?: string;
  subtitle?: string;
};

type RouteErrorBoundaryState = {
  hasError: boolean;
  message: string;
};

export class RouteErrorBoundary extends React.Component<RouteErrorBoundaryProps, RouteErrorBoundaryState> {
  state: RouteErrorBoundaryState = {
    hasError: false,
    message: '',
  };

  static getDerivedStateFromError(error: unknown): RouteErrorBoundaryState {
    return {
      hasError: true,
      message: error instanceof Error ? error.message : String(error || 'unknown_error'),
    };
  }

  componentDidCatch(error: unknown) {
    // Preserve signal in console for debugging route-specific crashes.
    console.error('[RouteErrorBoundary]', error);
  }

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }
    return (
      <div className="rounded-2xl border border-rose-200 bg-rose-50 p-5 text-sm text-rose-900">
        <div className="font-semibold">
          {this.props.title || 'Page render failed'}
        </div>
        <div className="mt-1 text-xs text-rose-800">
          {this.props.subtitle || 'An unexpected UI error occurred. Refresh this page and try again.'}
        </div>
        <div className="mt-3 rounded border border-rose-200 bg-white px-3 py-2 font-mono text-[11px] text-rose-700">
          {this.state.message || 'unknown_error'}
        </div>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="mt-3 inline-flex items-center rounded-md border border-rose-300 bg-white px-3 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-100"
        >
          Reload Page
        </button>
      </div>
    );
  }
}

export default RouteErrorBoundary;
