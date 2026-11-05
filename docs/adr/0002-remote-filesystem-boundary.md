# ADR-0002: Unified remote filesystem boundary and protocol libraries

- **Status:** Proposed (subject to Phase 0 spikes)
- **Date:** 2026-11-05

## Context

The product must support FTP, explicit FTPS, implicit FTPS and SFTP through one UI. Protocol behavior differs materially: FTP is command/response over separate data connections, FTPS adds TLS policy, SFTP is a channel multiplexed over SSH with Unix-like attributes. Features such as resume, chmod and server-side copy are not uniformly available.

## Decision

1. Define our own async `FileSystem` abstraction with:
   - `FsCapabilities` negotiated per connection.
   - Explicit `FileReader`/`FileWriter` handles with `finish()`/`abort()` so protocol finalization is part of success.
   - Validated `RemotePath`/`LocalPath` types; no raw strings reaching protocol calls.
2. Implement FTP/FTPS with **suppaftp 12** (Tokio + rustls), using a custom TLS connector for certificate policy.
3. Implement SFTP with **russh 0.65 + russh-sftp 3.0.1**, pure Rust, with our own strict known_hosts store.
4. Keep protocol clients inside session actors; transfers create dedicated FTP control connections or additional SFTP channels.
5. Never shell out to system binaries.

## Consequences

**Positive**
- UI is protocol-agnostic and driven by real capabilities.
- Unsupported operations can be disabled honestly.
- Protocol-specific quirks stay in isolated, testable modules.
- No C/OpenSSL dependency for SSH; smaller and more portable builds.

**Negative / accepted**
- We own the abstraction, capability matrix, and finalization semantics.
- russh is 0.x and has API churn; versions must be pinned and upgrades tested against OpenSSH.
- suppaftp's implicit FTPS API is behind a `deprecated` feature (protocol deprecation); enabled deliberately.
- We implement known_hosts and TLS policy ourselves, which is security-critical code needing tests.

## Alternatives considered

- **ssh2/libssh2:** mature but blocking; requires a thread pool and C/OpenSSL toolchain; worse async streaming fit. Fallback only if russh fails validation.
- **System `ssh`/`sftp`/`lftp`:** prohibited, inconsistent, introduces injection/process-management risk.
- **One third-party unified remote-FS crate:** none provides a credible, maintained capability model across FTP/FTPS/SFTP.
- **Protocol-specific UI branches:** rejected; would leak business logic into React and make capabilities inconsistent.

## Validation

Phase 0 must prove: explicit/implicit FTPS with verification and pinning; MLSD and LIST-only listings; resume/abort; SFTP password/key/passphrase auth; known-host flows; chmod; concurrent channels; >4 GiB transfers. Any change to this decision requires a new ADR.
