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

/**
 * Accent colour. The logo keeps the bukmark orange; this recolours the
 * interface's accent (links, focus, selection, buttons) in this browser only.
 * Presets read at least as well as the orange on both papers; a custom colour
 * is allowed and warned about when it would be hard to read.
 */
export const ACCENT_KEY = 'bukmark-accent';
export const BRAND_ACCENT = '#fd441d';

export const ACCENTS: [string, string][] = [
  [BRAND_ACCENT, 'Orange'],
  ['#3a6df0', 'Blue'],
  ['#0f9488', 'Teal'],
  ['#3c9a3c', 'Green'],
  ['#8b5cf6', 'Violet'],
  ['#e23d7a', 'Pink'],
];

const HEX = /^#[0-9a-f]{6}$/i;

export function readAccent(): string {
  try {
    const stored = localStorage.getItem(ACCENT_KEY);
    if (stored && HEX.test(stored)) return stored.toLowerCase();
  } catch {
    // No storage: the brand accent.
  }
  return BRAND_ACCENT;
}

/** Set the accent on <html> and remember it; the brand accent clears both. */
export function applyAccent(hex: string): void {
  const root = document.documentElement;
  const colour = HEX.test(hex) ? hex.toLowerCase() : BRAND_ACCENT;
  const brand = colour === BRAND_ACCENT;
  if (brand) {
    root.style.removeProperty('--bk-accent');
    delete root.dataset.accent;
  } else {
    root.style.setProperty('--bk-accent', colour);
    root.dataset.accent = 'custom';
  }
  try {
    if (brand) localStorage.removeItem(ACCENT_KEY);
    else localStorage.setItem(ACCENT_KEY, colour);
  } catch {
    // Not remembered; still applied for this visit.
  }
}

/** WCAG contrast ratio between two #rrggbb colours. */
export function contrast(a: string, b: string): number {
  const lum = (hex: string) => {
    const [r, g, bl] = [1, 3, 5].map((i) => {
      const c = parseInt(hex.slice(i, i + 2), 16) / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * bl!;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

/** The two papers, as sRGB: light cream and the dark theme's near-black. */
export const PAPERS = { light: '#fbf7f3', dark: '#191412' } as const;

/** Below this on either paper, accent text and buttons get hard to read. */
export const MIN_ACCENT_CONTRAST = 3;
