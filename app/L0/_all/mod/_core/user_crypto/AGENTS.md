# AGENTS

## Purpose

`_core/user_crypto/` owns session-scoped frontend decryption state for user-encrypted values.

It is a headless core module. It restores the current login's unlocked user key from browser session cache, fails soft when the backend marks crypto missing or invalidated, and exposes the stable `space.utils.userCrypto` runtime used by feature modules that need to encrypt small per-user secrets before persisting them into app files. In `SINGLE_USER_APP=true`, it short-circuits into a frontend bypass mode instead of attempting login-bound crypto bootstrap.

Documentation is top priority for this module. After any change under `_core/user_crypto/`, update this file, the affected parent docs, and the matching supplemental docs in the same session.

## Ownership

This scope owns:

- `user-crypto.js`: browser session-cache restore, fail-soft encrypt/decrypt wrappers, password-rotation rewrap helper, and the exported runtime methods consumed through `space.utils.userCrypto`
- `ext/js/_core/framework/initializer.js/initialize/end/user-crypto.js`: authenticated bootstrap hook that restores the current login's unlocked user-crypto session before normal feature modules load

## Local Contracts

- the exported runtime surface is `space.utils.userCrypto`
- the module stores only session-scoped unlock state in `sessionStorage`; the persistent per-user wrapped key record stays in `~/meta/user_crypto.json`
- encrypted text payloads generated here must start with the literal `userCrypto:` prefix
- `decryptText(...)` must return plaintext unchanged when the input is not prefixed with `userCrypto:`, so legacy unencrypted values keep working during migration
- in `SINGLE_USER_APP=true`, `encryptText(...)` and `decryptText(...)` must return plaintext unchanged, `encryptBytes(...)` and `decryptBytes(...)` must return raw bytes unchanged, and the module must not attempt authenticated user-crypto bootstrap, logout recovery, or emit new `userCrypto:` payloads
- `decryptText(...)` returns `""` and `decryptBytes(...)` returns `new Uint8Array()` when crypto is unavailable, invalidated, or the payload does not decrypt with the active user key; those soft failures should log one concise `console.warn(...)` message instead of throwing through feature code
- when the authenticated backend reports `userCryptoState === "missing"`, bootstrap should first try one session-scoped recovery pass using the login page's temporary bootstrap secret and the authenticated `user_crypto_bootstrap` endpoint; if that recovery cannot run or fails, the authenticated bootstrap should sign the browser out so the next `/login` run can provision it cleanly
- when the backend reports `userCryptoState === "invalidated"`, bootstrap must not auto-regenerate a new user key because that would orphan previously encrypted values; the module should stay unavailable and warn instead
- password changes must reuse the current unlocked user master key and return a rewrapped `user_crypto.json` record for the new password without re-encrypting existing user data
- the browser session cache is keyed by backend session id plus username so multiple concurrent logins can keep separate unlocked session state without clobbering each other

## Development Guidance

- keep this module headless and runtime-focused
- keep actual crypto primitives in the shared browser helper served from `server/pages/res/user-crypto.js` so `/login` and authenticated app modules use the same envelope format and wrap derivation
- keep failure handling soft for callers and explicit in console output
- if the runtime namespace, session-cache format, bootstrap behavior, or `userCrypto:` envelope format changes, update this file, `/app/AGENTS.md`, `/app/L0/_all/mod/_core/framework/AGENTS.md`, and the matching docs under `_core/documentation/docs/`
