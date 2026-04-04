# AGENTS

## Purpose

`packaging/` contains native app hosts and the packaging surface around them.

Keep this file scoped to native hosting and packaging behavior. Repo-wide packaging surface and install commands still belong in `/AGENTS.md`.

This is one of the five core docs. It owns the packaging subtree contract. If platform-specific packaging areas later grow their own `AGENTS.md` files, those local docs should own the detailed implementation guidance while this file stays focused on packaging-wide structure and principles.

Documentation is top priority for this area. After any change under `packaging/` or any packaging contract change owned here, update this file in the same session before finishing.

## Documentation Hierarchy

`/packaging/AGENTS.md` stays the packaging-wide doc until a host surface, platform subtree, or packaging helper area grows its own `AGENTS.md`.

If that happens:

- this file should keep packaging-wide structure, shared principles, and cross-platform rules
- the child doc should own the exact host, platform, bridge, or build-helper contract
- update both docs when a packaging-wide rule and a local implementation contract change together

## How To Document Packaging Child Docs

Future packaging docs should keep the same section spine:

- `Purpose`
- `Ownership`
- `Host Or Build Contract`
- `Platform Or Bridge Contract` when that distinction exists
- `Development Guidance`

Required coverage:

- the startup lifecycle between the native host and the local server runtime
- any preload or native bridge APIs exposed to browser code and who may call them
- packaging scripts, assets, metadata, and platform-specific files owned by that subtree
- what must stay thin host glue versus what must remain in `app/` or `server/`
- platform-specific divergence only where it is real; shared behavior should stay documented here

## Current State

`packaging/desktop/` holds the current Electron desktop host.

`packaging/desktop/preload.js` exposes the desktop bridge as `spaceDesktop`.

`packaging/package.json` holds packaging-only dependencies so the root install can stay lean, and packaging scripts must treat that file as the authoritative Electron version and distribution source for native builds.

`packaging/scripts/` holds packaging entrypoints and shared build helpers. Multiword operation entrypoints use object-first hyphen naming such as `host-package.js`, `linux-package.js`, and `desktop-dev-run.js`.

`packaging/resources/` holds shared packaging resources.

`packaging/platforms/` holds OS-specific packaging assets and metadata.

Native hosts should remain thin:

- start the local server runtime
- open the browser app inside the host surface
- native host startup code must await async server-factory work before reading runtime fields such as `host`, `port`, `server`, or `watchdog`, and host shutdown paths must tolerate partial startup failure
- packaged desktop builds must keep the app tree unpacked on disk instead of wrapping it in `app.asar`, because the server watchdog and app-file indexing layers depend on watching real directories under the bundled project tree
- packaged desktop builds may add packaging-owned runtime param overrides when the native host contract requires them; the current Electron host forces `SINGLE_USER_APP=true` only for packaged apps, opens `/enter` as the recovery-safe splash entry when single-user mode is active, and source-checkout desktop dev runs keep normal runtime auth behavior
- preserve platform-neutral behavior here when possible

## Guidance

- avoid moving app logic into native hosts
- keep packaging automation in `packaging/scripts/`
- keep multiword packaging script filenames object-first so related entrypoints sort together
- keep platform-specific packaging details in `packaging/platforms/`
- add future mobile-specific hosts alongside `packaging/desktop/`
- when native host behavior, preload bridges, packaging assets, or packaging entrypoints change, update this file in the same session
