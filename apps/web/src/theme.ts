/**
 * Theme preference. Three states, matching what the docs site offers: follow
 * the system, or pin light/dark. The choice is per-browser, so it lives in
 * localStorage rather than the database — there is no account to hang it on.
 */
export type ThemeChoice = 'auto' | 'light' | 'dark';

export const THEME_KEY = 'bukmark-theme';

export function readThemeChoice(): ThemeChoice {
  try {
    const stored = localStorage.getItem(THEME_KEY);
    if (stored === 'light' || stored === 'dark' || stored === 'auto') return stored;
  } catch {
    // Private mode can throw on localStorage; fall through to auto.
  }
  return 'auto';
}

/**
 * Resolve to an actual theme and stamp it on <html>. 'auto' clears data-theme
 * rather than resolving it here, so the CSS prefers-color-scheme fallback stays
 * in charge and keeps tracking the system if it changes mid-session.
 */
export function applyThemeChoice(choice: ThemeChoice): void {
  const root = document.documentElement;
  if (choice === 'auto') delete root.dataset.theme;
  else root.dataset.theme = choice;
  try {
    if (choice === 'auto') localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, choice);
  } catch {
    // Preference simply does not persist; the page is still themed.
  }
}
