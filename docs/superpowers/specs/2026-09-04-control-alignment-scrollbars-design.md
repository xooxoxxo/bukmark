# Control Alignment and Scrollbar Polish

Date: 2026-09-04
Status: Approved for implementation

## Goal

Tighten the compact contextual header, align selection controls with result content, restore breathing room before the first list item, and give scrollable regions a more distinctive Bukmark scrollbar without introducing decorative UI clutter.

## Scope

This is a visual-layer change in `apps/web`. It does not change routes, data, selection behavior, API contracts, or stored content.

### Context action trigger

- Reduce the visible ellipsis button from 40px square to 32px square.
- Keep the three dots optically centered and slightly smaller than the current treatment.
- Preserve an effective 44px pointer target with an invisible hit-area extension.
- Keep the existing hard 2px ink border, square corners, focus ring, and open/hover inversion.

### Selection alignment

- Inset the selection toolbar by 12px on both sides.
- This places “Select all loaded” on the same checkbox column as list rows and grid cards.
- Bulk-selection status and its Actions trigger inherit the matching right inset.
- Preserve the fixed toolbar height so selecting items cannot move the results.

### First-result spacing

- Add 12px top padding to the list scroll region before its first virtualized result.
- Do not add another gap to grid view; its first grid row already supplies 16px top padding.
- Preserve virtualization measurements and infinite-scroll behavior by spacing the scroll container, not individual virtual rows.

### Scrollbars

- Apply the treatment to app-owned scroll regions, including the sidebar, list, grid, and long menus.
- Use a transparent track with no gray rail or track fill.
- Use a square orange thumb based on `--bk-accent`.
- Give Chromium/WebKit thumbs a compact hard inset ink shadow; no blur, glow, rounding, or soft elevation.
- Use `scrollbar-color: var(--bk-accent) transparent` and a thin width in Firefox, where thumb shadows are not exposed.
- Keep the thumb visibly distinct on hover without adding another color family.

## Design-system amendment

`design.md` will document a single exception to the no-shadow rule: scrollbar thumbs may use a hard, zero-blur inset ink shadow to maintain contrast and the mechanical Bukmark character. The exception does not extend to buttons, cards, menus, or content surfaces.

## Responsive and accessibility requirements

- No horizontal scrolling at the 390px mobile floor.
- The smaller ellipsis control retains a 44px effective hit target and the existing accessible name.
- Focus styles remain immediate and meet the existing contrast requirement.
- Scrollbars remain usable in Chromium/WebKit and Firefox; unsupported engines fall back safely.
- No new motion primitive is introduced.

## Verification

- Run the web test suite, root typecheck, and production builds.
- Inspect list and grid views at desktop width to confirm checkbox-column alignment and first-result spacing.
- Inspect the contextual trigger at desktop and 390px mobile widths.
- Verify the sidebar and result scrollbars on a seeded demo database only.
- Confirm transparent tracks, square orange thumbs, no horizontal overflow, and no browser console errors.
- If the app screenshot changes materially, regenerate `apps/site/public/screenshot.png` from the seeded demo database only.
