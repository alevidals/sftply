import { cn } from "cn"
import type { LucideIcon } from "lucide-react"
import { HomeIcon, ServerIcon } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import type { PaneId } from "@/stores/ui-store"
import { useUiStore } from "@/stores/ui-store"

interface FilePaneProps {
  kind: PaneId
  title: string
  icon: LucideIcon
  path: string
  status: "local" | "disconnected"
  emptyTitle: string
  emptyDescription: string
  emptyIcon: LucideIcon
}

export function FilePane({
  kind,
  title,
  icon: PaneIcon,
  path,
  status,
  emptyTitle,
  emptyDescription,
  emptyIcon: EmptyIcon,
}: FilePaneProps) {
  const activePane = useUiStore((state) => state.activePane)
  const setActivePane = useUiStore((state) => state.setActivePane)
  const active = activePane === kind

  return (
    <section
      id={`pane-${kind}`}
      aria-label={`${title} pane`}
      tabIndex={-1}
      onFocus={() => setActivePane(kind)}
      data-active={active}
      className={cn(
        "flex h-full min-h-0 flex-col bg-background outline-none",
        "data-[active=true]:ring-1 data-[active=true]:ring-primary/15 data-[active=true]:ring-inset",
      )}
    >
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border/70 bg-panel-header px-3">
        <PaneIcon className={cn("size-3.5", active ? "text-primary" : "text-muted-foreground")} />
        <span className="text-xs font-semibold text-foreground">{title}</span>
        {status === "local" ? (
          <Badge variant="secondary" className="h-4.5 px-1.5 text-[10px] font-medium">
            Local
          </Badge>
        ) : (
          <Badge variant="outline" className="h-4.5 gap-1 px-1.5 text-[10px] font-medium">
            <span className="size-1.5 rounded-full bg-warning" />
            Not connected
          </Badge>
        )}
      </div>

      <div className="flex h-8 shrink-0 items-center gap-1.5 border-b border-border/60 bg-background/40 px-3">
        {kind === "local" ? (
          <HomeIcon className="size-3 text-muted-foreground/80" />
        ) : (
          <ServerIcon className="size-3 text-muted-foreground/80" />
        )}
        <span className="selectable truncate font-mono text-[11px] text-muted-foreground">
          {path}
        </span>
      </div>

      <div className="grid h-7 shrink-0 grid-cols-[minmax(0,1fr)_88px_132px] items-center gap-3 border-b border-border/60 bg-panel-header/60 px-3 text-2xs font-medium tracking-wide text-muted-foreground/80 uppercase">
        <span>Name</span>
        <span className="text-right">Size</span>
        <span className="text-right">Modified</span>
      </div>

      <div className="flex min-h-0 flex-1 items-center justify-center p-6">
        <div className="flex max-w-[260px] flex-col items-center text-center">
          <span className="mb-3 flex size-11 items-center justify-center rounded-xl border border-border/70 bg-muted/40 text-muted-foreground">
            <EmptyIcon className="size-5" />
          </span>
          <h2 className="text-sm font-medium text-foreground">{emptyTitle}</h2>
          <p className="mt-1 text-xs leading-relaxed text-balance text-muted-foreground">
            {emptyDescription}
          </p>
        </div>
      </div>

      <div className="flex h-7 shrink-0 items-center justify-between border-t border-border/60 px-3 text-2xs text-muted-foreground">
        <span>0 items</span>
        <span className="tabular">—</span>
      </div>
    </section>
  )
}
