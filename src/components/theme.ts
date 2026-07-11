/**
 * Shared theme primitives (SPEC.md light/dark theming task). A single source
 * of truth for reading/writing the `data-theme` attribute on `<html>`, kept
 * dependency-free (no React) so both the interactive `ThemeToggle` button and
 * the imperative Three.js hero (`HeroScene.tsx`, which can't read CSS custom
 * properties directly) can subscribe to theme changes without either one
 * importing the other.
 *
 * The inline no-flash script in `layout.tsx`'s `<head>` sets the same
 * `data-theme` attribute (and the same `localStorage` key) *before* React
 * ever runs — this module just mirrors that logic for client-side reads/
 * writes/subscriptions after hydration.
 */

export type Theme = 'dark' | 'light';

export const THEME_STORAGE_KEY = 'chaoslab.theme';
export const THEME_ATTRIBUTE = 'data-theme';

function isTheme(value: string | null): value is Theme {
  return value === 'dark' || value === 'light';
}

/** Current theme, read straight from the DOM (already set pre-paint by the inline script). */
export function getTheme(): Theme {
  if (typeof document === 'undefined') return 'dark';
  const attr = document.documentElement.getAttribute(THEME_ATTRIBUTE);
  return isTheme(attr) ? attr : 'dark';
}

/** Sets the theme on `<html>` and persists it so the no-flash script picks it up next load. */
export function setTheme(theme: Theme): void {
  if (typeof document === 'undefined') return;
  document.documentElement.setAttribute(THEME_ATTRIBUTE, theme);
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Storage can throw in private-browsing/quota-exceeded edge cases —
    // theming still works for the session, it just won't persist.
  }
}

export function toggleTheme(): Theme {
  const next: Theme = getTheme() === 'dark' ? 'light' : 'dark';
  setTheme(next);
  return next;
}

/**
 * Notifies `callback` whenever `data-theme` changes on `<html>` — covers
 * both same-tab toggles (Toolbar and landing header buttons both flip the
 * same attribute) and, incidentally, any future cross-component writers.
 * Returns an unsubscribe function.
 */
export function subscribeTheme(callback: () => void): () => void {
  if (typeof document === 'undefined') return () => {};
  const observer = new MutationObserver((mutations) => {
    if (mutations.some((m) => m.attributeName === THEME_ATTRIBUTE)) callback();
  });
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: [THEME_ATTRIBUTE],
  });
  return () => observer.disconnect();
}
