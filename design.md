# Design — bukmark

Locked design system. Future Hallmark runs read this file first; pages defer
to it. Amend intentionally — the file is the rule.

## System
- Genre · editorial (brutalist-product voice)
- Macrostructure · Manifesto×Workbench hybrid (site landing); app UI follows tokens + voice, not the macrostructure
- Theme · custom (vibe: "warm brutalist, logo-anchored, deliberate")
- Axes · warm paper / heavy grotesque display / warm orange accent
- Modes · light and dark. The palette inverts; the accent does not move.

## Tokens (canonical · `apps/site/src/styles/custom.css` is the source of truth)
```css
:root {
  /* Exact pixel samples from the logo artwork — never drift these three. */
  --bk-paper: #fbf7f3;
  --bk-ink: #0e0f13;
  --bk-accent: #fd441d;

  --bk-paper-2: oklch(93% 0.012 40);
  --bk-rule: oklch(82% 0.008 40);
  --bk-neutral: oklch(56% 0.008 40);
  --bk-muted: oklch(40% 0.008 40);

  --bk-font-display: 'Bricolage Grotesque', sans-serif; /* headings, buttons, nav */
  --bk-font-body: 'Geist', system-ui, sans-serif;
  --bk-font-mono: 'Menlo', 'Courier New', monospace;    /* code, dense metadata */

  /* 4-pt spacing scale: --bk-space-2xs 0.25rem … --bk-space-3xl 6rem. */
  /* Type scale: --bk-text-xs 0.75rem … --bk-text-2xl 2.25rem + display clamp. */

  --bk-ease-out: cubic-bezier(0.16, 1, 0.3, 1);
  --bk-dur-micro: 100ms;  --bk-dur-short: 160ms;  --bk-dur-long: 300ms;

  /* Radius: 0 — hard corners everywhere. Brutalist bones. */
}
```

### Dark mode

Six tokens move and nothing else does. `--bk-ink` means "the high-contrast
foreground", so every `2px solid var(--bk-ink)` structural border keeps its
weight on dark paper without a component stylesheet changing. `--bk-muted` and
`--bk-neutral` swap direction for the same reason: muted stays the more
prominent of the two in both modes.

```css
:root[data-theme='dark'] {
  --bk-paper: oklch(16% 0.008 40);
  --bk-paper-2: oklch(22% 0.010 40);
  --bk-rule: oklch(34% 0.008 40);
  --bk-neutral: oklch(68% 0.008 40);
  --bk-muted: oklch(82% 0.008 40);
  --bk-ink: oklch(94% 0.006 40);
}
```

`--bk-accent` is deliberately absent: #fd441d is pinned to the logo and
measures 5.57:1 on the dark paper, so it carries links, focus rings and small
highlights in both modes unchanged.

Rules that follow from this:

- A foreground colour paired with a coloured fill uses `var(--bk-paper)`, never
  `white`. `--danger` lightens in dark mode, where white on it measures 2.88:1.
- Both surfaces honour an explicit choice and fall back to the system:
  `:root[data-theme='dark']` plus a `prefers-color-scheme` block guarded on
  `:not([data-theme='light'])`. The choice is stored per browser — the site
  under Starlight's `starlight-theme` key, the app under `bukmark-theme` — and
  stamped on `<html>` before first paint so there is no flash.
- The logo mark is a transparent PNG. It sits on both papers; anything with a
  baked-in background reads as a bright tile on dark.

## Component voice
- Borders are structural: 2px solid ink for primary separations (nav, section
  breaks, active states), 1px rule for quiet containment. No shadows, no
  gradients, no rounded corners. Scrollbar thumbs are the sole shadow
  exception: a hard, zero-blur inset ink edge may sharpen the accent thumb;
  tracks remain transparent.
- Primary action · solid ink block, paper text, uppercase display font,
  hover → accent fill + 2px lift. Secondary · 2px ink outline, transparent.
- Logo mark (`logo-mark.svg`, drawn with every favicon and icon from one
  geometry by `pnpm --filter @bukmark/web icons`) sits left in any header,
  lowercase `bukmark` wordmark beside it in display 800.
- Accent is scarce: hovers, active nav item, links, focus rings, small
  highlights. Never large fills except CTA hover.

## Composition guardrails
- Signature comes from scale, proportion, whitespace, and border geometry —
  never decorative kickers, numbered section labels, stamps, pill-tags, or
  ornamental micro-metadata.
- Functional metadata stays only where it helps a task. Hub assignments may
  use quiet rectangular tags; aggregate counts use a typographic ledger, not
  pills.
- Marketing display headings use a wide measure and stay within two or three
  lines on desktop. Primary controls and useful labels remain comfortably
  readable rather than shrinking to manufacture hierarchy.
- Dense rows are content-driven with a stable minimum height. Responsive
  layouts may recompose, but preserve every control, avoid page-level
  horizontal scrolling, and keep action labels on one line.
- Section identity and section-scoped actions share a compact structural
  header. Keep the action menu adjacent to its title; do not add a separate
  action band or oversized page title when the sidebar already establishes
  hierarchy.

## Motion stance
- 2–3 primitives max per page: reveal (opacity + 8px translateY), CTA lift,
  micro color transitions. Progressive enhancement — default visible w/o JS.
- Reduced-motion fallback · collapse to instant / ≤150ms opacity.

## Exports
`apps/site/src/styles/custom.css` is the source of truth. `apps/web` consumes
the same `--bk-*` custom properties.
