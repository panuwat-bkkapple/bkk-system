// Catch render errors anywhere in the tree and show the actual message
// instead of a blank white screen. Without this, an uncaught error in a
// nested component (e.g. a non-array used with .map()) takes down the
// whole subtree silently — invisible to the user and to us.
//
// Stays even after the current incident: any future runtime error gets
// the same treatment, so the next time something crashes we see what.

import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
  info: ErrorInfo | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, info: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary] Caught render error:', error, info);
    this.setState({ info });
  }

  handleReset = () => {
    this.setState({ error: null, info: null });
  };

  render() {
    const { error, info } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="min-h-screen bg-red-50 p-4 flex items-center justify-center">
        <div className="max-w-2xl w-full bg-white rounded-2xl border-2 border-red-200 shadow-lg p-6 space-y-4">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-red-100 flex items-center justify-center shrink-0">
              <span className="text-2xl">⚠️</span>
            </div>
            <div className="flex-1 min-w-0">
              <h1 className="font-bold text-red-700">เกิดข้อผิดพลาดในการแสดงผล</h1>
              <p className="text-xs text-red-600 mt-1">
                ส่งภาพหน้านี้ให้ Claude ที่กำลังแก้ปัญหา — ข้อความ error ด้านล่างจะช่วยระบุจุด crash ได้เร็วขึ้น
              </p>
            </div>
          </div>

          <div className="bg-red-50 border border-red-200 rounded-xl p-3">
            <p className="text-[11px] font-bold text-red-500 uppercase tracking-wider mb-1">Error</p>
            <p className="text-sm font-mono text-red-900 break-words">{error.message}</p>
          </div>

          {error.stack && (
            <details className="bg-slate-50 border border-slate-200 rounded-xl p-3">
              <summary className="text-[11px] font-bold text-slate-500 uppercase tracking-wider cursor-pointer">Stack trace</summary>
              <pre className="text-[10px] font-mono text-slate-700 mt-2 overflow-x-auto whitespace-pre-wrap">{error.stack}</pre>
            </details>
          )}

          {info?.componentStack && (
            <details className="bg-slate-50 border border-slate-200 rounded-xl p-3">
              <summary className="text-[11px] font-bold text-slate-500 uppercase tracking-wider cursor-pointer">Component stack</summary>
              <pre className="text-[10px] font-mono text-slate-700 mt-2 overflow-x-auto whitespace-pre-wrap">{info.componentStack}</pre>
            </details>
          )}

          <div className="flex gap-2 pt-2">
            <button
              onClick={this.handleReset}
              className="flex-1 bg-slate-900 text-white py-3 rounded-xl font-bold text-sm active:scale-95 transition"
            >
              ลองใหม่
            </button>
            <button
              onClick={() => window.location.assign('/mobile')}
              className="flex-1 bg-slate-100 text-slate-700 py-3 rounded-xl font-bold text-sm active:scale-95 transition"
            >
              กลับหน้าหลัก
            </button>
          </div>
        </div>
      </div>
    );
  }
}
