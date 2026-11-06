import { Clock3Icon, PlusIcon, ServerIcon, Settings2Icon } from "lucide-react"
import { Kbd } from "@/components/kbd"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useUiStore } from "@/stores/ui-store"

export function Sidebar() {
  const setSettingsOpen = useUiStore((state) => state.setSettingsOpen)

  return (
    <aside className="flex h-full min-h-0 flex-col bg-sidebar text-sidebar-foreground">
      <div className="flex h-11 shrink-0 items-center justify-between border-b border-sidebar-border/70 px-3">
        <span className="text-2xs font-semibold tracking-[0.14em] text-muted-foreground uppercase">
          Connections
        </span>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-xs"
              disabled
              aria-label="Add connection (not available yet)"
            >
              <PlusIcon />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom" sideOffset={6}>
            The connection editor arrives in the next milestone.
          </TooltipContent>
        </Tooltip>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-6 p-3">
          <div className="rounded-lg border border-dashed border-sidebar-border bg-background/30 px-3 py-5 text-center">
            <span className="mx-auto mb-3 flex size-9 items-center justify-center rounded-lg border border-sidebar-border bg-sidebar-accent/60 text-muted-foreground">
              <ServerIcon className="size-4" />
            </span>
            <p className="text-xs font-medium text-foreground">No connections yet</p>
            <p className="mx-auto mt-1 max-w-[180px] text-2xs leading-relaxed text-muted-foreground">
              Saved FTP, FTPS and SFTP servers will appear here.
            </p>
          </div>

          <section className="space-y-2">
            <div className="flex items-center gap-1.5 px-1">
              <Clock3Icon className="size-3 text-muted-foreground/70" />
              <span className="text-2xs font-semibold tracking-[0.12em] text-muted-foreground uppercase">
                Recent
              </span>
            </div>
            <p className="px-1 text-2xs leading-relaxed text-muted-foreground/80">
              Sessions you open will appear here for quick access.
            </p>
          </section>
        </div>
      </ScrollArea>

      <div className="shrink-0 border-t border-sidebar-border/70 p-2">
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start text-muted-foreground"
          onClick={() => setSettingsOpen(true)}
        >
          <Settings2Icon />
          Settings
          <Kbd className="ml-auto">⌘,</Kbd>
        </Button>
      </div>
    </aside>
  )
}
