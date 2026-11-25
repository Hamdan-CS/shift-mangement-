import { lazy, type ComponentType } from 'react';

/**
 * Pages are loaded on first visit. After a new version goes live, a phone that
 * still runs the old version asks for page files that no longer exist, and the
 * page never appears (blank screen until a refresh). When that happens we
 * reload once to pick up the new version; if it still fails, the error goes to
 * the PageErrorBoundary, which shows a "Reload" card instead of nothing.
 */
const KEY = 'shiftclock-reloaded-for-update';

/** Reload the app once per minute at most (so a real outage can't loop). */
export function reloadForUpdate(): boolean {
  try {
    const last = Number(sessionStorage.getItem(KEY) || 0);
    if (Date.now() - last < 60_000) return false;
    sessionStorage.setItem(KEY, String(Date.now()));
  } catch { /* storage blocked: still try once */ }
  window.location.reload();
  return true;
}

/** Is this the "file of an older version is gone" error? */
export function isChunkError(e: unknown): boolean {
  const msg = e instanceof Error ? `${e.name} ${e.message}` : String(e);
  return /dynamically imported module|Importing a module script failed|error loading dynamically imported|ChunkLoadError|Failed to fetch/i.test(msg);
}

// same signature as React.lazy
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function lazyPage<T extends ComponentType<any>>(load: () => Promise<{ default: T }>) {
  return lazy(async () => {
    try {
      return await load();
    } catch (e) {
      // one quick retry (flaky signal), then reload for the new version
      try { return await load(); } catch { /* fall through */ }
      if (isChunkError(e) && reloadForUpdate()) return new Promise<never>(() => {});
      throw e;
    }
  });
}
