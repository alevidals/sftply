# Contributing to sftply

Thanks for taking the time to improve sftply. Bug reports, fixes, tests,
documentation and theme work are welcome.

This project follows the [Code of Conduct](CODE_OF_CONDUCT.md). By
participating, you agree to uphold it.

## Before you open a pull request

- Open an issue first for a bug fix that touches more than a few lines, and for
  any new feature. Agreeing on the scope avoids work that cannot be merged.
- Report security issues through GitHub's private vulnerability reporting, as
  described in [SECURITY.md](SECURITY.md). Do not open a public issue.
- Typo fixes and small documentation corrections can go straight to a pull
  request.

## Set up the project

Use the versions pinned in `.bun-version` and `rust-toolchain.toml`. You also
need the platform dependencies listed in the
[Tauri prerequisites](https://v2.tauri.app/start/prerequisites/).

```bash
git clone https://github.com/alevidals/sftply.git
cd sftply
bun install
bun run tauri dev
```

The landing page is a separate Bun project under `web/`:

```bash
bun run web:dev
bun run web:build
```

## Branches

`main` is the stable 1.x line. Fixes branch from `main` and target `main`:

```bash
git switch -c fix/transfer-resume
```

The next major line lives on the `v2` branch when it exists. Work for it
branches from `v2` and targets `v2`:

```bash
git switch v2
git switch -c feat/sync-plan
```

Do not mix a v1 fix and a v2 feature in one pull request. Maintainers merge
`main` into `v2` after every v1 patch so v2 receives the fix. If v2 rewrote the
affected code, port the test and the behavior instead of forcing the merge. The
full policy is in [docs/RELEASE.md](docs/RELEASE.md#branching-and-maintenance).

## Checks

Run the checks that cover your change before you open a pull request:

```bash
bun run check          # typecheck, Biome, Vitest and production build
bun run rust:lint      # rustfmt and clippy with warnings as errors
bun run rust:test      # Rust unit tests
bun run web:check      # Astro checks, when web/ changed
```

Protocol changes should also pass the integration stack. It builds four Docker
services and runs the ignored Rust tests against them:

```bash
tests/integration/run.sh
```

`bun run bindings` rewrites `src/lib/ipc/bindings.ts`. Run it and commit the
result when you change a Tauri command, event or type.

## Code style

- TypeScript and CSS are formatted and linted by Biome. Rust uses rustfmt and
  clippy.
- Keep changes focused. A pull request that fixes a bug should not also rename
  unrelated files.
- UI changes need to work in the light, dark and named themes, with a visible
  focus ring and keyboard access to the main actions.
- Add a test for behavior changes. Bug fixes should include a test that fails
  before the fix when the behavior can be tested.
- Do not log credentials, passphrases or file contents. Follow the existing
  redaction rules in the Rust logging module.
- Use conventional commit prefixes such as `feat:`, `fix:`, `docs:`, `test:` and
  `chore:`.

## Pull requests

- Describe the problem and the behavior change, not only the files touched.
- Include a screenshot or recording for UI changes.
- List the checks you ran.
- Keep the pull request in draft until the checks pass if you want early
  feedback.

Maintainers review for correctness, security and scope. If a change is out of
scope, they will explain why.

## Reporting bugs

Include the sftply version, operating system, protocol (FTP, FTPS or SFTP), the
server software when known, and the steps to reproduce. Redact hostnames,
usernames, paths and credentials.

## License

By contributing, you agree that your contribution is licensed under the MIT
license in [LICENSE](LICENSE).
