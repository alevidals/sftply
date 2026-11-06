# ADR-0001: Tauri 2 + React desktop stack

- **Status:** Proposed
- **Date:** 2026-11-05
- **Deciders:** Product/engineering (pending approval)

## Context

We need a cross-platform desktop FTP/FTPS/SFTP client with native networking, a modern UI, small footprint, and a strict security posture. The repository is already a Tauri 2 + React + TypeScript + Vite template.

## Decision

Use:

- **Tauri 2** for the desktop shell, native window integration, and Rust↔webview IPC.
- **React 19 + TypeScript (strict) + Vite** for the UI.
- **Tailwind CSS v4 + shadcn/ui (Radix)** for the design system.
- **Zustand** for client state and **TanStack Query** for server-derived state.
- **Rust** for all networking, filesystem access, credentials, and transfer orchestration.
- **tauri-specta** to generate typed command/event bindings from Rust.

## Consequences

**Positive**

- Small runtime and memory footprint compared with Electron; native Rust protocols without sidecar processes.
- Strong separation: no network or filesystem credentials in the webview.
- One language for the backend domain and a mature React ecosystem for a polished UI.
- Typed IPC removes an entire class of contract drift.

**Negative / accepted**

- WebView differences across platforms (drag-and-drop, CSS, IME) require real-device testing.
- Rust compile times add friction; mitigated with incremental builds and CI caching.
- Tauri capability/CSP configuration is security-critical and must be reviewed.
- Generated bindings add a build step; CI enforces regeneration.

## Alternatives considered

| Alternative        | Why rejected                                                                                 |
| ------------------ | -------------------------------------------------------------------------------------------- |
| Electron + Node    | Larger footprint; networking/credentials in JS; weaker native isolation                      |
| Flutter desktop    | Strong UI, but less mature Linux desktop story and a weaker fit with the Rust protocol layer |
| Native Swift/WinUI | Not cross-platform; disproportionate effort for one product                                  |
| Browser-only/PWA   | Cannot safely implement FTP/SFTP or OS keychain access                                       |

## Notes

- No Tauri `fs`, `shell`, or `http` plugins. The webview gets only minimal window/dialog/opener capabilities.
- Product UI is a single-window workspace; React Router is intentionally omitted.
