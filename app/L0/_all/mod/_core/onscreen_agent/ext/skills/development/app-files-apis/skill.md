---
name: App Files And APIs
description: Use the frontend API surface correctly for app files, discovery, identity, and permission-aware browser data access.
---

Use this skill when frontend code needs to read or write app files, inspect the current user, discover files by pattern, or call backend endpoints from the browser.

## Core Frontend API Surface

The shared frontend runtime exposes authenticated backend helpers through `space.api`.

Current wrapped helpers include:

- `await space.api.fileList(path, recursive)`
- `await space.api.fileRead(pathOrFiles, encoding?)`
- `await space.api.fileWrite(pathOrFiles, content?, encoding?)`
- `await space.api.fileDelete(pathOrPaths)`
- `await space.api.fileCopy(pathOrEntries, toPath?)`
- `await space.api.fileMove(pathOrEntries, toPath?)`
- `await space.api.fileInfo(pathOrOptions)`
- `space.api.folderDownloadUrl(pathOrOptions)`
- `await space.api.userSelfInfo()`
- `await space.api.call("endpoint_name", { method, query, body, headers, signal })`

Use `space.api.folderDownloadUrl(...)` when the browser should trigger a regular authenticated folder download without buffering the ZIP file into frontend memory first.

When a UI needs user-visible download failure feedback without fetching the archive blob into memory, preflight the request with `space.api.fileInfo(...)` for files or `space.api.call("folder_download", { method: "HEAD", query: { path } })` for folders before starting the browser download.

## Logical Path Rules

- Use logical app-rooted paths such as `L2/alice/user.yaml`, not disk paths.
- `~` and `~/...` target the authenticated user's `L2/<username>/...` path.
- These logical paths do not change when writable storage moves under `CUSTOMWARE_PATH`.
- `fileWrite(".../")` creates a directory because the path ends with `/`.

## Discovery Rules

- Use permission-aware APIs, not ad hoc browser path guesses.
- Use `space.api.call("file_paths", { method: "POST", body: { patterns: [...] } })` for indexed glob discovery.
- Use `space.api.call("module_list", ...)` only when you need module inventory metadata rather than raw file paths.
- Use `space.api.call("extensions_load", ...)` only when you are working on framework-level extension resolution behavior.

## Storage Rules

- Browser storage is for small non-authoritative UI state.
- Persistent user or group state should live in app files or explicit backend APIs.
- Use `space.config` only for frontend-exposed runtime params, not for general persistence.

## Identity Snapshot

- `space.api.userSelfInfo()` returns `{ username, fullName, groups, managedGroups, isAdmin, scope }`.
- `scope.frontend.repoRoots` identifies the frontend repo tree (`app`).
- `scope.frontend.readableRoots` and `scope.frontend.readableModuleRoots` are the current readable logical app roots.
- `scope.frontend.writableRoots` and `scope.frontend.writableModuleRoots` are the exact writable logical roots for the current user without relying on admin wildcards.
- `scope.frontend.preferredWritableModuleRoots` lists the safest module roots to use first for new frontend work.
- `scope.frontend.writableRootPatterns` and `scope.frontend.writableModuleRootPatterns` describe broader admin-only write scope such as `L1/<group>/` or `L2/<user>/mod/`.
- `scope.frontend.readOnlyLayers` and `scope.frontend.writableLayers` make the `L0` versus `L1` or `L2` boundary explicit.
- `scope.backend.repoRoots` names the backend-owned top-level trees, and `scope.backend.editable` is `false`; treat `server`, `commands`, and `packaging` as read-only from this frontend skill set.

## Boundary Rule

- This skill is for consuming backend APIs from the frontend.
- Do not change backend handlers from this skill set; load `development/backend-reference` when you need the read-only backend model behind these APIs.

## Mandatory Doc Follow-Up

- If the frontend API surface, app-file path rules, or indexed discovery behavior change, update the mirrored docs and the `development` skill subtree in the same session.
