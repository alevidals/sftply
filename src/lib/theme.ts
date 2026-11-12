import type { ThemeMode } from "@/lib/ipc/bindings"
import { themeIsDark } from "@/lib/themes"

export type EffectiveTheme = "dark" | "light"

export interface ResolvedTheme {
  /** Concrete theme id applied to `<html data-theme>` (never `system`). */
  id: ThemeMode
  dark: boolean
}

export const THEME_STORAGE_KEY = "sftply.theme"
export const DENSITY_STORAGE_KEY = "sftply.density"

export function resolveTheme(mode: ThemeMode, prefersDark: boolean): ResolvedTheme {
  if (mode === "system") {
    return { id: prefersDark ? "dark" : "light", dark: prefersDark }
  }
  return { id: mode, dark: themeIsDark(mode) }
}

/** Apply the theme class, palette id and color-scheme to `<html>`. */
export function applyDocumentTheme(theme: ResolvedTheme): void {
  const root = document.documentElement
  root.classList.toggle("dark", theme.dark)
  root.dataset.theme = theme.id
  root.style.colorScheme = theme.dark ? "dark" : "light"
}

export function applyDocumentDensity(density: "compact" | "comfortable"): void {
  document.documentElement.dataset.density = density
}

/**
 * Mirror non-secret appearance preferences so the bootstrap script can paint
 * the correct theme before React (and the Rust settings file) loads.
 */
export function rememberAppearance(theme: ThemeMode, density: "compact" | "comfortable"): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme)
    localStorage.setItem(DENSITY_STORAGE_KEY, density)
  } catch {
    // Storage can be unavailable in hardened webviews; appearance still works.
  }
}
