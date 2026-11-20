# ADR-0009: Custom themes from files

- **Status:** Accepted
- **Date:** 2026-11-20

## Context

Built-in themes are compiled as `[data-theme="..."]` blocks in `globals.css`.
That keeps the first paint fast and makes contrast tests straightforward, but it
does not allow users to add or share themes. The requested flow is file-based:
import/export from Settings, or drop a theme into a folder.

The app uses semantic tokens such as `card`, `sidebar`, `muted` and `destructive`,
not just the 16 ANSI colors used by terminal themes. A custom file may therefore
contain a full palette or only a background, foreground and ANSI palette.

## Decision

1. `settings.theme` is a string id. Built-in ids keep their current names; custom
   themes use `custom:<file-stem>`.
2. Built-in themes remain compiled CSS. Custom themes are loaded from the app
   config `themes/` directory by the Rust side and returned to the frontend.
3. Theme files use flat `key = value` lines. `background` and `foreground` are
   required. Known semantic tokens, ANSI `palette.N` entries and terminal aliases
   (`cursor-*`, `selection-*`, `split-divider-color`) are accepted. Unknown keys
   are ignored, and invalid colors or files are skipped with a warning.
4. The frontend fills missing semantic tokens from the background, foreground and
   palette, then applies the complete set as inline CSS variables. Built-in
   themes remove those inline variables and use their CSS block.
5. Settings → Appearance lists custom themes next to built-ins and offers Import,
   Export, Reload and open-folder actions. The selected custom theme is cached in
   local storage so the bootstrap script can paint it before React starts.
6. There is no file watcher and no in-app theme editor in this iteration.

## Consequences

**Positive**

- Users can add, share and version themes without rebuilding the app.
- Full-token exports round-trip; minimal files get usable defaults.
- Built-in themes keep their current startup performance and contrast tests.

**Negative / accepted**

- Two application paths exist: compiled built-ins and inline custom variables.
- Custom themes are not covered by the built-in WCAG contrast audit.
- A deleted or invalid custom theme falls back to the dark palette.
- Moving all built-ins to the file model remains possible later without changing
  the user-facing format.
