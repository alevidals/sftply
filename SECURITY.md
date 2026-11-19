# Security policy

## Supported versions

| Version | Supported |
| ------- | --------- |
| 1.x     | Yes       |

The latest 1.x release receives fixes.

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

## Unsigned (ad-hoc) builds

There is no Apple Developer account or Developer ID certificate and no Windows
code-signing certificate, so releases are **not signed for distribution**.

- macOS builds are ad-hoc signed, so Apple Silicon runs them, but Gatekeeper asks
  for confirmation on first launch. Ad-hoc signing is not Developer ID signing
  and does not notarize the app.
- Windows builds are unsigned and trigger SmartScreen until the file builds up
  reputation.

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
