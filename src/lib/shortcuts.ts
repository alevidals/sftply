export interface ShortcutDefinition {
  id: string
  label: string
  description?: string
  /** Chords accepted on macOS. */
  mac: readonly string[]
  /** Chords accepted on Windows and Linux. Falls back to `mac`. */
  other?: readonly string[]
}

export interface ShortcutGroup {
  id: string
  title: string
  shortcuts: readonly ShortcutDefinition[]
}

const MAC_SYMBOLS: Record<string, string> = {
  mod: "⌘",
  shift: "⇧",
  alt: "⌥",
  ctrl: "⌃",
  enter: "↩",
  backspace: "⌫",
  delete: "⌦",
  escape: "Esc",
  space: "Space",
  arrowup: "↑",
  arrowdown: "↓",
  arrowleft: "←",
  arrowright: "→",
  bracketleft: "[",
  bracketright: "]",
  comma: ",",
}

const OTHER_LABELS: Record<string, string> = {
  mod: "Ctrl",
  shift: "Shift",
  alt: "Alt",
  ctrl: "Ctrl",
  enter: "Enter",
  backspace: "Backspace",
  delete: "Delete",
  escape: "Esc",
  space: "Space",
  arrowup: "↑",
  arrowdown: "↓",
  arrowleft: "←",
  arrowright: "→",
  bracketleft: "[",
  bracketright: "]",
  comma: ",",
}

/** True on the platforms where tinykeys maps `$mod` to Command. */
export function isMacPlatform(platform: string | undefined): boolean {
  if (platform) return platform === "macos"
  return typeof navigator === "object" && /Mac|iPod|iPhone|iPad/.test(navigator.platform)
}

/** Format a chord such as `mod+Shift+KeyN` for display on the current platform. */
export function formatShortcut(chord: string, isMac: boolean): string {
  const tokens = chord.split("+").map((token) => {
    const key = token.toLowerCase()
    if (key.startsWith("key") && token.length === 4) return token.slice(3)
    if (key.startsWith("digit") && token.length === 6) return token.slice(5)
    return isMac ? (MAC_SYMBOLS[key] ?? token) : (OTHER_LABELS[key] ?? token)
  })
  return tokens.join(isMac ? "" : "+")
}

export function shortcutChords(shortcut: ShortcutDefinition, isMac: boolean): readonly string[] {
  return isMac ? shortcut.mac : (shortcut.other ?? shortcut.mac)
}

export const SHORTCUT_GROUPS: readonly ShortcutGroup[] = [
  {
    id: "application",
    title: "Application",
    shortcuts: [
      { id: "palette", label: "Command palette", mac: ["mod+KeyK"] },
      { id: "settings", label: "Open settings", mac: ["mod+Comma"] },
      { id: "panel", label: "Toggle transfers and activity panel", mac: ["mod+KeyJ"] },
      { id: "focus-local", label: "Focus local pane", mac: ["mod+Digit1"] },
      { id: "focus-remote", label: "Focus remote pane", mac: ["mod+Digit2"] },
    ],
  },
  {
    id: "browse",
    title: "Browsing",
    shortcuts: [
      { id: "refresh", label: "Refresh the active pane", mac: ["mod+KeyR"] },
      { id: "filter", label: "Filter the active folder", mac: ["mod+KeyF"] },
      { id: "path", label: "Edit the path", mac: ["mod+KeyL"] },
      { id: "back", label: "Go back", mac: ["mod+BracketLeft"] },
      { id: "forward", label: "Go forward", mac: ["mod+BracketRight"] },
      { id: "up", label: "Go to the enclosing folder", mac: ["mod+ArrowUp"] },
      { id: "new-folder", label: "New folder", mac: ["mod+Shift+KeyN"] },
    ],
  },
  {
    id: "files",
    title: "Files and selection",
    shortcuts: [
      {
        id: "move",
        label: "Move the cursor",
        mac: ["ArrowUp", "ArrowDown"],
      },
      {
        id: "extend",
        label: "Extend the selection",
        mac: ["Shift+ArrowUp", "Shift+ArrowDown"],
      },
      {
        id: "bounds",
        label: "First or last item",
        mac: ["Home", "End"],
      },
      { id: "toggle", label: "Select or deselect the active item", mac: ["Space"] },
      { id: "select-all", label: "Select all", mac: ["mod+KeyA"] },
      { id: "open", label: "Open folder or file", mac: ["Enter"] },
      { id: "rename", label: "Rename", mac: ["F2"] },
      {
        id: "delete",
        label: "Delete the selection",
        mac: ["mod+Backspace"],
        other: ["Delete"],
      },
      { id: "up-key", label: "Go to the enclosing folder", mac: ["Backspace"] },
      { id: "clear", label: "Clear the selection", mac: ["Escape"] },
    ],
  },
  {
    id: "dialogs",
    title: "Dialogs and menus",
    shortcuts: [
      { id: "close", label: "Close a dialog or menu", mac: ["Escape"] },
      { id: "confirm", label: "Confirm a dialog or submit a form", mac: ["Enter"] },
    ],
  },
]
