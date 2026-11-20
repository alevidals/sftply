import { PaletteIcon } from "lucide-react"
import type { CustomTheme } from "@/lib/ipc/bindings"
import { readAppliedThemeTokens } from "@/lib/theme"
import { THEME_OPTIONS, THEME_TOKEN_KEYS, type ThemeOption, themeOption } from "@/lib/themes"

/** Turn a loaded theme file into a gallery card. */
export function customThemeOption(theme: CustomTheme): ThemeOption {
  const colors = theme.colors
  return {
    value: theme.id,
    label: theme.name,
    description: "Custom theme",
    icon: PaletteIcon,
    dark: theme.dark,
    preview: {
      background: colors.background ?? "#1f2125",
      foreground: colors.foreground ?? "#f0f2f5",
      accent: colors.primary ?? "#7d7cf0",
    },
  }
}

export function allThemeOptions(themes: CustomTheme[]): ThemeOption[] {
  return [...THEME_OPTIONS, ...themes.map(customThemeOption)]
}

/** Serialize a theme for export, with the app's full semantic token set. */
export function themeExportText(
  name: string,
  dark: boolean,
  colors: Record<string, string>,
): string {
  const safeName = name.replace(/[\r\n"=]/g, "").trim() || "Custom theme"
  const lines = [`name = ${safeName}`, `variant = ${dark ? "dark" : "light"}`]
  for (const key of THEME_TOKEN_KEYS) {
    const value = colors[key]
    if (value) lines.push(`${key} = ${value}`)
  }
  return `${lines.join("\n")}\n`
}

/** Build the export for the theme currently applied to the document. */
export function currentThemeExport(
  themeId: string,
  themes: CustomTheme[],
): { name: string; dark: boolean; colors: Record<string, string> } {
  const custom = themes.find((theme) => theme.id === themeId)
  if (custom) {
    return {
      name: custom.name,
      dark: custom.dark,
      colors: { ...custom.colors },
    }
  }
  const effective =
    themeId === "system"
      ? document.documentElement.classList.contains("dark")
        ? "dark"
        : "light"
      : themeId
  return {
    name: themeOption(effective).label,
    dark: document.documentElement.classList.contains("dark"),
    colors: readAppliedThemeTokens(),
  }
}
