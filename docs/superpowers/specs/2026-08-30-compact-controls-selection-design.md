# Compact Controls and Selection Design

## Goal

Remove the oversized library totals strip, make the unassigned count useful in navigation, and keep bulk selection from changing the list's vertical position. Replace browser-default selects and checkboxes with accessible Radix primitives styled inside Bukmark's locked visual system.

## Scope

- App UI only in `apps/web`.
- No API, database, route, landing page, docs, or extension changes.
- Preserve the existing bulk actions and filter behavior.
- Preserve the locked colors, typography, square geometry, two-pixel structural borders, and reduced-motion behavior from `design.md`.

## Header and Sidebar

The five-cell stats ledger is removed. The main header becomes a compact application toolbar containing only Export, aligned to the right. Its height changes from 88px to 84px. The sidebar brand row uses the same 84px height so the structural rule remains aligned across the shell.

The stats query moves to the sidebar solely to display a live Unassigned count. A new Unassigned utility row sits directly below All links and above the hub list. It uses the same row geometry as a hub, with a slightly stronger label and a muted monospaced count. The row remains usable while stats load or fail; only the count is omitted until data is available. When active, it uses the existing orange active treatment rather than a new badge or pill.

Navigation behavior is mutually clear:

- Unassigned navigates to the root view and enables the existing unassigned filter.
- All links navigates to the root view and clears the unassigned filter.
- Hub navigation clears the unassigned filter before opening the hub.

The remaining total link, active, archived, and hub counts are removed from the header. Result counts remain in the filter region where they describe the current view.

## Shared Control Primitives

Add three headless Radix dependencies:

- `@radix-ui/react-checkbox`
- `@radix-ui/react-select`
- `@radix-ui/react-popover`

Create shared Checkbox and Select components under `apps/web/src/components/ui`. The selection actions use Radix Popover directly or through a small shared wrapper if reuse becomes clear during implementation.

The components use Bukmark tokens and do not import Tailwind or shadcn's theme layer. Controls have zero radius, paper backgrounds, ink or rule borders, orange checked and focus states, and no shadows or gradients. Select content and the bulk popover render through portals so they cannot be clipped by the workbench's scrolling regions. All controls retain labels, keyboard support, focus visibility, disabled states, and screen-reader semantics.

Replace every app checkbox and select in this pass:

- FilterBar unassigned toggle, status select, and hub select.
- Select all loaded.
- LinkRow and LinkCard selection checkboxes.
- Bulk assignment hub select.

## Selection Interaction

Replace the conditionally mounted BulkBar with a fixed-height selection toolbar rendered whenever loaded rows exist. The toolbar lives in the current Select all loaded position, directly between the filters and the list.

The left side always contains the shared Checkbox and the label Select all loaded. When the selection is non-empty, the right side reveals the selected count and an Actions button inside the same toolbar. The toolbar's height, margins, and border geometry do not change when these controls appear, so the list never moves.

Actions opens a square Radix Popover anchored to the toolbar. The popover contains:

- The shared hub Select and Assign button.
- Archive.
- Delete.
- Clear selection.

The existing bulk mutation payloads and clear-on-success behavior remain unchanged. Delete still requires a second explicit confirmation. Confirmation is contained within the popover and does not resize the page. Mutation errors appear inside the popover in an `aria-live` region.

On narrow screens, the toolbar remains one row. The left label may shorten to Select all while preserving its accessible name. The selected count and Actions button stay on the right. The popover width is constrained to the viewport and lays out its controls vertically, avoiding horizontal page overflow.

## Component Boundaries

- Rename or replace StatsBar with a toolbar component responsible only for Export.
- Sidebar owns presentation and activation of the Unassigned navigation row while continuing to use the existing filter store.
- A SelectionToolbar owns select-all state and the conditional selection summary.
- A BulkActionsPopover owns hub choice, mutation actions, confirmation, and mutation errors.
- Shared UI primitives own Radix wiring and visual states, not application data.

This keeps query/filter state in the existing stores and hooks while separating reusable control behavior from bookmark-specific actions.

## Verification

Update component tests to cover:

- The application toolbar no longer renders the stats ledger and still exposes Export.
- Sidebar renders the live Unassigned count and toggles the existing filter correctly.
- All links and hub navigation clear the unassigned filter.
- Shared Radix Select and Checkbox controls support the existing interactions.
- Selection actions are hidden at zero selected and revealed inside the always-present selection toolbar.
- Assign, Archive, Delete confirmation, Clear, and mutation-error behavior remain correct.

Run all 66 web tests and the production web build. Visually verify list and grid modes at desktop and 390px. Confirm there is no vertical list movement when selecting a link, no horizontal overflow, no clipped portals, and no browser console errors. Because the app UI changes, regenerate `apps/site/public/screenshot.png` from the 30-link seeded demo database using the brief's exact 1456 by 900 capture process. Never capture the production database.
