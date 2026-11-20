import type { CustomTheme } from "@/lib/ipc/bindings"
import { THEME_TOKEN_KEYS, themeIsDark } from "@/lib/themes"

export type EffectiveTheme = "dark" | "light"

export interface ResolvedTheme {
  /** Concrete id applied to `<html data-theme>`. Custom themes use `custom`. */
  id: string
  /** Selected settings id, which for custom themes is `custom:<file>`. */
  themeId: string
  dark: boolean
  /** Full CSS custom-property map for a custom theme. Built-ins use their CSS block. */
  colors?: Record<string, string>
}

export const THEME_STORAGE_KEY = "sftply.theme"
export const CUSTOM_THEME_STORAGE_KEY = "sftply.custom-theme"
export const DENSITY_STORAGE_KEY = "sftply.density"

export function resolveTheme(
  mode: string,
  prefersDark: boolean,
  customThemes: CustomTheme[] = [],
): ResolvedTheme {
  if (mode === "system") {
    return { id: prefersDark ? "dark" : "light", themeId: mode, dark: prefersDark }
  }
  const custom = customThemes.find((theme) => theme.id === mode)
  if (custom) {
    return {
      id: "custom",
      themeId: custom.id,
      dark: custom.dark,
      colors: { ...custom.colors },
    }
  }
  return { id: mode, themeId: mode, dark: themeIsDark(mode) }
}

let appliedCustomTokens: string[] = []

/** Apply the theme class, palette id and color-scheme to `<html>`. */
export function applyDocumentTheme(theme: ResolvedTheme, options?: { cache?: boolean }): void {
  const root = document.documentElement
  root.classList.toggle("dark", theme.dark)
  root.dataset.theme = theme.colors ? "custom" : theme.id
  root.style.colorScheme = theme.dark ? "dark" : "light"

  for (const key of appliedCustomTokens) {
    root.style.removeProperty(`--${key}`)
  }
  appliedCustomTokens = []

  if (theme.colors) {
    for (const [key, value] of Object.entries(theme.colors)) {
      root.style.setProperty(`--${key}`, value)
      appliedCustomTokens.push(key)
    }
    if (options?.cache !== false) rememberCustomTheme(theme)
  } else {
    forgetCustomTheme()
  }
}

export function applyDocumentDensity(density: "compact" | "comfortable"): void {
  document.documentElement.dataset.density = density
}

/**
 * Mirror non-secret appearance preferences so the bootstrap script can paint the
 * correct theme before React (and the Rust settings file) loads.
 */
export function rememberAppearance(theme: string, density: "compact" | "comfortable"): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme)
    localStorage.setItem(DENSITY_STORAGE_KEY, density)
  } catch {
    // Storage can be unavailable in hardened webviews; appearance still works.
  }
}

function rememberCustomTheme(theme: ResolvedTheme): void {
  try {
    localStorage.setItem(
      CUSTOM_THEME_STORAGE_KEY,
      JSON.stringify({ id: theme.themeId, dark: theme.dark, colors: theme.colors }),
    )
  } catch {
    // The theme still applies for this session.
  }
}

function forgetCustomTheme(): void {
  try {
    localStorage.removeItem(CUSTOM_THEME_STORAGE_KEY)
  } catch {
    // Storage can be unavailable.
  }
}

/** Read the currently applied color tokens for a lossless theme export. */
export function readAppliedThemeTokens(): Record<string, string> {
  const style = getComputedStyle(document.documentElement)
  const colors: Record<string, string> = {}
  for (const key of THEME_TOKEN_KEYS) {
    const value = style.getPropertyValue(`--${key}`).trim()
    if (value) colors[key] = value
  }
  return colors
}
