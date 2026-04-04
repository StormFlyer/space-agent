# AGENTS

## Purpose

`_core/spaces/` owns the main user-facing spaces canvas.

It is the routed feature module that lists spaces, opens a selected space, persists per-space manifests and widget modules under the authenticated user's app files, exposes the stable `space.spaces` runtime namespace, and replays widget modules into the framework-owned grid.

Documentation is top priority for this module. After any change under `_core/spaces/`, update this file and any affected parent docs in the same session.

## Ownership

This module owns:

- `view.html`: routed spaces canvas shell and widget-grid mount point
- `store.js`: spaces store, route-driven loading, runtime namespace registration, current-space replay, widget-card lifecycle, and direct-manipulation layout interactions
- `spaces.css`: spaces shell layout, widget-grid styling, and first-party widget primitive presentation
- `dashboard-launcher.html`, `dashboard-launcher.js`, and `dashboard-launcher.css`: dashboard-injected spaces launcher surface
- `constants.js`: stable route, filesystem, and widget-size constants for this module
- `storage.js`: logical app-file paths, `space.yaml` parsing and serialization, space CRUD helpers, widget file writes, and public `/~/...` URL resolution
- `layout.js`: grid layout normalization, collision-safe placement, and render-size resolution for moving, resizing, and minimizing widgets
- `widget-sdk-core.js` and `widget-sdk.js`: stable widget authoring SDK including `defineWidget(...)`, size normalization, and render primitives
- `widget-render.js`: DOM rendering for widget primitive trees and markdown or raw HTML output
- `ext/html/_core/dashboard/content_end/spaces-dashboard-launcher.html`: thin dashboard extension adapter
- `ext/skills/spaces/skill.md`: onscreen-agent guidance for creating or updating space widgets; its frontmatter sets `metadata.always_loaded: true` so widget-authoring rules are always present in the onscreen prompt

## Persistence And Widget Contract

Spaces persist under the authenticated user's `~/spaces/<spaceId>/` root.

Current files and folders:

- `space.yaml`: canonical manifest with `schema`, `id`, `title`, timestamps, widget order, size overrides, signed position overrides, minimized widget ids, and title overrides
- `widgets/<widgetId>.js`: persisted widget module files
- `data/`: widget-owned structured data or downloaded files
- `assets/`: widget-owned images or other static assets referenced through `/~/...` fetch URLs
- new spaces are created empty; do not seed starter widgets into fresh manifests or widget folders
- `listSpaces()` should enumerate manifests by recursively listing the authenticated user's `~/spaces/` root and selecting `spaces/<spaceId>/space.yaml`; if that root does not exist yet, treat it as the normal empty-state case instead of surfacing an error in the dashboard launcher
- `removeSpace(...)` should delete the entire `~/spaces/<spaceId>/` tree recursively instead of trying to remove files piecemeal from the dashboard launcher

Current widget contract:

- widgets import the stable SDK from `/mod/_core/spaces/widget-sdk.js`
- widgets export a definition created by `defineWidget(...)`
- `apiVersion` is currently `1`
- `render(ctx)` is required and returns primitives, strings, arrays, or trusted raw HTML
- `load(ctx)` is optional and runs before `render(ctx)`
- the framework owns the outer card, the responsive grid, error states, and reload behavior, but it must not inject widget header chrome such as ids, titles, or dimension labels above widget output
- widgets must not patch global page DOM directly; the raw HTML escape hatch is `rawHtml(...)` inside the widget body
- generated widget scaffolds should not inject instructional title blocks or storage-explainer copy into the visible widget output
- legacy framework-generated scaffold widgets that still contain the old visible storage-explainer copy should be auto-migrated to the minimal scaffold when they are replayed

## Runtime Namespace

`store.js` registers `space.spaces`.

Current stable helpers include:

- `listSpaces()`
- `readSpace(spaceId)`
- `createSpace(options?)`
- `removeSpace(spaceId?)`
- `openSpace(spaceId, options?)`
- `saveSpaceMeta({ id, ... })`
- `saveSpaceLayout({ id, widgetIds?, widgetPositions?, widgetSizes?, minimizedWidgetIds? })`
- `upsertWidget({ spaceId?, widgetId?, title?, size?, source? })`
- `removeWidget({ spaceId?, widgetId })`
- `reloadCurrentSpace()`
- `getCurrentSpace()`
- `createWidgetSource(options?)`
- `resolveAppUrl(logicalPath)`
- `defineWidget(...)`
- `primitives`
- named primitive aliases such as `stack`, `text`, `metric`, `markdown`, and `rawHtml`

The SDK import path `/mod/_core/spaces/widget-sdk.js` is the preferred long-term widget authoring surface. `space.spaces` mirrors those helpers for interactive browser execution.

Current runtime split:

- Alpine UI state lives in the `spacesPage` store exposed as `$store.spacesPage`
- browser-execution and widget-authoring helpers live under the global `space.spaces` namespace
- caught spaces errors should be logged with `console.error(...)` before the UI shows its fallback notice
- the routed spaces page should stay canvas-only; listing spaces, creating spaces, and other management chrome belong on dashboard or overlay seams, not inside the space itself
- a space with zero widgets should render the centered empty-canvas prompt with the login-style floating title motion instead of injecting demo widget content, and the prompt headline should stay white, regular-weight, and keep its intended short line breaks when viewport width allows
- the empty-canvas prompt should also show a muted, non-animated example grid under the floating headline so the page suggests the kinds of agent-driven spaces users can ask for
- the example grid should use clickable prompt buttons that route through `space.onscreenAgent.submitPrompt(...)` rather than reaching into overlay DOM internals, and those prompts should preserve the overlay's current display mode unless a mode is explicitly requested
- the persisted widget coordinate system is centered: `0,0` is the canvas origin at screen center, positions can be negative, and widget positions are saved as signed logical grid coordinates rather than viewport-relative offsets
- the visible space canvas should stay viewport-sized with no native scrollbars and should visually cover the whole routed page width; navigation outside the initial view happens through explicit background drag panning, not by turning the page into a tall scroll surface
- the spaces root may keep a local viewport-bleed fallback so the canvas still fills the screen even if an upstream routed shell wrapper remains narrower than the viewport
- grid cells should stay square; on wider screens the canvas should reveal more columns rather than stretching each column wider than its row height
- the canvas navigation model is camera-based: background dragging pans the visible window over the logical grid without resetting to keep widgets in frame, and camera movement is clamped to the current widget extent instead of allowing unbounded travel away from placed content
- widgets can be moved by the subtle full-width top drag strip, resized from the bottom-right handle, minimized from the top control button, and removed from the top close button
- move and resize interactions should feel smooth during pointer movement, then resolve and persist onto the snapped logical grid when released; temporary grid lines should appear while active, and dragging near the viewport edge may nudge the camera slowly but must stay within the existing widget bounds
- widget titles belong in the top bar so minimized widgets remain identifiable
- the outer widget card is the only required visual container; widget primitives should not impose their own nested rounded card backgrounds by default
- the routed canvas currently includes a small `Consolidate` debug button that recenters the camera at `0,0`, restores minimized widgets, and rewrites widget positions into a centered tightly packed side-by-side strip for recovery/debugging

Current dashboard integration:

- `_core/dashboard/` exposes the `_core/dashboard/content_end` seam
- `_core/spaces` injects the existing-space list, each space id, per-space delete action, and New Space launcher through that seam
- dashboard-specific spaces UI should stay in this module, not in the dashboard owner

## Development Guidance

- keep persistence in logical app files under `~/spaces/`; do not introduce server-owned special storage for spaces
- keep `space.yaml` within the lightweight YAML subset that the shipped parser can round-trip reliably
- keep layout normalization non-recursive for both size and position coercion so malformed or defaulted manifest values cannot blow the stack during space load
- keep manifest normalization compatible with both serialized string size tokens and in-memory widget-size objects so persisted resizes survive refreshes
- keep widget modules isolated and replayable; use the framework-owned grid rather than storing DOM snapshots
- add new widget primitives here only when they are truly reusable across many generated widgets
- if the routed feature contract, runtime namespace, or persisted space layout changes, update this file and `/app/AGENTS.md`
