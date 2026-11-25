import { Component, type ReactNode } from 'react';
import { RefreshCw } from 'lucide-react';
import { isChunkError } from '@/utils/lazyPage';

/**
 * Catches a page that fails to load or crashes, so the user sees a short
 * message with Reload instead of an empty screen. Reset by changing `resetKey`
 * (the page path), so going to another page tries again.
 */
export class PageErrorBoundary extends Component<{ resetKey: string; children: ReactNode }, { error: unknown }> {
  state = { error: null as unknown };

  static getDerivedStateFromError(error: unknown) { return { error }; }

  componentDidUpdate(prev: { resetKey: string }) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }

  componentDidCatch(error: unknown) {
    console.error('Page failed:', error);
  }

  render() {
    if (!this.state.error) return this.props.children;
    const update = isChunkError(this.state.error);
    return (
      <div className="grid min-h-[50dvh] place-items-center px-4">
        <div className="sc-card max-w-[420px] text-center" role="alert">
          <span className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-full bg-accent-soft text-accent"><RefreshCw size={22} /></span>
          <h2 className="m-0 text-[19px] font-semibold">{update ? 'A new version is ready' : "This page didn't load"}</h2>
          <p className="mx-auto mb-4 mt-2 text-[14px] text-ink-2">{update ? 'Reload to get the latest ShiftClock.' : 'Check your connection and try again.'}</p>
          <div className="flex flex-wrap justify-center gap-2">
            <button type="button" className="sc-btn sc-btn-primary" onClick={() => window.location.reload()}><RefreshCw size={16} /> Reload</button>
            <button type="button" className="sc-btn sc-btn-secondary" onClick={() => { window.location.href = '/'; }}>Go home</button>
          </div>
        </div>
      </div>
    );
  }
}
