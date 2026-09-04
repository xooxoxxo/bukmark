# Compact Context Header and Hub Toggles

Status: approved in conversation on 2026-09-04

## Goal

Compress the Bukmark workbench vertically and make bulk hub membership behave like direct label selection. Section identity, section actions, and export belong in one compact header. Hub membership changes should happen immediately when a hub is clicked, without an intermediate select field or Assign button.

## Scope

This is a visual and interaction change in `apps/web`. It reuses the existing hub and bulk-link APIs. No server schema, route, export format, or database change is required.

The affected surfaces are:

- The global application toolbar
- The hub page header
- The bulk-selection Actions menu
- Selection lifecycle when result scope changes
- Web component and interaction tests
- The root design-system guidance

The landing site and browser extension are out of scope.

## Context header

The current 5.25rem global Export strip becomes a 4rem context header across every links view.

The left-aligned identity cluster contains:

- `All links` on the default collection route
- `Unassigned` on the unassigned route or filter context
- The current hub name on a hub route
- A compact square `•••` trigger immediately after the title
- The hub description as quiet, single-line secondary text when one exists and horizontal room allows it

Hub identity takes precedence over filter state: a hub route always shows the hub name. Outside a hub route, the Unassigned filter shows `Unassigned`; otherwise the title is `All links`.

The title uses Bricolage Grotesque at approximately 1.5rem with the existing heavy display weight. The header retains a 2px ink bottom border, zero radius, no shadow, and the canonical paper background. The description truncates rather than wrapping and is hidden at the narrow mobile breakpoint. Long titles truncate before they can force horizontal page scrolling.

The trigger opens a portalled Radix menu with keyboard navigation, focus return, collision handling, and explicit accessible naming. It stays adjacent to the title rather than moving to the far edge of the header.

### Menu contents

Every context menu contains:

- Export current view as HTML
- Export current view as JSON
- Export current view as CSV
- Full backup as JSON

Hub context menus additionally contain:

- Rename
- Archive hub or Unarchive hub, based on current status
- Delete hub

Hub actions appear before a structural separator and export actions appear after it. Delete retains a deliberate second confirmation step inside the menu. Errors appear within the open menu and do not move content below the header.

Rename replaces the title cluster with a compact, single-line input plus Save and Cancel controls. The header keeps the same 4rem height while editing. Empty or whitespace-only names cannot be submitted. Successful rename returns to the title cluster; failure leaves the input and error visible.

`AppToolbar` becomes the route-aware context header and owns these actions. It reads the route parameter, current filters, hub query, export URL builder, and existing hub mutations. `HubPage` retains hub lookup and its not-found state but no longer renders a second title/action region. Its normal state renders `LinksView` directly below the global context header.

## Bulk hub membership

The selection toolbar remains permanently allocated whenever rows are present. Selecting links changes only the controls inside that row and never changes the list's vertical position.

`LinksView` passes the selected loaded `LinkDto` records to `BulkBar`. `BulkBar` computes common hub membership by intersecting the `hubIds` arrays of every selected record.

The Actions popover replaces the hub select and Assign button with a checkable list of all active hubs:

- A hub is checked only when every selected link belongs to it.
- A hub assigned to some, but not all, selected links appears unchecked.
- Clicking an unchecked hub performs the existing bulk `assign` action for every selected link. Existing memberships remain unchanged because assignment is idempotent.
- Clicking a checked hub performs the existing bulk `unassign` action for every selected link.

Each click is the complete action. There is no explicit Assign or Apply control.

The popover remains open after a successful hub toggle and the current selection remains active so several memberships can be edited in one pass. Link and hub queries refresh after each mutation, allowing the common checked state to update from server data. The toggled item is disabled while its request is pending. A failure keeps the selection and menu open and displays the API error within the popover.

Archive and Delete keep their existing semantics and clear the selection after success. Clear remains a local action that makes no API request. Delete continues to require a second click.

## Selection scope

Selection belongs to the current result scope. It clears when any result-defining input changes:

- Hub route
- Search query
- Unassigned filter
- Status filter

Changing between list and grid does not clear selection because it does not change the result set. Loading another page does not clear selection. This constraint ensures every selected record used for common-hub calculation is present in the current loaded rows.

## Responsive behavior

At desktop widths, the title, menu trigger, and optional description share one line. At narrow widths, the description disappears first. The title may truncate, but the menu trigger and its touch target remain fully visible.

Menus render through a portal and use viewport collision padding, avoiding clipping by the fixed app shell. Menu width is capped to the viewport. No action label wraps to two lines and no state introduces page-level horizontal scrolling.

## Accessibility

- The context trigger exposes the current scope in its accessible name, such as `Actions for dev-tools`.
- Menu items use menu semantics and are reachable by keyboard.
- Hub membership items expose checked state without relying on color.
- Rename has an explicit Hub name label and supports Enter to save and Escape or Cancel to leave editing.
- Focus returns to the trigger when a menu closes.
- Pending and error states are announced without replacing the surrounding layout.
- Existing focus-ring and reduced-motion rules remain in force.

## Design-system amendment

Add this rule to `design.md` under composition guardrails:

> Section identity and section-scoped actions share a compact structural header. Keep the action menu adjacent to its title; do not add a separate action band or oversized page title when the sidebar already establishes hierarchy.

This is a system-level clarification, not a local exception.

## Verification

Component tests will cover:

- `All links`, `Unassigned`, and hub header identities
- Export links and full backup in each applicable context menu
- Hub-only Rename, Archive or Unarchive, and Delete actions
- Stable-height inline rename behavior and validation
- Common hub intersection for one and multiple selected links
- Mixed membership appearing unchecked
- Click-to-assign and click-to-unassign request payloads
- Selection and popover persistence after membership changes
- Selection clearing when route or filter scope changes
- Selection preservation for list/grid changes
- Pending and error states
- Keyboard-accessible menu and checked-item semantics

The full repository typecheck, build, and test suite must remain green. Visual verification uses the seeded demo database, never a personal database, and checks desktop plus 390px mobile widths for stable list position, menu collision behavior, truncation, and horizontal overflow.
