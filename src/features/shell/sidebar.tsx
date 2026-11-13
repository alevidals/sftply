import { Settings2Icon } from "lucide-react"
import { Kbd } from "@/components/kbd"
import { Button } from "@/components/ui/button"
import { ConnectionsPanel } from "@/features/connections/components/connections-panel"
import { shortcutLabel } from "@/lib/shortcuts"
import { useUiStore } from "@/stores/ui-store"

export function Sidebar() {
  const setSettingsOpen = useUiStore((state) => state.setSettingsOpen)

  return (
    <aside className="flex h-full min-h-0 flex-col bg-sidebar text-sidebar-foreground">
      <ConnectionsPanel />

      <div className="shrink-0 border-t border-sidebar-border/70 p-2">
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start text-muted-foreground"
          onClick={() => setSettingsOpen(true)}
        >
          <Settings2Icon />
          Settings
          <Kbd className="ml-auto">{shortcutLabel("settings")}</Kbd>
        </Button>
      </div>
    </aside>
  )
}
