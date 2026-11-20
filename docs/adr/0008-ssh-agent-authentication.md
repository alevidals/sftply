# ADR-0008: SSH agent authentication for SFTP

- **Status:** Accepted
- **Date:** 2026-11-20

## Context

SFTP supports password and private-key authentication. The key flow asks for an
absolute key path and, when the key is encrypted, stores its passphrase in the
OS keychain. Users who rely on `ssh-agent`, 1Password, Secretive, KeePassXC or
the Windows OpenSSH agent already have their keys unlocked in a process outside
sftply. Reading the key file again duplicates that setup and asks users to keep
key material or passphrases in a second place.

## Decision

1. Add an `agent` authentication kind, valid only for SFTP. FTP and FTPS keep
   password authentication only.
2. Delegate signing to the local agent through `russh`'s agent client. sftply
   lists the loaded identities and tries them until the server accepts one. It
   never reads the private key and stores no secret for this auth kind.
3. Discover the agent through `SSH_AUTH_SOCK` on macOS and Linux. On macOS, fall
   back to the login session's `launchctl` environment when a Finder-launched app
   did not inherit the shell variable. On Windows, try the OpenSSH named pipe
   and then Pageant.
4. Keep password and private-key authentication unchanged. Switching a saved
   connection to the agent removes any password or passphrase previously stored
   for it.
5. Surface agent failures separately from server rejections: missing agent,
   no identities, locked agent/signing failure, and every identity rejected.

## Consequences

**Positive**

- Keys protected by a passphrase or hardware token can be used without copying
  them into sftply or the keychain.
- The user unlocks the agent once, in the tool that already manages the key.
- No new secret is written to disk for agent connections.

**Negative / accepted**

- Authentication now depends on an external process. If the agent is stopped or
  locked, the connection fails until the user fixes it.
- A GUI app may not inherit a shell-only agent on macOS; the launchd fallback
  covers the common case, and the key-file flow remains available.
- Trying every identity can produce several authentication attempts on servers
  with many loaded keys. This matches OpenSSH's behaviour and avoids a separate
  identity picker.
- Tests cover validation and the UI; full agent authentication still needs
  manual QA against a real agent and server on each platform.
