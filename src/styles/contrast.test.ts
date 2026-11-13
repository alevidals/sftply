/// <reference types="node" />
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"
import { composite, contrastOver, parseColor } from "@/lib/contrast"

const CSS = readFileSync(resolve(process.cwd(), "src/styles/globals.css"), "utf8")

interface Theme {
  name: string
  vars: Record<string, string>
}

function readThemes(): Theme[] {
  const blocks = CSS.matchAll(/^([^\n{}]+)\{\n([\s\S]*?)^\}/gm)
  const themes: Theme[] = []
  for (const block of blocks) {
    const selector = (block[1] ?? "").trim()
    if (selector !== ":root" && selector !== ".dark" && !selector.startsWith('[data-theme="')) {
      continue
    }
    const vars = Object.fromEntries(
      [...(block[2] ?? "").matchAll(/--([\w-]+):\s*([^;]+);/g)].map((decl) => [
        decl[1] ?? "",
        (decl[2] ?? "").trim(),
      ]),
    )
    const name =
      selector === ":root"
        ? "light"
        : selector === ".dark"
          ? "dark"
          : (selector.match(/"([^"]+)"/)?.[1] ?? selector)
    themes.push({ name, vars })
  }
  return themes
}

/** Foreground/background token pairs that carry small text. */
const TEXT_PAIRS: readonly (readonly [string, string])[] = [
  ["foreground", "background"],
  ["card-foreground", "card"],
  ["popover-foreground", "popover"],
  ["muted-foreground", "background"],
  ["muted-foreground", "muted"],
  ["secondary-foreground", "secondary"],
  ["accent-foreground", "accent"],
  ["primary-foreground", "primary"],
  ["primary", "background"],
  ["sidebar-foreground", "sidebar"],
  ["sidebar-primary-foreground", "sidebar-primary"],
  ["chrome-foreground", "chrome"],
]

const STATUS_TOKENS = ["destructive", "success", "warning", "info"] as const
const STATUS_BACKDROPS = ["background", "card", "popover"] as const

const themes = readThemes()

function value(theme: Theme, token: string): string {
  const raw = theme.vars[token]
  if (!raw) throw new Error(`${theme.name} is missing --${token}`)
  return raw
}

function ratio(theme: Theme, foreground: string, background: string): number {
  return contrastOver(parseColor(value(theme, foreground)), parseColor(value(theme, background)))
}

describe("theme contrast", () => {
  it("parses every built-in theme", () => {
    const names = themes.map((theme) => theme.name)
    expect(names).toEqual([
      "light",
      "dark",
      "oneDark",
      "gruvboxDark",
      "gruvboxLight",
      "nord",
      "dracula",
      "solarizedLight",
      "tokyoNight",
      "catppuccinMocha",
    ])
  })

  for (const theme of themes) {
    it(`${theme.name} keeps small text at WCAG AA`, () => {
      const failures: string[] = []
      for (const [foreground, background] of TEXT_PAIRS) {
        const contrast = ratio(theme, foreground, background)
        if (contrast < 4.5) {
          failures.push(`${foreground} on ${background}: ${contrast.toFixed(2)}`)
        }
      }
      for (const token of STATUS_TOKENS) {
        for (const background of STATUS_BACKDROPS) {
          const contrast = ratio(theme, token, background)
          if (contrast < 4.5) {
            failures.push(`${token} on ${background}: ${contrast.toFixed(2)}`)
          }
        }
      }
      expect(failures).toEqual([])
    })
  }

  it("keeps sidebar accent text readable over translucent surfaces", () => {
    for (const theme of themes) {
      const surface = composite(
        parseColor(value(theme, "sidebar-accent")),
        parseColor(value(theme, "sidebar")),
      )
      const text = composite(parseColor(value(theme, "sidebar-accent-foreground")), surface)
      const contrast = contrastOver(text, surface)
      expect(contrast, `${theme.name} sidebar accent`).toBeGreaterThanOrEqual(4.5)
    }
  })
})
