import { afterEach, describe, expect, it } from "vitest"
import {
  applyDocumentDensity,
  applyDocumentTheme,
  DENSITY_STORAGE_KEY,
  rememberAppearance,
  resolveTheme,
  THEME_STORAGE_KEY,
} from "@/lib/theme"
import { THEME_OPTIONS, THEME_VALUES } from "@/lib/themes"

afterEach(() => {
  document.documentElement.classList.remove("dark")
  document.documentElement.style.colorScheme = ""
  delete document.documentElement.dataset.density
  delete document.documentElement.dataset.theme
  localStorage.clear()
})

describe("resolveTheme", () => {
  it("returns explicit modes unchanged", () => {
    expect(resolveTheme("dark", false)).toEqual({ id: "dark", themeId: "dark", dark: true })
    expect(resolveTheme("light", true)).toEqual({ id: "light", themeId: "light", dark: false })
  })

  it("resolves named palettes with their own lightness", () => {
    expect(resolveTheme("oneDark", false)).toEqual({
      id: "oneDark",
      themeId: "oneDark",
      dark: true,
    })
    expect(resolveTheme("gruvboxLight", true)).toEqual({
      id: "gruvboxLight",
      themeId: "gruvboxLight",
      dark: false,
    })
  })

  it("follows the system preference in system mode", () => {
    expect(resolveTheme("system", true)).toEqual({ id: "dark", themeId: "system", dark: true })
    expect(resolveTheme("system", false)).toEqual({ id: "light", themeId: "system", dark: false })
  })
})

describe("applyDocumentTheme", () => {
  it("toggles the dark class, palette id and color scheme", () => {
    applyDocumentTheme({ id: "dark", themeId: "dark", dark: true })
    expect(document.documentElement.classList.contains("dark")).toBe(true)
    expect(document.documentElement.dataset.theme).toBe("dark")
    expect(document.documentElement.style.colorScheme).toBe("dark")

    applyDocumentTheme({ id: "solarizedLight", themeId: "solarizedLight", dark: false })
    expect(document.documentElement.classList.contains("dark")).toBe(false)
    expect(document.documentElement.dataset.theme).toBe("solarizedLight")
    expect(document.documentElement.style.colorScheme).toBe("light")
  })

  it("keeps the dark class for dark named palettes", () => {
    applyDocumentTheme({ id: "nord", themeId: "nord", dark: true })
    expect(document.documentElement.classList.contains("dark")).toBe(true)
    expect(document.documentElement.dataset.theme).toBe("nord")
  })

  it("applies custom variables and removes them when switching back", () => {
    const custom = {
      id: "custom:mine",
      name: "Mine",
      dark: true,
      colors: { background: "#101010", foreground: "#f0f0f0", primary: "#4488ff" },
    }
    applyDocumentTheme(resolveTheme("custom:mine", false, [custom]))
    expect(document.documentElement.dataset.theme).toBe("custom")
    expect(document.documentElement.style.getPropertyValue("--background")).toBe("#101010")
    expect(localStorage.getItem("sftply.custom-theme")).toContain("custom:mine")

    applyDocumentTheme({ id: "dark", themeId: "dark", dark: true })
    expect(document.documentElement.dataset.theme).toBe("dark")
    expect(document.documentElement.style.getPropertyValue("--background")).toBe("")
    expect(localStorage.getItem("sftply.custom-theme")).toBeNull()
  })
})

describe("applyDocumentDensity", () => {
  it("writes the density data attribute", () => {
    applyDocumentDensity("comfortable")
    expect(document.documentElement.dataset.density).toBe("comfortable")
  })
})

describe("rememberAppearance", () => {
  it("mirrors non-secret appearance values for the bootstrap script", () => {
    rememberAppearance("system", "compact")
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("system")
    expect(localStorage.getItem(DENSITY_STORAGE_KEY)).toBe("compact")
  })
})

describe("custom themes", () => {
  it("resolves a custom theme and fills missing tokens", () => {
    const theme = {
      id: "custom:mine",
      name: "Mine",
      dark: true,
      colors: { background: "#101010", foreground: "#f0f0f0", primary: "#4488ff" },
    }
    const resolved = resolveTheme("custom:mine", false, [theme])
    expect(resolved.id).toBe("custom")
    expect(resolved.themeId).toBe("custom:mine")
    expect(resolved.dark).toBe(true)
    expect(resolved.colors?.background).toBe("#101010")
    expect(resolved.colors?.primary).toBe("#4488ff")
    expect(resolved.colors?.card).toBeUndefined()
  })
})

describe("theme catalogue", () => {
  it("offers exactly the ids declared for settings", () => {
    expect(THEME_OPTIONS.map((option) => option.value)).toEqual([...THEME_VALUES])
  })
})
