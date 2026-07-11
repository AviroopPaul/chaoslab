'use client';

import { useSyncExternalStore } from 'react';
import { Moon, Sun } from 'lucide-react';

import { getTheme, subscribeTheme, toggleTheme } from './theme';

/** Must match the static `data-theme="dark"` RootLayout renders during SSR
 * (before the no-flash inline script runs) — `useSyncExternalStore` uses
 * this during hydration instead of `getSnapshot()`, so the client's first
 * render matches the server's exactly, and only re-renders with the *real*
 * (possibly script-corrected-to-"light") value in a normal post-hydration
 * commit. Without this, a landing-page visitor whose OS/stored preference
 * is "light" would hydrate a mismatched icon (server assumes dark) and
 * trigger a full client-render recovery that clobbers `<html data-theme>`
 * back to the SSR default, undoing the no-flash script's work. */
function getServerSnapshot() {
  return 'dark' as const;
}

/**
 * Sun/moon toggle button, shared by the lab Toolbar and the landing header.
 * Backed by `useSyncExternalStore` (not plain state) precisely because this
 * component *is* server-rendered on the landing page — see
 * `getServerSnapshot` above for why that matters. `subscribeTheme` also
 * keeps the icon in sync if the *other* toggle instance (lab vs. landing)
 * flips the theme in the same tab.
 */
export default function ThemeToggle({ className = '' }: { className?: string }) {
  const theme = useSyncExternalStore(subscribeTheme, getTheme, getServerSnapshot);
  const isDark = theme === 'dark';

  return (
    <button
      type="button"
      onClick={() => toggleTheme()}
      aria-label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
      title={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
      className={`chaos-theme-toggle flex h-8 w-8 shrink-0 items-center justify-center rounded-md border text-muted transition-colors duration-150 hover:text-foreground ${className}`}
      style={{ borderColor: 'var(--panel-border)' }}
    >
      {isDark ? <Sun size={14} /> : <Moon size={14} />}
    </button>
  );
}
