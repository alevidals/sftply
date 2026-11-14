# Security policy

## Supported versions

| Version | Supported |
| ------- | --------- |
| 0.1.x   | Yes       |

Pre-1.0 builds receive fixes on the latest release only.

## Reporting a vulnerability

Use GitHub's private vulnerability reporting: **Security → Report a
vulnerability** in this repository. Do not open a public issue for a security
problem.

Please include the affected version, the platform, the protocol involved (FTP,
FTPS or SFTP) and reproduction steps. You can expect an acknowledgement within a
few days.

## Scope

In scope: protocol handling, credential storage, host-key and certificate
verification, the local file writer, the IPC boundary and anything that could
leak a password, passphrase or private key.

Out of scope: the absence of an OS code-signing certificate (see below),
vulnerabilities in servers you connect to, and anything that requires an
already-compromised machine.

## Unsigned builds

Releases are **not** signed with an Apple Developer ID nor a Windows code-signing
certificate. That is a deliberate trade-off, not a bug:

- macOS builds are ad-hoc signed, so Apple Silicon runs them, but Gatekeeper
  asks for confirmation on first launch.
- Windows builds trigger SmartScreen until the file build up reputation.

`SHA256SUMS` is published with every release so you can verify what you
downloaded. Verify it before running a build from an unexpected mirror.

## Dependency audits

`cargo audit` and `bun audit --production` run weekly and on dependency changes
(`.github/workflows/security.yml`). Accepted advisories are documented in
`src-tauri/.cargo/audit.toml` with the reason and the condition for removing
them.

## Secrets

Passwords and passphrases are stored in the OS keychain. Logs are redacted,
exports never include credentials, and the frontend never receives stored
secrets. If you find a path that violates this, treat it as a security report.
