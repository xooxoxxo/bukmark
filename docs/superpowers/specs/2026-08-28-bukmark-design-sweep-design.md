# bukmark design sweep

Date: 2026-08-28  
Status: approved direction, pending implementation plan

## Objective

Turn the existing brand pass on branch `site` into one deliberate product system across the landing page, React app, and Starlight documentation. The result should feel like a signature warm-brutalist product rather than a retheme, while preserving product behavior and the triage model: capture now, leave unsorted on purpose, sort deliberately later.

The Chrome extension is audit-only in this sweep.

## Source of truth and precedence

`design.md` remains authoritative. Exact logo colors, Bricolage Grotesque display type, Geist body type, square geometry, structural borders, scarce accent, and restrained motion are locked.

The selected direction is the “signature recompose” option. The `gpt-taste` guidance contributes wide editorial hierarchy, strong AIDA pacing, and an explicit anti-slop review. Guidance that conflicts with `design.md` or the brief is excluded: no gradients, stock imagery, decorative micro-images, floating glass or pill navigation, testimonial content, invented metrics, or GSAP dependency.

## System amendments

Amend `design.md` rather than introducing one-off exceptions:

- Signature comes from scale, proportion, whitespace, and border geometry—not decorative labels.
- Ban decorative kickers, numbered section labels, stamps, pill-tags, and ornamental micro-metadata.
- Keep functional metadata only where it helps a task. Hub assignments may remain quiet rectangular tags; aggregate counts should use a typographic ledger instead of pills.
- Marketing display headings use a wide measure and stay within two or three lines at desktop sizes.
- UI copy stays comfortably readable. Do not shrink primary controls or useful labels to create hierarchy.
- Dense rows use content-driven height with a stable minimum; notes and assignments must not be clipped by a fixed row height.
- Responsive layouts may recompose, but must preserve every control, avoid horizontal page scrolling, and keep action labels on one line.

No canonical color, type, radius, border, or motion token changes are required.

## Landing page

### Structure

The landing page keeps its existing content and truthful claims but receives a full compositional rewrite using the existing Astro page and global style block.

1. **Navigation:** A minimal split slab with the existing logo at left, essential navigation at right, and one clear GitHub action. It stays square and structurally bordered; no floating container or decorative chrome.
2. **Attention:** A wide asymmetric editorial hero. “Bookmarks you actually revisit.” occupies at most two lines on a normal desktop viewport. Supporting copy and the two existing actions sit in a separate lower band so the headline can breathe. The install command remains useful content, not fake terminal chrome.
3. **Interest:** “The Three Moves” becomes one continuous, gapless composition separated by 2px rules. Capture, sort with Claude, and export are large readable headings with adjacent descriptions—not cards, numbered labels, or badges.
4. **Desire:** The seeded app screenshot becomes the dominant media chapter. It is shown directly without fake browser furniture. Supporting copy explains the triage model at normal body size.
5. **Action:** The closing actions and footer become one decisive final block. Footer copy is shortened and split into readable brand and utility regions instead of a dense paragraph.

### Motion

Use only the locked primitives: reveal, CTA lift, and color transition. Content is visible without JavaScript. Reduced-motion removes transforms and delayed reveals.

### Mobile

- Navigation keeps the brand and primary action visible while secondary links collapse cleanly.
- Hero copy wraps naturally without overflow; action labels remain single-line.
- Workflow regions stack in reading order and retain strong separators.
- The install command may scroll within its own code region, but the page itself never scrolls horizontally.

## React app

### Workbench geometry

Preserve the desktop sidebar model because hubs need a scalable navigation surface. Recompose it into a stronger workbench grid rather than moving hubs into a fragile horizontal navigation row:

- Brand/sidebar header and top utility region align to the same baseline and structural border.
- Desktop retains a fixed navigation rail and flexible content plane.
- Mobile stacks the navigation rail above the content plane. Hub links wrap or form a compact grid; the page does not depend on horizontal scrolling.
- The main content region uses `min-height: 0` and local scroll containers so the viewport shell remains stable.

### Status and filtering

- Replace StatsBar pills with a typographic ledger: readable values separated by rules, with Export as the sole filled action.
- Recompose FilterBar as a deliberate control grid. Search gets the dominant width; status, hub navigation, unassigned filtering, view choice, and result count align on a common rhythm.
- Preserve current labels, ARIA names, filter behavior, routing, and export behavior.
- Bulk actions use the same control geometry and visible focus treatment.

### Links and states

- Remove the fixed `64px` LinkRow height. Virtualized list rows must measure rendered height so notes, thumbnails, duplicate counts, and hub assignments cannot be clipped.
- Preserve relevance and hub metadata because they are functional. Style them as quiet, square metadata—not decorative pills.
- Make the grid responsive without changing link grouping or pagination. Virtualized grid rows must be measured when column count changes.
- Add composed loading, empty, error, and hub-not-found presentation using presentational markup only. Empty copy must be direct and contextual; do not add invented data or new product actions.
- Restyle HubPage heading, edit form, normal actions, destructive confirmation, and inline errors against the same hierarchy.

### Behavior boundary

Allowed TSX edits are limited to semantic wrappers, presentational grouping, direct state copy, accessibility attributes, and virtualizer measurement needed by flexible visual layout. API calls, query keys, routing semantics, filters, selection, mutations, and product flows do not change.

## Starlight documentation

Keep Starlight and its information architecture. Extend `apps/site/src/styles/custom.css` from token mapping into a designed documentation surface:

- Apply the brand’s structural borders to the header, sidebar, mobile menu, and content regions.
- Establish a wide but readable article measure with stronger Bricolage headings and Geist body copy.
- Remove inherited rounding and shadow-like elevation from search, code, tables, asides, pagination, and navigation controls.
- Use accent only for links, active navigation, focus, and small interactive emphasis.
- Make code blocks, tables, heading anchors, asides, and pagination feel like one square, editorial documentation system.
- Verify built Starlight DOM before targeting selectors; avoid brittle generated class names where stable custom properties or element/component selectors exist.
- Preserve all documentation content and routes.

## Extension audit

Do not edit `apps/extension` in this sweep. Record follow-up findings:

- Popup currently uses system fonts, browser color-scheme defaults, inline CSS, and unbranded native control styling.
- It lacks the logo-led header and structural border language used by the site and app.
- Status, failure, and disabled states have weak hierarchy.
- A future extension pass should use bundled/local assets and fonts compatible with extension CSP and offline behavior, keep the compact capture flow, and avoid importing web-only styling assumptions.

## Screenshot safety

If app visuals change, regenerate `apps/site/public/screenshot.png` only from the seeded demo database using the commands in the vault brief. Never open or capture a real bookmark database. The checked-in screenshot must remain a deterministic demo artifact with accurate alt text.

## Verification

Implementation is complete only when:

- All existing web and site tests remain green (baseline: 66 web and 6 site tests from the brief).
- App and site typechecks/builds pass.
- Landing, app list/grid, empty/error/not-found states, and representative docs pages receive desktop and mobile visual checks.
- There is no page-level horizontal scrolling at mobile widths.
- Buttons retain single-line labels and visible keyboard focus.
- Reduced-motion behavior is verified.
- `apps/site/public/screenshot.png` is regenerated from seeded demo data after app visual changes.
- No extension files are modified; its findings are reported in the final handoff.

## Expected implementation surface

Primary files:

- `design.md`
- `apps/site/src/pages/index.astro`
- `apps/site/src/styles/custom.css`
- `apps/web/src/global.css`
- `apps/web/src/components/*.module.css`
- `apps/web/src/pages/HubPage.module.css`

Presentational TSX changes, if required by this specification:

- `apps/web/src/components/Layout.tsx`
- `apps/web/src/components/StatsBar.tsx`
- `apps/web/src/components/FilterBar.tsx`
- `apps/web/src/components/LinksView.tsx`
- `apps/web/src/components/LinksTable.tsx`
- `apps/web/src/components/LinksGrid.tsx`
- `apps/web/src/pages/HubPage.tsx`

No server, API, database, CLI, MCP, extension, or shared-domain behavior is in scope.
