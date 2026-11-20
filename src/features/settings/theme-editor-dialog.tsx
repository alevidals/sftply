import { useEffect, useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Spinner } from "@/components/ui/spinner"
import { useSettings } from "@/features/settings/settings-context"
import { parseColor } from "@/lib/contrast"
import { errorMessage } from "@/lib/errors"
import type { CustomTheme } from "@/lib/ipc/bindings"
import { ipc } from "@/lib/ipc/client"
import { applyDocumentTheme, readAppliedThemeTokens, resolveTheme } from "@/lib/theme"
import { THEME_TOKEN_KEYS } from "@/lib/themes"

const GROUPS: Array<{ label: string; keys: string[] }> = [
  {
    label: "Base",
    keys: ["background", "foreground", "card", "card-foreground", "popover", "popover-foreground"],
  },
  {
    label: "Accent and actions",
    keys: [
      "primary",
      "primary-foreground",
      "secondary",
      "secondary-foreground",
      "accent",
      "accent-foreground",
      "destructive",
      "ring",
    ],
  },
  {
    label: "Surfaces",
    keys: [
      "border",
      "input",
      "muted",
      "muted-foreground",
      "panel-header",
      "chrome",
      "chrome-foreground",
      "row-hover",
      "row-selected",
    ],
  },
  {
    label: "Sidebar",
    keys: [
      "sidebar",
      "sidebar-foreground",
      "sidebar-accent",
      "sidebar-accent-foreground",
      "sidebar-border",
      "sidebar-ring",
    ],
  },
  {
    label: "Status and file icons",
    keys: ["success", "warning", "info", "file-video", "file-audio"],
  },
]

interface ThemeEditorDialogProps {
  open: boolean
  theme: CustomTheme | null
  onOpenChange: (open: boolean) => void
  onSaved: (theme: CustomTheme) => void
}

function initialColors(theme: CustomTheme | null): Record<string, string> {
  const source = theme?.colors ?? readAppliedThemeTokens()
  return Object.fromEntries(THEME_TOKEN_KEYS.map((key) => [key, source[key] ?? "#000000"]))
}

/** In-app editor for the explicit custom theme token set. */
export function ThemeEditorDialog({ open, theme, onOpenChange, onSaved }: ThemeEditorDialogProps) {
  const { settings, themes } = useSettings()
  const [name, setName] = useState("Custom theme")
  const [dark, setDark] = useState(true)
  const [colors, setColors] = useState<Record<string, string>>(() => initialColors(theme))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setName(theme?.name ?? "Custom theme")
    setDark(theme?.dark ?? document.documentElement.classList.contains("dark"))
    setColors(initialColors(theme))
    setError(null)
  }, [open, theme])

  useEffect(() => {
    if (!open) return
    applyDocumentTheme(
      { id: "custom", themeId: theme?.id ?? "custom:editor", dark, colors },
      { cache: false },
    )
  }, [colors, dark, open, theme?.id])

  useEffect(() => {
    if (!open) return
    return () => {
      const media = window.matchMedia("(prefers-color-scheme: dark)")
      applyDocumentTheme(resolveTheme(settings.theme, media.matches, themes))
    }
  }, [open, settings.theme, themes])

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      const saved = await ipc.themeSave(theme?.id ?? null, name, dark, colors)
      onSaved(saved)
      toast.success(`Saved “${saved.name}”`)
      onOpenChange(false)
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setSaving(false)
    }
  }

  const setColor = (key: string, value: string) =>
    setColors((current) => ({ ...current, [key]: value }))

  return (
    <Dialog open={open} onOpenChange={(next) => !saving && onOpenChange(next)}>
      <DialogContent className="max-h-[calc(100vh-2rem)] grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{theme ? `Edit “${theme.name}”` : "New theme"}</DialogTitle>
          <DialogDescription>
            Define every color explicitly. Changes are previewed live and saved to a TOML file.
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 space-y-5 overflow-y-auto px-1">
          <div className="grid grid-cols-[minmax(0,1fr)_140px] gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="theme-name">Name</Label>
              <Input
                id="theme-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                spellCheck={false}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="theme-variant">Variant</Label>
              <Select
                value={dark ? "dark" : "light"}
                onValueChange={(value) => setDark(value === "dark")}
              >
                <SelectTrigger id="theme-variant" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="dark">Dark</SelectItem>
                  <SelectItem value="light">Light</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {GROUPS.map((group) => (
            <section key={group.label} className="space-y-2">
              <h3 className="text-xs font-medium">{group.label}</h3>
              <div className="grid grid-cols-2 gap-x-3 gap-y-2">
                {group.keys.map((key) => (
                  <ColorField
                    key={key}
                    label={key}
                    value={colors[key] ?? ""}
                    onChange={(value) => setColor(key, value)}
                  />
                ))}
              </div>
            </section>
          ))}

          {error ? (
            <p
              className="rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs text-destructive"
              role="alert"
            >
              {error}
            </p>
          ) : null}
        </div>

        <DialogFooter>
          {theme ? (
            <Button
              type="button"
              variant="ghost"
              onClick={() =>
                void ipc.themeOpenFile(theme.id).catch((cause) =>
                  toast.error("Could not open the theme file", {
                    description: errorMessage(cause),
                  }),
                )
              }
            >
              Open file
            </Button>
          ) : null}
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button type="button" onClick={() => void save()} disabled={saving}>
            {saving ? <Spinner /> : null}
            Save theme
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ColorField({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (value: string) => void
}) {
  return (
    <div className="min-w-0 space-y-1">
      <Label className="font-mono text-2xs text-muted-foreground">{label}</Label>
      <div className="flex min-w-0 items-center gap-1.5">
        <label
          className="relative size-8 shrink-0 cursor-pointer overflow-hidden rounded-md border border-border"
          style={{ backgroundColor: value }}
          title={value}
        >
          <input
            type="color"
            aria-label={`${label} color picker`}
            value={hexFromColor(value)}
            onChange={(event) => onChange(event.target.value)}
            className="absolute inset-0 size-full cursor-pointer opacity-0"
          />
        </label>
        <Input
          aria-label={label}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="h-8 min-w-0 font-mono text-2xs"
          spellCheck={false}
        />
      </div>
    </div>
  )
}

/** Native color inputs only accept hex; parse oklch/rgb for their initial value. */
function hexFromColor(value: string): string {
  try {
    const { r, g, b } = parseColor(value)
    const channel = (number: number) =>
      Math.round(Math.max(0, Math.min(1, number)) * 255)
        .toString(16)
        .padStart(2, "0")
    return `#${channel(r)}${channel(g)}${channel(b)}`
  } catch {
    return "#000000"
  }
}
