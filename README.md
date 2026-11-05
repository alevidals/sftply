# sftply

A modern, keyboard-first desktop client for FTP, FTPS and SFTP. Built with Tauri 2, React, TypeScript and Rust.

> **Status: architecture and design phase.** The repository currently contains the Tauri starter template. No product features have been implemented yet. The documents below define the approved scope before implementation begins.

## Design documents

- [Architecture](docs/ARCHITECTURE.md) — layers, module boundaries, IPC contract, security model, design system
- [Dependency evaluation](docs/DEPENDENCIES.md) — protocol libraries, Rust/frontend dependencies, rejected alternatives
- [Roadmap](docs/ROADMAP.md) — phased milestones with exit criteria
- [Progress log](docs/PROGRESS.md) — what is built, verified, and what comes next
- [ADRs](docs/adr/README.md) — architectural decision records

## Product direction

- Dual-pane local/remote file browser with a dense, calm interface inspired by Linear, VS Code, Raycast and Finder.
- Native Rust networking for FTP, explicit/implicit FTPS and SFTP. No system binaries.
- OS keychain for credentials, strict SSH host-key verification, and certificate validation for FTPS.
- A reliable, capability-aware transfer queue: no fake pause/resume, no optimistic "completed" states.
- Dark theme by default, first-class light theme.
- Typed Rust↔TypeScript boundary, strict TypeScript, tests for core logic and protocols.

## Stack

Tauri 2 · React 19 · TypeScript · Vite · Tailwind CSS v4 · shadcn/ui · Zustand · TanStack Query · React Hook Form + Zod · Rust · suppaftp · russh/russh-sftp · keyring

## Development

Prerequisites: Bun 1.4+, Rust 1.99+, platform Tauri dependencies.

```bash
bun install
bun run tauri dev
```

These commands run the current template. The product build, test and lint scripts will be introduced in Phase 0/1 as described in the roadmap.

## License

To be decided before distribution.
