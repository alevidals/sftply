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
    expect(resolveTheme("dark", false)).toEqual({ id: "dark", dark: true })
    expect(resolveTheme("light", true)).toEqual({ id: "light", dark: false })
  })

  it("resolves named palettes with their own lightness", () => {
    expect(resolveTheme("oneDark", false)).toEqual({ id: "oneDark", dark: true })
    expect(resolveTheme("gruvboxLight", true)).toEqual({ id: "gruvboxLight", dark: false })
  })

  it("follows the system preference in system mode", () => {
    expect(resolveTheme("system", true)).toEqual({ id: "dark", dark: true })
    expect(resolveTheme("system", false)).toEqual({ id: "light", dark: false })
  })
})

describe("applyDocumentTheme", () => {
  it("toggles the dark class, palette id and color scheme", () => {
    applyDocumentTheme({ id: "dark", dark: true })
    expect(document.documentElement.classList.contains("dark")).toBe(true)
    expect(document.documentElement.dataset.theme).toBe("dark")
    expect(document.documentElement.style.colorScheme).toBe("dark")

    applyDocumentTheme({ id: "solarizedLight", dark: false })
    expect(document.documentElement.classList.contains("dark")).toBe(false)
    expect(document.documentElement.dataset.theme).toBe("solarizedLight")
    expect(document.documentElement.style.colorScheme).toBe("light")
  })

  it("keeps the dark class for dark named palettes", () => {
    applyDocumentTheme({ id: "nord", dark: true })
    expect(document.documentElement.classList.contains("dark")).toBe(true)
    expect(document.documentElement.dataset.theme).toBe("nord")
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

describe("theme catalogue", () => {
  it("offers exactly the ids declared for settings", () => {
    expect(THEME_OPTIONS.map((option) => option.value)).toEqual([...THEME_VALUES])
  })
})
