# ADR-0009: Custom themes from files

- **Status:** Accepted
- **Date:** 2026-11-20

## Context

Built-in themes are compiled as `[data-theme="..."]` blocks in `globals.css`.
That keeps the first paint fast and makes contrast tests straightforward, but it
does not allow users to add or share themes. The requested flow is file-based:
import/export from Settings, or drop a theme into a folder.

The app uses semantic tokens such as `card`, `sidebar`, `muted` and `destructive`,
not just the 16 ANSI colors used by terminal themes. Deriving missing values
would silently invent colors the user did not choose, so the format keeps every
token explicit.

## Decision

1. `settings.theme` is a string id. Built-in ids keep their current names; custom
   themes use `custom:<file-stem>`.
2. Built-in themes remain compiled CSS. Custom themes are loaded from the app
   config `themes/` directory by the Rust side and returned to the frontend.
3. Theme files are TOML with flat `key = "value"` lines and contain only the app's semantic
   tokens. ANSI palettes, terminal aliases and inheritance are not supported.
   Every token is required; an unknown key, a missing token or an invalid color
   rejects the file with a warning.
4. The frontend applies the file's colors exactly as inline CSS variables.
   Built-in themes remove those inline variables and use their CSS block.
5. Settings → Appearance lists custom themes next to built-ins and offers Import,
   Export, Edit, Reload and open-folder actions. Edit opens the file in the
   system editor. The selected custom theme is cached in local storage so the
   bootstrap script can paint it before React starts.
6. There is no file watcher and no in-app theme editor in this iteration.

## Consequences

**Positive**

- Users can add, share and version themes without rebuilding the app.
- A file renders exactly what it declares; nothing is filled in behind their back.
- Full-token exports round-trip, and exported built-ins are valid templates.
- Built-in themes keep their current startup performance and contrast tests.

**Negative / accepted**

- Two application paths exist: compiled built-ins and inline custom variables.
- Theme files are longer because every token is explicit.
- Custom themes are not covered by the built-in WCAG contrast audit.
- A deleted or invalid custom theme falls back to the dark palette.
- Moving all built-ins to the file model remains possible later without changing
  the user-facing format.
