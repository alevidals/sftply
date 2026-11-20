import { describe, expect, it } from "vitest"
import { customThemeOption, themeExportText } from "@/lib/custom-theme"
import type { CustomTheme } from "@/lib/ipc/bindings"

const theme: CustomTheme = {
  id: "custom:mine",
  name: "Mine",
  dark: true,
  colors: {
    background: "#101010",
    foreground: "#f0f0f0",
    primary: "#4488ff",
  },
}

describe("customThemeOption", () => {
  it("builds a gallery preview from the resolved colors", () => {
    const option = customThemeOption(theme)
    expect(option.value).toBe("custom:mine")
    expect(option.label).toBe("Mine")
    expect(option.dark).toBe(true)
    expect(option.preview.background).toBe("#101010")
    expect(option.preview.accent).toBe("#4488ff")
  })
})

describe("themeExportText", () => {
  it("exports semantic tokens and terminal aliases", () => {
    const text = themeExportText("Mine", true, theme.colors)
    expect(text).toContain('name = "Mine"')
    expect(text).toContain('variant = "dark"')
    expect(text).toContain('background = "#101010"')
    expect(text).toContain('primary = "#4488ff"')
  })
})
