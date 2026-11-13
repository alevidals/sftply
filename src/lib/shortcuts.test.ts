import { describe, expect, it } from "vitest"
import {
  formatShortcut,
  isMacPlatform,
  SHORTCUT_GROUPS,
  shortcutChords,
  shortcutLabel,
} from "@/lib/shortcuts"

describe("formatShortcut", () => {
  it("uses Command symbols on macOS", () => {
    expect(formatShortcut("mod+Shift+KeyN", true)).toBe("⌘⇧N")
    expect(formatShortcut("mod+Comma", true)).toBe("⌘,")
    expect(formatShortcut("mod+BracketLeft", true)).toBe("⌘[")
    expect(formatShortcut("mod+Backspace", true)).toBe("⌘⌫")
    expect(formatShortcut("Shift+Slash", true)).toBe("?")
  })

  it("uses Ctrl and spelled-out modifiers elsewhere", () => {
    expect(formatShortcut("mod+Shift+KeyN", false)).toBe("Ctrl+Shift+N")
    expect(formatShortcut("mod+Backspace", false)).toBe("Ctrl+Backspace")
    expect(formatShortcut("ArrowUp", false)).toBe("↑")
  })
})

describe("shortcutChords", () => {
  it("switches Delete to the platform convention", () => {
    const remove = SHORTCUT_GROUPS.flatMap((group) => group.shortcuts).find(
      (shortcut) => shortcut.id === "delete",
    )
    expect(remove).toBeDefined()
    if (!remove) return

    expect(shortcutChords(remove, true)).toEqual(["mod+Backspace"])
    expect(shortcutChords(remove, false)).toEqual(["Delete"])
  })

  it("falls back to the macOS chords when no platform override exists", () => {
    const palette = SHORTCUT_GROUPS.flatMap((group) => group.shortcuts).find(
      (shortcut) => shortcut.id === "palette",
    )
    expect(palette).toBeDefined()
    if (!palette) return

    expect(shortcutChords(palette, false)).toEqual(["mod+KeyK"])
  })
})

describe("isMacPlatform", () => {
  it("trusts the Rust platform string", () => {
    expect(isMacPlatform("macos")).toBe(true)
    expect(isMacPlatform("windows")).toBe(false)
    expect(isMacPlatform("linux")).toBe(false)
  })
})

describe("shortcutLabel", () => {
  it("renders the platform label for a shortcut id", () => {
    expect(shortcutLabel("palette", true)).toBe("⌘K")
    expect(shortcutLabel("palette", false)).toBe("Ctrl+K")
    expect(shortcutLabel("new-folder", true)).toBe("⌘⇧N")
    expect(shortcutLabel("new-folder", false)).toBe("Ctrl+Shift+N")
    expect(shortcutLabel("delete", true)).toBe("⌘⌫")
    expect(shortcutLabel("delete", false)).toBe("Delete")
    expect(shortcutLabel("open", false)).toBe("Enter")
  })

  it("returns an empty label for an unknown id", () => {
    expect(shortcutLabel("not-a-shortcut", false)).toBe("")
  })
})
