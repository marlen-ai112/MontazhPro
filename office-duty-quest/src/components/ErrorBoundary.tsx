import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface S { error: Error | null }

export class ErrorBoundary extends Component<{ children: ReactNode }, S> {
  state: S = { error: null };
  static getDerivedStateFromError(error: Error): S { return { error }; }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error('Office Duty Quest crashed', error, info); }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="grid min-h-screen place-items-center p-6">
        <div className="card max-w-md p-8 text-center">
          <AlertTriangle className="mx-auto mb-4 text-warn" size={40} />
          <h1 className="h-display text-xl">Что-то пошло не так</h1>
          <p className="mt-2 text-sm text-slate-400">Данные не потеряны — они хранятся на устройстве. Перезагрузите страницу.</p>
          <p className="mt-3 break-words rounded-lg bg-black/30 p-2 text-xs text-slate-500">{this.state.error.message}</p>
          <button className="btn-primary mt-5" onClick={() => window.location.reload()}><RefreshCw size={16} /> Перезагрузить</button>
        </div>
      </div>
    );
  }
}
