# AGENTS

## Purpose

`_core/onscreen_menu/` owns the routed top-right page menu.

It is a thin shell extension that mounts into the router shell, exposes the Dashboard and Admin actions, conditionally exposes Logout when cookie-backed auth is active, and preserves the current routed URL when jumping into `/admin`.

Documentation is top priority for this module. After any change under `_core/onscreen_menu/`, update this file and any affected parent docs in the same session.

## Ownership

This module owns:

- `ext/html/_core/router/shell_start/menu.html`: thin shell-start extension
- `onscreen-menu.css`: menu-specific styling layered on the shared topbar primitives

## Current Contract

Current behavior:

- the menu mounts through `_core/router/shell_start`
- the Dashboard action returns the app shell to `#/dashboard`
- the Admin action builds `/admin?url=<current-path-search-hash>` so the admin iframe opens on the current app location
- navigation prefers `window.top` and falls back to the current window
- when the routed app is embedded inside the `/admin` split-view iframe, the Dashboard action stays in the current iframe instead of navigating the top-level admin shell away
- the Logout action is hidden when frontend config reports `SINGLE_USER_APP=true`
- the Leave action is shown when frontend config reports `SINGLE_USER_APP=true`
- when shown, Logout navigates to `/logout`
- when shown, Leave clears the current tab's launcher-access grant and navigates to `/enter`

## Development Guidance

- keep this module thin; it should stay a routed shell affordance, not a second app shell
- prefer shared topbar and menu styles from `_core/visual/chrome/topbar.css`
- if the router shell seam or admin handoff contract changes, update this file and the router or admin docs too
