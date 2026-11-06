import { afterEach, describe, expect, it } from "vitest"
import {
  applyDocumentDensity,
  applyDocumentTheme,
  DENSITY_STORAGE_KEY,
  rememberAppearance,
  resolveTheme,
  THEME_STORAGE_KEY,
} from "@/lib/theme"

afterEach(() => {
  document.documentElement.classList.remove("dark")
  document.documentElement.style.colorScheme = ""
  delete document.documentElement.dataset.density
  localStorage.clear()
})

describe("resolveTheme", () => {
  it("returns explicit modes unchanged", () => {
    expect(resolveTheme("dark", false)).toBe("dark")
    expect(resolveTheme("light", true)).toBe("light")
  })

  it("follows the system preference in system mode", () => {
    expect(resolveTheme("system", true)).toBe("dark")
    expect(resolveTheme("system", false)).toBe("light")
  })
})

describe("applyDocumentTheme", () => {
  it("toggles the dark class and color scheme", () => {
    applyDocumentTheme("dark")
    expect(document.documentElement.classList.contains("dark")).toBe(true)
    expect(document.documentElement.style.colorScheme).toBe("dark")

    applyDocumentTheme("light")
    expect(document.documentElement.classList.contains("dark")).toBe(false)
    expect(document.documentElement.style.colorScheme).toBe("light")
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
