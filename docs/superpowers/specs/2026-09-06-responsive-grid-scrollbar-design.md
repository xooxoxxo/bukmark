# Responsive Grid and Square Scrollbar Design

Date: 2026-09-06
Status: Approved for implementation

## Problem

The grid's CSS changes its visible column count at viewport breakpoints, while
`LinksGrid` always slices virtual rows into groups of four. When the CSS renders
three columns, the fourth card wraps inside the same virtual row. This produces
an extra card below the row and can overlap later virtual rows.

In Chromium, the standardized `scrollbar-width` and `scrollbar-color`
declarations can take precedence over the WebKit scrollbar pseudo-elements.
That preserves the browser's rounded native thumb even though the pseudo-element
sets `border-radius: 0`.

## Grid behavior

Column count will follow the width of the grid's own scroll container, not the
browser viewport. This keeps the layout correct with the sidebar open, in split
windows, and anywhere the content pane is narrower than the viewport.

Use these layout constants:

- Minimum card width: 17rem (272px at the app's 16px root size)
- Gap: 1rem, matching `--bk-space-md`
- Column range: one through four

Compute the count as:

```text
floor((container width + gap) / (minimum card width + gap))
```

Clamp the result to the one-to-four range. The same computed value must drive
both the JavaScript row slicing and `grid-template-columns`; they must never
derive column count independently.

Measure immediately before paint and observe later container resizes. When the
count changes, recompute the virtual row count and ask the virtualizer to
remeasure. The grid remains vertically virtualized and keeps the existing
infinite-loading behavior. A missing `ResizeObserver` must fall back safely for
tests and older environments without blocking initial rendering.

## Scrollbar behavior

Chromium and Safari will use the WebKit scrollbar pseudo-elements:

- 12px scrollbar width
- square orange thumb using `--bk-accent`
- zero radius in every thumb state
- transparent track and corner
- existing hard, zero-blur inset ink edge

The standardized thin scrollbar declarations will be scoped to browsers that
do not support the WebKit scrollbar selector. This preserves a useful Firefox
fallback without allowing Chromium's rounded native treatment to override the
brutalist thumb.

## Scope and compatibility

This is a presentation and layout correction only. It does not change link
data, selection, filtering, paging, card contents, or API behavior. Existing
design tokens remain canonical; no new visual exception is added to
`design.md`.

## Verification

- Unit-test column calculation boundaries and clamping.
- Confirm virtual slices use the measured column count.
- Browser-test approximately 390px, 768px, split-window, and wide desktop
  layouts with no wrapped extra card or horizontal overflow.
- Confirm Chromium renders a square orange thumb with a transparent track.
- Run typecheck, the full monorepo test suite, and production build.
- Regenerate `apps/site/public/screenshot.png` from the seeded demo database,
  never from production data.
- Commit the implementation and deploy the verified image to g9 as
  `bookmarkt-server:0.2.5`.
