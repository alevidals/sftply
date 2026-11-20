import {
  CatIcon,
  FlameIcon,
  GhostIcon,
  type LucideIcon,
  MonitorIcon,
  MoonIcon,
  MoonStarIcon,
  PaletteIcon,
  SnowflakeIcon,
  SunIcon,
  SunMediumIcon,
  TerminalIcon,
} from "lucide-react"
/** Theme ids in the order they are offered in the UI. */
export const THEME_VALUES = [
  "system",
  "dark",
  "light",
  "oneDark",
  "gruvboxDark",
  "gruvboxLight",
  "nord",
  "dracula",
  "solarizedLight",
  "tokyoNight",
  "catppuccinMocha",
] as const

export interface ThemePreview {
  background: string
  foreground: string
  accent: string
}

export interface ThemeOption {
  value: string
  label: string
  description: string
  icon: LucideIcon
  /** Whether the palette needs the `.dark` class for Tailwind variants. */
  dark: boolean
  preview: ThemePreview
}

export const THEME_OPTIONS: readonly ThemeOption[] = [
  {
    value: "system",
    label: "System",
    description: "Follow the OS",
    icon: MonitorIcon,
    dark: true,
    preview: { background: "#282c34", foreground: "#abb2bf", accent: "#61afef" },
  },
  {
    value: "dark",
    label: "Dark",
    description: "sftply dark",
    icon: MoonIcon,
    dark: true,
    preview: { background: "#1f2125", foreground: "#f0f2f5", accent: "#7d7cf0" },
  },
  {
    value: "light",
    label: "Light",
    description: "sftply light",
    icon: SunIcon,
    dark: false,
    preview: { background: "#f7f8fa", foreground: "#2b2f36", accent: "#5b57d1" },
  },
  {
    value: "oneDark",
    label: "One Dark",
    description: "Atom's classic",
    icon: TerminalIcon,
    dark: true,
    preview: { background: "#282c34", foreground: "#abb2bf", accent: "#61afef" },
  },
  {
    value: "gruvboxDark",
    label: "Gruvbox Dark",
    description: "Warm and retro",
    icon: FlameIcon,
    dark: true,
    preview: { background: "#282828", foreground: "#ebdbb2", accent: "#fabd2f" },
  },
  {
    value: "gruvboxLight",
    label: "Gruvbox Light",
    description: "Warm paper",
    icon: PaletteIcon,
    dark: false,
    preview: { background: "#fbf1c7", foreground: "#3c3836", accent: "#b57614" },
  },
  {
    value: "nord",
    label: "Nord",
    description: "Arctic blues",
    icon: SnowflakeIcon,
    dark: true,
    preview: { background: "#2e3440", foreground: "#d8dee9", accent: "#88c0d0" },
  },
  {
    value: "dracula",
    label: "Dracula",
    description: "Vivid purple",
    icon: GhostIcon,
    dark: true,
    preview: { background: "#282a36", foreground: "#f8f8f2", accent: "#bd93f9" },
  },
  {
    value: "solarizedLight",
    label: "Solarized Light",
    description: "Precision light",
    icon: SunMediumIcon,
    dark: false,
    preview: { background: "#fdf6e3", foreground: "#586e75", accent: "#268bd2" },
  },
  {
    value: "tokyoNight",
    label: "Tokyo Night",
    description: "Neon city",
    icon: MoonStarIcon,
    dark: true,
    preview: { background: "#24283b", foreground: "#c0caf5", accent: "#7aa2f7" },
  },
  {
    value: "catppuccinMocha",
    label: "Catppuccin Mocha",
    description: "Soft pastels",
    icon: CatIcon,
    dark: true,
    preview: { background: "#1e1e2e", foreground: "#cdd6f4", accent: "#cba6f7" },
  },
]

/** CSS custom-property names (without `--`) used by every theme. */
export const THEME_TOKEN_KEYS = [
  "background",
  "foreground",
  "card",
  "card-foreground",
  "popover",
  "popover-foreground",
  "primary",
  "primary-foreground",
  "secondary",
  "secondary-foreground",
  "muted",
  "muted-foreground",
  "accent",
  "accent-foreground",
  "destructive",
  "border",
  "input",
  "ring",
  "chart-4",
  "chart-5",
  "sidebar",
  "sidebar-foreground",
  "sidebar-accent",
  "sidebar-accent-foreground",
  "sidebar-border",
  "sidebar-ring",
  "chrome",
  "chrome-foreground",
  "panel-header",
  "row-hover",
  "row-selected",
  "success",
  "warning",
  "info",
] as const

export const THEME_LABELS = Object.fromEntries(
  THEME_OPTIONS.map((option) => [option.value, option.label]),
) as Record<string, string>

const THEME_BY_ID = new Map<string, ThemeOption>(
  THEME_OPTIONS.map((option) => [option.value, option]),
)

/** Metadata for a theme id, falling back to the default dark palette. */
export function themeOption(mode: string): ThemeOption {
  const option = THEME_BY_ID.get(mode)
  if (option) return option
  const fallback = THEME_OPTIONS.find((candidate) => candidate.value === "dark")
  if (!fallback) throw new Error("The default dark theme must be registered")
  return fallback
}

/** Whether a theme id uses a dark palette. */
export function themeIsDark(mode: string): boolean {
  return themeOption(mode).dark
}
