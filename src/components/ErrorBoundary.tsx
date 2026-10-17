import React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface Props {
  children: React.ReactNode;
}

interface State {
  error: Error | null;
  info: string;
}

/**
 * Catches render-time crashes anywhere in the tree and shows an informative
 * fallback instead of a blank screen.
 */
export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { error: null, info: '' };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: any) {
    // Never log secrets; component stack only.
    console.error('[ErrorBoundary]', error.message, info?.componentStack || '');
    this.setState({ info: String(info?.componentStack || '').slice(0, 800) });
  }

  private reset = () => this.setState({ error: null, info: '' });

  render() {
    const { error, info } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="min-h-screen bg-[#0d0e11] text-white flex items-center justify-center p-6">
        <div className="max-w-lg w-full bg-[#16181d] border border-[#252932] rounded-2xl p-6 shadow-lg">
          <div className="flex items-center gap-3 mb-3">
            <AlertTriangle className="w-6 h-6 text-amber-400" />
            <h2 className="text-lg font-bold">Something went wrong rendering this view</h2>
          </div>
          <p className="text-sm text-[#8c92a4] mb-4">
            Cape Predictor hit an unexpected error while displaying this page. Your data was not
            modified.
          </p>
          <pre className="bg-[#0d0e11] border border-[#252932] rounded-xl p-3 text-[11px] text-rose-300 overflow-auto max-h-40 whitespace-pre-wrap">
            {error.message}
          </pre>
          {info && (
            <details className="mt-3">
              <summary className="text-[11px] text-[#8c92a4] cursor-pointer">Component stack</summary>
              <pre className="mt-2 bg-[#0d0e11] border border-[#252932] rounded-xl p-3 text-[10px] text-[#8c92a4] overflow-auto max-h-32 whitespace-pre-wrap">
                {info}
              </pre>
            </details>
          )}
          <button
            onClick={this.reset}
            className="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
            Try again
          </button>
        </div>
      </div>
    );
  }
}

export default ErrorBoundary;
