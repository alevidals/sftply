import { ArrowLeftRightIcon, Settings2Icon } from "lucide-react"
import { memo } from "react"
import { toast } from "sonner"
import { Kbd } from "@/components/kbd"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { ConnectionsPanel } from "@/features/connections/components/connections-panel"
import { shortcutLabel } from "@/lib/shortcuts"
import { useSessionStore } from "@/stores/session-store"
import { useUiStore } from "@/stores/ui-store"

function SidebarImpl() {
  const setSettingsOpen = useUiStore((state) => state.setSettingsOpen)
  const setSyncCompareOpen = useUiStore((state) => state.setSyncCompareOpen)
  const localPath = useUiStore((state) => state.localSummary.path)
  const remotePath = useUiStore((state) => state.remoteSummary.path)
  const activeSessionId = useSessionStore((state) => state.activeSessionId)
  const canCompare = Boolean(localPath && remotePath && activeSessionId)

  const openCompare = () => {
    if (!canCompare) {
      toast.info("Open a local folder and connect a remote session first.")
      return
    }
    setSyncCompareOpen(true)
  }

  return (
    <aside className="flex h-full min-h-0 flex-col bg-sidebar text-sidebar-foreground">
      <ConnectionsPanel />

      <div className="shrink-0 border-t border-sidebar-border/70 p-2">
        <p className="px-2 pb-1 text-[10px] font-medium tracking-wide text-muted-foreground/60 uppercase">
          Tools
        </p>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-start text-muted-foreground"
              onClick={openCompare}
            >
              <ArrowLeftRightIcon />
              Compare folders
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right" sideOffset={8}>
            {canCompare
              ? "Compare the current local and remote folders"
              : "Open a local folder and connect a remote session first"}
          </TooltipContent>
        </Tooltip>

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

export const Sidebar = memo(SidebarImpl)
