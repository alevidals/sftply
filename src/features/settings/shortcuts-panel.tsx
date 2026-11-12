import { Kbd } from "@/components/kbd"
import {
  formatShortcut,
  SHORTCUT_GROUPS,
  type ShortcutDefinition,
  shortcutChords,
} from "@/lib/shortcuts"

export function ShortcutsPanel({ isMac }: { isMac: boolean }) {
  return (
    <div className="space-y-5">
      <p className="text-xs leading-relaxed text-muted-foreground">
        Shortcuts work while the main window is focused.{" "}
        {isMac ? "⌘ is the Command key." : "Ctrl is the Control key."}
      </p>

      {SHORTCUT_GROUPS.map((group) => (
        <section key={group.id} className="space-y-2">
          <h3 className="text-sm font-medium">{group.title}</h3>
          <dl className="divide-y divide-border/60 overflow-hidden rounded-lg border border-border/70 bg-muted/10">
            {group.shortcuts.map((shortcut) => (
              <ShortcutRow key={shortcut.id} shortcut={shortcut} isMac={isMac} />
            ))}
          </dl>
        </section>
      ))}
    </div>
  )
}

function ShortcutRow({ shortcut, isMac }: { shortcut: ShortcutDefinition; isMac: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4 px-3 py-2">
      <div className="min-w-0">
        <dt className="text-xs text-foreground">{shortcut.label}</dt>
        {shortcut.description ? (
          <dd className="text-2xs text-muted-foreground">{shortcut.description}</dd>
        ) : null}
      </div>
      <dd className="flex shrink-0 items-center gap-1">
        {shortcutChords(shortcut, isMac).map((chord) => (
          <Kbd key={chord} className="font-mono">
            {formatShortcut(chord, isMac)}
          </Kbd>
        ))}
      </dd>
    </div>
  )
}
