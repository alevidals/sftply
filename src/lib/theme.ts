import type { ThemeMode } from "@/lib/ipc/bindings"

export type EffectiveTheme = "dark" | "light"

export const THEME_STORAGE_KEY = "sftply.theme"
export const DENSITY_STORAGE_KEY = "sftply.density"

export function resolveTheme(mode: ThemeMode, prefersDark: boolean): EffectiveTheme {
  if (mode === "system") return prefersDark ? "dark" : "light"
  return mode
}

/** Apply the theme class and color-scheme to `<html>`. */
export function applyDocumentTheme(theme: EffectiveTheme): void {
  const root = document.documentElement
  root.classList.toggle("dark", theme === "dark")
  root.style.colorScheme = theme
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
