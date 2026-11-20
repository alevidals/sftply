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
      colors: resolveCustomThemeColors(custom),
    }
  }
  return { id: mode, themeId: mode, dark: themeIsDark(mode) }
}

let appliedCustomTokens: string[] = []

/** Apply the theme class, palette id and color-scheme to `<html>`. */
export function applyDocumentTheme(theme: ResolvedTheme): void {
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
    rememberCustomTheme(theme)
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

/**
 * Fill a custom theme's missing semantic tokens from its background, foreground
 * and optional ANSI palette. Explicit tokens always win.
 */
export function resolveCustomThemeColors(theme: CustomTheme): Record<string, string> {
  const source = theme.colors
  const background = source.background ?? "#1f2125"
  const foreground = source.foreground ?? "#f0f2f5"
  const palette = (index: number) => source[`palette.${index}`]
  const mix = (color: string, percent: number) =>
    `color-mix(in oklab, ${color} ${percent}%, ${background})`
  const alpha = (color: string, percent: number) =>
    `color-mix(in oklab, ${color} ${percent}%, transparent)`
  const primary = source.primary ?? palette(4) ?? source["cursor-color"] ?? foreground
  const border = source.border ?? mix(foreground, 18)
  const derived: Record<string, string> = {
    background,
    foreground,
    card: mix(foreground, 5),
    "card-foreground": foreground,
    popover: mix(foreground, 7),
    "popover-foreground": foreground,
    primary,
    "primary-foreground": background,
    secondary: mix(foreground, 10),
    "secondary-foreground": foreground,
    muted: mix(foreground, 8),
    "muted-foreground": mix(foreground, 55),
    accent: mix(foreground, 14),
    "accent-foreground": foreground,
    destructive: source.destructive ?? palette(1) ?? "#e06c75",
    border,
    input: source.input ?? mix(foreground, 22),
    ring: primary,
    "chart-1": palette(4) ?? primary,
    "chart-2": palette(6) ?? source.info ?? "#56b6c2",
    "chart-3": palette(2) ?? source.success ?? "#98c379",
    "chart-4": palette(3) ?? source.warning ?? "#e5c07b",
    "chart-5": palette(1) ?? source.destructive ?? "#e06c75",
    sidebar: mix(foreground, 2),
    "sidebar-foreground": foreground,
    "sidebar-primary": primary,
    "sidebar-primary-foreground": background,
    "sidebar-accent": mix(foreground, 10),
    "sidebar-accent-foreground": foreground,
    "sidebar-border": border,
    "sidebar-ring": primary,
    chrome: mix(foreground, 1),
    "chrome-foreground": foreground,
    "panel-header": mix(foreground, 3),
    "row-hover": alpha(foreground, 5),
    "row-selected": alpha(primary, 16),
    success: source.success ?? palette(2) ?? "#98c379",
    warning: source.warning ?? palette(3) ?? "#e5c07b",
    info: source.info ?? palette(6) ?? "#56b6c2",
  }

  // Terminal-friendly aliases.
  if (!source.border && source["split-divider-color"]) {
    derived.border = source["split-divider-color"]
    derived["sidebar-border"] = source["split-divider-color"]
  }
  if (source["selection-background"]) {
    derived["row-selected"] = source["selection-background"]
  }
  if (source["cursor-text"]) {
    derived["primary-foreground"] = source["cursor-text"]
  }

  return { ...derived, ...source }
}
