/**
 * Discord Embedded App (Activities) environment detection.
 *
 * When Cape Predictor is opened from the Discord in-app launcher the URL
 * carries `iframe=true` and a `theme` parameter, and the app is rendered inside
 * a sandboxed frame. We adapt a few things so the dashboard feels native
 * there:
 *
 *  - the dark theme is forced (Discord's embedded frame has no chrome),
 *  - `100dvh` height is used so the app fills the frame without outer scroll,
 *  - a compact layout flag lets components drop non-essential chrome.
 *
 * NOTE: actually booting inside Discord additionally requires the app's
 * Activities URL to be configured in the Discord Developer Portal. The helpers
 * here only adapt the page once it *is* being framed.
 */

const IFRAME_PARAMS = ['iframe', 'frame', 'embedded'];

/** True when the page is running inside a frame. */
export function isEmbedded(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    if (window.self !== window.top) return true;
  } catch {
    // Cross-origin access to window.top throws -> we are definitely framed.
    return true;
  }
  return new URLSearchParams(window.location.search).has('iframe');
}

/** True when Discord explicitly requested embedded mode via query params. */
export function hasEmbeddedQuery(): boolean {
  if (typeof window === 'undefined') return false;
  const params = new URLSearchParams(window.location.search);
  return IFRAME_PARAMS.some((p) => params.get(p) === 'true' || params.has(p));
}

/** True when the app should render in its embedded/compact form. */
export function isEmbeddedApp(): boolean {
  return hasEmbeddedQuery() || isEmbedded();
}

/** Discord passes its theme as a query param when the activity supports it. */
export function embeddedTheme(): 'dark' | 'light' | null {
  if (typeof window === 'undefined') return null;
  const theme = new URLSearchParams(window.location.search).get('theme');
  return theme === 'light' ? 'light' : theme === 'dark' ? 'dark' : null;
}

/**
 * Apply embedded-mode classes to <html>. Called once at boot so CSS can react
 * to `.discord-embedded` without every component branching on the environment.
 */
export function applyEmbeddedMode(): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  if (isEmbeddedApp()) {
    root.classList.add('discord-embedded');
    root.classList.add('discord-embedded-dark');
  }
  const theme = embeddedTheme();
  if (theme) {
    root.classList.toggle('discord-embedded-light', theme === 'light');
    root.classList.toggle('discord-embedded-dark', theme === 'dark');
  }
}

export default {
  isEmbedded,
  hasEmbeddedQuery,
  isEmbeddedApp,
  embeddedTheme,
  applyEmbeddedMode,
};