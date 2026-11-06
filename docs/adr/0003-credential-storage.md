# ADR-0003: Credential storage

- **Status:** Proposed
- **Date:** 2026-11-05

## Context

The application stores connection profiles that may include passwords and private-key passphrases. Security requirements forbid plaintext secrets in configuration or logs and require OS credential storage. The frontend must never be able to read stored secrets.

## Decision

- Store secrets **only** in the OS credential store via `keyring 4`:
  - macOS Keychain
  - Windows Credential Manager
  - Linux Secret Service (D-Bus)
- Use service identifier `com.alevidals.sftply`, account keys:
  - `connection/<uuid>/password`
  - `connection/<uuid>/key_passphrase`
- Persist only non-secret metadata in `connections.json` (`hasPassphrase`, auth method, key path).
- Never expose a "get secret" Tauri command. `CredentialService` resolves secrets inside Rust only when opening a session or transfer connection.
- Accept transient secrets for Quick Connect / test; wrap them in `secrecy::SecretString` immediately and zeroize on drop.
- If the keychain is unavailable or locked, fail with `KEYCHAIN_UNAVAILABLE` and actionable guidance. **No plaintext or obfuscated fallback.**
- Deleting a connection deletes its keychain entries; a maintenance action removes orphaned entries.
- Export never includes secrets or private key material. Import never accepts them.
- Logs and errors redact secret fields; private keys and passphrases are never logged even at trace level.

## Consequences

**Positive**

- Secrets are protected by OS-level access control and unlocked with the user's login session.
- No custom cryptography or master password to lose.
- The webview never receives credentials after the initial submission.

**Negative / accepted**

- Linux requires a Secret Service provider; headless/minimal environments may not support saving passwords.
- Keychain access can prompt the user (macOS), especially after binary updates.
- Rust cannot guarantee every copied secret is zeroized; we minimize copies and document best-effort clearing.
- Keychain entries can drift if the app crashes; provide a cleanup/diagnostics action.

## Alternatives considered

- **Encrypted file with app-managed key:** the key must live somewhere; weaker than OS keychain.
- **Stronghold vault with master password:** viable as an explicit Linux fallback, but adds a second unlock UX. Deferred, not used silently.
- **Plain config / base64 / obfuscation:** unacceptable.
- **Session-only credentials (no storage):** poor usability for frequent connections; offered as a user choice instead.

## Validation

Phase 0 verifies store/read/delete on macOS and the failure path. Phase 3 adds integration tests that inspect written config, logs, and exports for secret leakage.
