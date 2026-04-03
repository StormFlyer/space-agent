# AGENTS

## Purpose

`app/` is the primary Space Agent runtime.

Keep agent orchestration, prompt construction, tool flow, state management, user interaction, and optimistic UX in the browser whenever possible. Server-backed work in this tree should be browser clients for explicit server APIs, not server-side orchestration leaking into the frontend.

Documentation is top priority for this area. After any change under `app/` or any app-facing contract change owned here, update this file in the same session before finishing.

The current goal for this tree is no longer just framework completion. The framework under `app/L0/_all/mod/_core/framework/` is now the base platform for the actual frontend app, with shared styles and font assets under `css/`, runtime modules under `js/`, and extension files under `ext/`. New first-party app work should be built as `_core` modules that compose through modules and extensions instead of growing page shells or one-off boot scripts.

## Structure

The browser runtime is organized into three layers:

- `L0/`: immutable firmware changed through updates
- `L1/`: runtime-editable group customware
- `L2/`: runtime-editable user customware

Current browser entry surfaces are served from `server/pages/`:

- `/`: main app shell from `server/pages/index.html`
- `/admin`: admin shell from `server/pages/admin.html`, with `meta[name="space-max-layer"]` set to `0` so module and extension resolution stay `L0`-only
- `/login`: standalone login screen from `server/pages/login.html`
- `/logout`: server-side logout action that clears the session cookie and redirects to `/login`

Current shared module locations:

- `app/L0/_all/mod/_core/framework/`: shared frontend platform root; keep shared styles and font assets under `css/`, runtime modules under `js/`, and extension files under `ext/`
- `app/L0/_all/mod/_core/chat/`: current chat runtime and the best reference implementation of a store-driven app feature mounted through the extension system
- `app/L0/_all/mod/_core/admin/`: current firmware-backed admin UI, organized by surface under `views/shell/`, `views/dashboard/`, `views/agent/`, and `views/documentation/`, with the split shell mounted through a page-specific extension anchor
- `app/L0/test/`: firmware-side test and example customware fixtures

Shared browser primitives:

- `<x-extension id="...">`: HTML extension anchor; loads matching `mod/**/ext/**` HTML files
- `<x-component path="/mod/...">`: HTML component loader; fetches a component file and mounts its markup, styles, and scripts
- `<x-icon>`: lightweight icon tag normalized by the framework into a Material Symbols glyph
- `globalThis.space`: shared frontend runtime namespace for the current browsing context only; do not publish it into `parent`, `top`, or iframe windows
- `space.api`: authenticated browser API client, including `fileList()`, `fileRead()`, `fileWrite()`, and `userSelfInfo()`
- `space.fw.createStore(name, model)`: shared Alpine store factory exposed by the framework runtime
- `space.utils.yaml`: lightweight frontend YAML helpers with `parse()`, `parseScalar()`, and `serialize()`

## Layer Rules And Module Model

- `L0` is firmware and should stay update-driven
- `L1` contains per-group customware; `_all` and `_admin` are special groups
- `L2` contains per-user customware; users should only write inside their own `L2/<username>/`
- `L1` and `L2` are transient runtime state and are gitignored; do not document repo-owned example content there as if it were durable framework structure
- `app/L2/<username>/user.yaml` stores user metadata such as `full_name`; auth state lives under `app/L2/<username>/meta/`
- authenticated app-file lists, reads, and writes may use `~` or `~/...` as shorthand for the current user's `L2/<username>/...` path when the API supports it
- groups may include users and other groups, and may declare managers that can write to that group's `L1` area
- group definitions live in `group.yaml` files under `app/L0/<group-id>/` and `app/L1/<group-id>/`
- read permission rules are explicit: users can read their own `L2/<username>/`, and can read `L0/<group>/` and `L1/<group>/` only for groups they belong to
- write permission rules are explicit: users can write their own `L2/<username>/`; users can write `L1/<group>/` only for groups they manage directly or through managing-group inclusion; `_admin` members can write any `L1/` and `L2/` path; nobody writes `L0/`
- modules are the supported browser delivery and extension unit
- each group or user owns a `mod/` folder, and module contents are namespaced as `mod/<author>/<repo>/...`
- browser-facing code and assets should normally be delivered through `/mod/...`
- the current inheritance model is `L0 -> L1 -> L2` across the effective group chain for the current user
- page shells may clamp module and extension resolution with `meta[name="space-max-layer"]`; the current admin shell sets `0`, which means `/mod/...` and `/api/extensions_load` stay on `L0` even though file APIs remain unchanged
- authenticated frontend fetches now rely on the server-issued session cookie after login; do not reintroduce client-trusted identity shortcuts
- first-party application development should now happen primarily under `app/L0/_all/mod/_core/`
- use `L1` and `L2` for layered overrides and customware behavior, not as the main home for repo-owned first-party app features

## Frontend Composition Model

The frontend is built as a chain of extensions. The root page shell should do almost nothing except load the framework and expose an anchor. The module mounted there should expose more anchors or wrapped functions. Other modules should extend those seams instead of reaching around them.

Current boot flow:

1. `server/pages/index.html` or `server/pages/admin.html` loads shared framework CSS and `/mod/_core/framework/js/initFw.js`; `/admin` also declares `meta[name="space-max-layer"]` with content `0`, and its shell URLs include `?maxLayer=0`.
2. The page shell exposes exactly one top-level HTML anchor in the body: `html/body/start` for `/` and `page/admin/body/start` for `/admin`.
3. `initFw.js` imports `/mod/_core/framework/js/extensions.js` first. That module creates `globalThis.space` in the current window, installs `space.extend`, and starts the HTML-extension observer.
4. `initFw.js` initializes the shared runtime with `initializeRuntime(...)`, which populates the current window's `space.api`, `space.fw.createStore`, and `space.utils.yaml`. Each window or iframe keeps its own runtime and Alpine state; do not share or publish the runtime across browsing contexts.
5. `initFw.js` runs `initializer.initialize()`. Because `initialize()` and `setDeviceClass()` are wrapped with `space.extend`, they already expose JS extension hooks before the rest of the app is mounted.
6. `initFw.js` then loads framework support modules such as `modals.js`, `components.js`, `icons.js`, and the confirm-click helper, imports Alpine, and registers framework Alpine directives.
7. `extensions.js` scans the DOM for `<x-extension>` nodes. For each `id`, it batches one `/api/extensions_load` request per frame for all uncached extension lookups and includes the page-level `maxLayer` ceiling when configured.
8. Matching HTML extension files are turned into `<x-component>` nodes in resolved order.
9. `components.js` fetches each component file, mounts its styles and scripts, appends its body nodes, and recursively loads nested `<x-component>` tags.
10. Alpine activates the mounted markup. Feature stores and runtime helpers own behavior from there.

The current app already demonstrates this chain:

```html
<!-- server/pages/index.html -->
<body class="app-page-chat">
  <x-extension id="html/body/start"></x-extension>
</body>
```

```html
<!-- app/L0/_all/mod/_core/chat/ext/html/body/start/chat-page.html -->
<x-component path="/mod/_core/chat/chat-page.html"></x-component>
```

That pattern is the default for new app work. Keep the shell small, mount a module through an extension file, and let that module expose the next seam.

## Extension System Contracts

There are two primary extension styles in the frontend runtime.

### HTML Extension Anchors

Use HTML extension anchors when the seam is structural or visual.

- A DOM anchor is declared with `<x-extension id="some/path">`
- Matching HTML files live at `mod/<author>/<repo>/ext/some/path/*.html`
- The resolved HTML files are mounted in order as `<x-component>` tags
- HTML extension files should usually stay thin and mount the real component from the module root instead of containing the whole feature directly

Recommended pattern:

```html
<!-- anchor -->
<x-extension id="page/admin/body/start"></x-extension>
```

```html
<!-- thin adapter file under ext/ -->
<x-component path="/mod/_core/admin/views/shell/shell.html"></x-component>
```

Choose HTML anchors deliberately:

- use a generic anchor such as `html/body/start` only when the contribution is meant to compose into a shared page surface
- use a page-specific anchor such as `page/admin/body/start` when a surface is owned by one page and should not attract unrelated contributions
- add a new anchor in the owning module when downstream modules need a stable DOM insertion point
- do not import and patch another module's private markup when a small `<x-extension>` seam would make the contract explicit

### JS Extension Hooks

Use JS extension hooks when the seam is behavioral.

The standard hook API is `space.extend(import.meta, ...)`.

Example:

```js
// /mod/_core/framework/js/initializer.js
const INITIALIZER_MODULE_REF = new URL("../initializer.js", import.meta.url);

export const initialize = globalThis.space.extend(INITIALIZER_MODULE_REF, async function initialize() {
  await setDeviceClass();
});
```

That implementation lives at `/mod/_core/framework/js/initializer.js` but preserves the extension point `_core/framework/initializer.js/initialize`, which means hook files may live at:

- `mod/<author>/<repo>/ext/_core/framework/initializer.js/initialize/start/*.js`
- `mod/<author>/<repo>/ext/_core/framework/initializer.js/initialize/end/*.js`

Important rules:

- `space.extend()` requires a valid module ref such as `import.meta`
- `space.extend()` wraps standalone functions, not classes
- wrapped functions become async; callers should `await` them
- if the function name is not the contract you want to expose, pass an explicit relative extension-point name
- import `/mod/_core/framework/js/extensions.js` only once from `initFw.js`; other modules should use `globalThis.space.extend(...)` directly
- do not create local `const extend = globalThis.space.extend` aliases just to forward the same global contract

Hook context behavior:

- `/start` hooks run before the original function
- `/end` hooks run after the original function or after a skipped call
- hook modules receive the mutable context object created by `space.extend()`
- `/start` hooks may rewrite `ctx.args`, set `ctx.skip = true`, or set `ctx.error`
- `/end` hooks may inspect or replace `ctx.result` and `ctx.error`
- the hook context includes `args`, `result`, `error`, `skip`, `skipped`, `thisArg`, `extensionPoint`, `functionName`, and `original`

The framework also supports explicit named JS extension points through `callJsExtensions("name", data)`. Use that style when the seam is a named event rather than the lifecycle of one owning function. Current examples are `open_modal_before` and `close_modal_before` in `framework/js/modals.js`.

## Resolution, Ordering, And Overrides

The server resolves extension files from the current user's accessible `L0`, `L1`, and `L2` module trees through `/api/extensions_load`.

The optional `maxLayer` ceiling narrows that resolution:

- `0`: only `L0`
- `1`: `L0` and `L1`
- `2`: `L0`, `L1`, and `L2` (default)

What composes and what overrides:

- if two layers provide the exact same module-relative extension file path, the higher-ranked layer overrides the lower one
- if two layers provide different filenames under the same extension point, both contributions remain and compose together
- use the exact same `ext/.../<filename>` path only when replacement is intentional
- use different filenames when the goal is additive composition

Current resolution order is:

- `L0/_all`
- current user's ordered `L0/<group>/` chain
- `L1/_all`
- current user's ordered `L1/<group>/` chain
- `L2/<username>`

Within the same effective rank, results are ordered lexically by project path. If multiple same-rank contributions must render in a stable sequence, name the files intentionally.

Practical guidance:

- prefer additive composition first
- prefer small anchor-specific files over full lower-layer replacement
- use exact-path overrides for true firmware replacement, not as the first tool for ordinary feature work

## Component Contract

`<x-component>` loads an HTML file and treats it as a component source.

Current loader behavior:

- the component source may be a full HTML document or a simple fragment
- `<style>` and `<link rel="stylesheet">` nodes are appended to the target element
- `<script type="module" src="...">` scripts are loaded with dynamic `import()`
- nested `<x-component>` tags are discovered and loaded recursively
- dynamically inserted `<x-component>` nodes are handled by a `MutationObserver`
- attributes on parent `<x-component>` wrappers are available inside descendants through `xAttrs($el)`

Preferred component structure for non-trivial modules:

```html
<html>
  <head>
    <link rel="stylesheet" href="/mod/_core/feature/feature.css" />
    <script type="module" src="/mod/_core/feature/feature-page.js"></script>
  </head>
  <body>
    <!-- component markup -->
  </body>
</html>
```

Guidelines:

- keep real implementation files in module-owned surface folders or the module root, not under `ext/`
- use root-based `/mod/...` URLs for component scripts, styles, and assets
- prefer external module scripts over large inline behavior blocks
- keep a single surface-local stylesheet next to the rest of that surface's files; do not create a nested `css/` folder just to hold one file
- if a component depends on a store, import that store module in the component's own HTML `<head>`; do not rely on parent views, extension adapters, or page shells to preload feature stores for it
- keep HTML components declarative; they should map store state, wire refs, and call small store methods rather than holding feature logic in inline `x-data` objects or long inline scripts
- do not create passthrough components whose only job is to re-include another component; point the caller directly at the real component file unless the adapter is the explicit `ext/` seam
- use fragment components for very small leaf pieces such as nested snippets or modal bodies
- use full-document component files when the component needs its own `<head>` assets, `<title>`, or body/html classes
- when a surface has a fixed composer, footer, or toolbar, make the local content body the scroll container; do not let the page shell or parent stage grow and scroll the fixed controls off screen
- for fixed-height surfaces, make the top-level component wrapper participate in the layout chain too; it should usually fill the parent with `display:flex` or `display:grid`, `height:100%`, and `min-height:0` so nested scroll regions can stay bounded

## Alpine Store And Runtime Guide

The current frontend pattern is Alpine plus store-backed modules.

Recommended ownership split:

- component HTML owns structure and Alpine bindings
- Alpine stores own state, persistence, async work, server calls, and orchestration
- module utilities own rendering helpers, data transforms, and protocol logic that would make a store too dense
- `space` owns shared runtime APIs and cross-feature namespaces

Avoid feature-local Alpine logic in component markup:

- do not build non-trivial features around inline `x-data="{ ... }"` objects or inline `<script>` blocks inside component HTML
- put feature state, tab selection, async behavior, and event logic into a module store under the owning module root
- keep component markup focused on binding to `$store`, passing `x-ref`s, and calling small store methods
- do not access `globalThis.Alpine` directly from feature modules; import the owning store module where the feature is mounted and address it through `$store` bindings or the imported store contract instead

Store guidance:

- create stores with `space.fw.createStore(name, model)` on framework-backed pages instead of importing the Alpine store helper through a long module path in feature code
- call `space.fw.createStore(...)` directly in the store module; do not copy it into a local variable first and do not add defensive availability checks around it
- keep store names aligned: the registered name, exported binding, file usage, and `$store.<name>` key should match exactly and should not end with `Store`
- use `init()` for one-time store startup
- use `mount(refs)` and `unmount()` when the store needs DOM references or window listeners
- pass DOM references from Alpine with `x-ref`; do not make stores scan the whole document when direct refs will do
- gate store-dependent UI with `x-data` plus `template x-if="$store.<name>"`
- use `x-init` to mount and `x-destroy` to clean up
- prefer Alpine handlers such as `@click`, `@submit.prevent`, `@input`, `@keydown`, `x-model`, `x-text`, and `x-show` over manual listener wiring
- when a module needs several helpers from the same dependency, import the module under a short namespace such as `import * as agentView from ".../view.js"` instead of long named-import lists

Runtime guidance:

- framework-backed pages that boot through `/mod/_core/framework/js/initFw.js` already initialize the shared runtime before feature modules mount; feature modules should usually consume `space` directly instead of calling `initializeRuntime(...)` again
- publish cross-feature contracts under explicit runtime namespaces such as `space.currentChat`, not as loose globals
- if a feature expects downstream extensions, expose a small explicit runtime or hook contract in the owner instead of having dependent modules reach into internal closures
- use `space.api.userSelfInfo()` when the browser needs the authenticated user's derived identity snapshot
- use `space.utils.yaml.parse()` and `space.utils.yaml.serialize()` for lightweight YAML config files owned by browser modules
- use browser storage only for small, non-authoritative UI state that does not need cross-device persistence, such as the last selected tab in a local shell; prefer `sessionStorage` for refresh-surviving per-tab state and keep real user config/history in app files or backend APIs

## App Development Principles

This is the default development model for the app going forward.

- build every feature as a module under `app/L0/_all/mod/_core/<feature>/`
- treat the page shell as an extension root, not as the application body
- treat each mounted module as the owner of the next seam
- if another feature needs to modify owned behavior, expose a new extension point at the owning boundary instead of importing private internals and patching them indirectly
- keep extension files thin; put reusable logic, markup, and styling in ordinary module files
- design every new feature so it can itself be extended later
- when choosing between a direct import and a new extension seam, prefer a direct import for purely internal implementation detail and a new extension seam for any contract that another module or layer may reasonably need to customize
- when a style, helper, or runtime contract will be reused by multiple modules, move it into `_core/framework` or another clearly shared owning module instead of cloning it
- do not grow `server/pages/*.html` beyond shell concerns when the same result can be achieved with modules and extension anchors
- do not build new first-party app features directly inside transient `L1` or `L2` customware

Use this decision sequence when adding new app functionality:

1. Choose the owning module under `_core`.
2. Decide where it mounts: existing anchor, new anchor, modal surface, or standalone module page.
3. Put the real component, store, CSS, and utilities in the owning module root.
4. Add the smallest possible `ext/...` adapter file to attach that module to the chosen seam.
5. If the new module needs downstream customization, expose its own `<x-extension>` or `space.extend()` seam immediately instead of waiting for consumers to monkey-patch it later.
6. If layer-specific behavior is needed, prefer additive extension files first and full same-path overrides only when replacement is the real intent.

## Frontend Implementation Guide

- keep root HTML shells thin and static; session gating for root pages belongs in the server router, not in inline boot scripts
- keep page shells under `server/pages/` minimal; they should mount app modules rather than duplicating frontend logic there
- keep pre-auth shell-only art or binary assets under `server/pages/res/` and load them from `/pages/res/...` instead of embedding large data blobs directly into page HTML
- use `app/L0/_all/mod/_core/framework/css/colors.css` as the shared palette source for authenticated frontend surfaces; prefer its semantic purpose-based tokens over hardcoded page-local colors
- use `app/L0/_all/mod/_core/framework/css/visual.css`, loaded through `css/index.css`, for shared backdrop primitives such as the space canvas and sparse celestial motion instead of rebuilding page backgrounds from scratch
- use `/mod/_core/framework/js/initFw.js` as the shared frontend bootstrap for framework-backed pages
- wrapped functions expose their resolved extension point at `fn.extensionPoint`; use that in the browser console when debugging where matching extension files belong
- cache empty extension lookups as valid results; a missing extension point should not trigger repeated `/api/extensions_load` polling during the same cache lifetime
- uncached extension lookups are batched to one `/api/extensions_load` request per frame; keep extension discovery bursty and declarative so the batcher can collapse multiple JS and HTML hook lookups together during bootstrap and DOM scans
- browser-side file changes still require a manual browser refresh; live reload is not wired into the app runtime yet
- because extension lookups are cached in memory, adding new `ext/...` files often requires a reload before the running page will discover them
- when you add a new stable app seam, update this file in the same session so later agents know where the extension boundary now lives

## Visual Guidance

Space Agent frontend work should look like one deliberate system rather than a mix of unrelated component-library defaults.

- minimal first: solve hierarchy with spacing, alignment, type scale, and one strong surface before adding extra panels, dividers, chips, or decorative UI
- dark space environment: use the semantic color tokens from `app/L0/_all/mod/_core/framework/css/colors.css` by purpose and use the shared space backdrop from `app/L0/_all/mod/_core/framework/css/visual.css`; do not invent page-local background systems when the shared one fits
- dark-only shared palette: `app/L0/_all/mod/_core/framework/css/colors.css` now defines only the shared dark palette; if a legacy surface still needs local light tokens temporarily, keep them owned by that module instead of reintroducing framework-level light-mode classes
- public shell mirroring: public shells that cannot load authenticated `/mod/...` assets, such as `/login`, should keep their pre-auth styling and assets local while staying aligned with the shared design system
- restrained atmosphere: keep the space direction calm and intentional, with deep navy canvases, subtle starfield texture, and soft accent glow rather than noisy sci-fi chrome or neon overload
- restrained motion: if motion is used, keep it sparse, atmospheric, and easy to ignore; it should support the mood without turning the interface into an attention trap
- usable contrast: body text, controls, focus states, and status states must remain clear and comfortable for long sessions; do not trade readability for mood
- soft geometry: use a 4 px spacing rhythm, keep controls compact, prefer 14 to 16 px radii for inputs and buttons, and 22 to 28 px radii for major panels and shells
- compact mobile layouts: mobile screens should reduce padding, collapse secondary decoration, and preserve clear tap targets without turning the layout into stacked oversized cards
- reusable promotion rule: when a style pattern appears in more than one place, move it into shared framework CSS instead of cloning slightly different local versions

## Current State

- `server/pages/index.html` and `server/pages/admin.html` are plain module-backed shells; the server router decides whether to serve them or redirect to `/login`
- `server/pages/index.html` exposes the `html/body/start` extension anchor and lets the core chat shell inject there from `/mod/_core/chat/ext/html/body/start/chat-page.html` rather than hardcoding chat directly in the page shell
- `server/pages/admin.html` exposes the `page/admin/body/start` extension anchor, injects the `_core/admin` split shell from `/mod/_core/admin/ext/page/admin/body/start/admin-shell.html`, uses a plain dark page background rather than the shared starfield canvas, and declares `space-max-layer=0` so admin module and extension fetches stay on firmware
- `app/L0/_all/mod/_core/framework/` is the platform layer for new frontend app work and is organized into `css/`, `js/`, and `ext/`
- `app/L0/_all/mod/_core/framework/css/index.css` owns the shared global scrollbar treatment for framework-backed surfaces; keep it thin and low-noise there instead of restyling scrollbars independently in each feature
- `app/L0/_all/mod/_core/framework/css/visual.css` owns the shared space canvas backdrop primitives used across frontend surfaces
- `app/L0/_all/mod/_core/framework/js/modals.js` exposes modal shell anchors at `modal-shell-start` and `modal-shell-end`
- `app/L0/_all/mod/_core/chat/` is the current reference module for a full page feature mounted through a root HTML extension, driven by an Alpine store plus shared runtime helpers, and now styled against the shared dark-space palette with its own simple dark backdrop rather than a local light-mode surface system
- `app/L0/_all/mod/_core/admin/` is the current reference module for a page-specific split shell, organized by surface under `views/shell/`, `views/dashboard/`, `views/agent/`, and `views/documentation/`, with an iframe main pane, a fixed top icon tab bar whose active tab expands to show its label, and direct component mounts instead of passthrough include files
- `app/L0/_all/mod/_core/admin/views/shell/page.js` remembers the last selected admin tab in `sessionStorage`, so refresh restores the current tab without persisting that shell-local UI state to the backend
- `app/L0/_all/mod/_core/admin/views/agent/panel.html` plus the sibling files under `views/agent/` are the current reference for a firmware-backed admin-side chat surface; it is standalone within `_core/admin`, persists config to `~/conf/admin-chat.yaml`, persists history to `~/hist/admin-chat.json`, does not depend on `_core/chat`, keeps the composer pinned by using the thread body as the only scroll container, renders browser execution steps as compact expandable status rows instead of large terminal headers, and keeps assistant utility actions as minimal icon rows under the relevant message section
- `app/L0/_all/mod/_core/framework/js/initializer.js` plus its stable `ext/_core/framework/initializer.js/...` files are the current reference example for JS start/end extension hooks
- `app/L0/_all/mod/_core/framework/js/moduleResolution.js` reads `meta[name="space-max-layer"]` and appends `maxLayer` to framework-managed `/mod/...` and `/api/extensions_load` requests
- `app/L0/_all/mod/_core/framework/js/runtime.js` now publishes the authenticated API client at `space.api`, the shared Alpine store factory at `space.fw.createStore`, and the lightweight YAML helpers at `space.utils.yaml`
- `server/pages/login.html` contains the public login submit flow inline, can create a guest account through `/api/guest_create`, exchanges credentials for a server session before redirecting to `/`, and should remain a minimal pre-auth shell rather than a source of broader app composition logic
- `/login` is public and should not depend on authenticated `/mod/...` assets; keep any pre-auth styling and assets local while staying aligned with the shared design system
- `/logout` is handled entirely by the server pages layer; there is no standalone logout page shell in `app/` or `server/pages/`
- the current frontend runtime tree starts at `/mod/_core/framework/js/initFw.js`, installs `space.extend` from `/mod/_core/framework/js/extensions.js`, runs extensible framework bootstrap functions such as `/mod/_core/framework/js/initializer.js`, and then continues composing further runtime behavior by module and extension point while preserving the existing `_core/framework/initializer.js/...` hook contract
- the next phase of frontend development should add new `_core` modules and new extension seams instead of growing page shells or concentrating more logic in `_core/chat`
- when app structure, layer behavior, module layout, entry shells, or frontend conventions change, update this file in the same session
