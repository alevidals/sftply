import { cn } from "cn"
import type { LucideIcon } from "lucide-react"
import {
  ActivityIcon,
  ArrowDownUpIcon,
  ChevronDownIcon,
  CircleCheckIcon,
  HistoryIcon,
  InfoIcon,
  OctagonXIcon,
  Trash2Icon,
  TriangleAlertIcon,
} from "lucide-react"
import { memo } from "react"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useSettings } from "@/features/settings/settings-context"
import { TransferHistoryList } from "@/features/transfers/components/transfer-history"
import { TransferList } from "@/features/transfers/components/transfer-list"
import { formatClock } from "@/lib/format"
import type { ActivityLevel } from "@/lib/ipc/bindings"
import { shortcutLabel } from "@/lib/shortcuts"
import { useActivityStore } from "@/stores/activity-store"
import { selectActiveTransferCount, useTransferStore } from "@/stores/transfer-store"
import { useUiStore } from "@/stores/ui-store"

const LEVEL_META: Record<ActivityLevel, { icon: LucideIcon; className: string }> = {
  info: { icon: InfoIcon, className: "text-info" },
  success: { icon: CircleCheckIcon, className: "text-success" },
  warning: { icon: TriangleAlertIcon, className: "text-warning" },
  error: { icon: OctagonXIcon, className: "text-destructive" },
}

function BottomPanelImpl() {
  const { updateSettings } = useSettings()
  const bottomTab = useUiStore((state) => state.bottomTab)
  const setBottomTab = useUiStore((state) => state.setBottomTab)
  const entries = useActivityStore((state) => state.entries)
  const clear = useActivityStore((state) => state.clear)
  const activeTransfers = useTransferStore(selectActiveTransferCount)
  const transferCount = useTransferStore((state) => state.order.length)

  const collapse = () => {
    updateSettings({ bottomPanelOpen: false }).catch(() => {
      // The panel stays open; the settings provider surfaces the failure.
    })
  }

  return (
    <section className="flex h-full min-h-0 flex-col bg-background" aria-label="Activity panel">
      <div className="flex h-9 shrink-0 items-center border-b border-border/70 bg-chrome px-1">
        <TabButton
          active={bottomTab === "transfers"}
          onClick={() => setBottomTab("transfers")}
          icon={ArrowDownUpIcon}
          label="Transfers"
          count={activeTransfers}
          title={transferCount > activeTransfers ? `${transferCount} total` : undefined}
        />
        <TabButton
          active={bottomTab === "activity"}
          onClick={() => setBottomTab("activity")}
          icon={ActivityIcon}
          label="Activity"
          count={entries.length}
        />
        <TabButton
          active={bottomTab === "history"}
          onClick={() => setBottomTab("history")}
          icon={HistoryIcon}
          label="History"
        />

        <div className="ml-auto flex items-center gap-0.5 pr-0.5">
          {bottomTab === "activity" && entries.length > 0 ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon-xs" aria-label="Clear activity" onClick={clear}>
                  <Trash2Icon />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top" sideOffset={6}>
                Clear activity
              </TooltipContent>
            </Tooltip>
          ) : null}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon-xs" aria-label="Collapse panel" onClick={collapse}>
                <ChevronDownIcon />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top" sideOffset={6}>
              Collapse panel{" "}
              <span className="ml-1 font-mono text-[10px]">{shortcutLabel("panel")}</span>
            </TooltipContent>
          </Tooltip>
        </div>
      </div>

      {bottomTab === "transfers" ? (
        transferCount === 0 ? (
          <EmptyState
            icon={ArrowDownUpIcon}
            title="No transfers yet"
            description="Select files in one pane and send them to the other. Progress appears here."
          />
        ) : (
          <TransferList />
        )
      ) : bottomTab === "history" ? (
        <TransferHistoryList />
      ) : entries.length === 0 ? (
        <EmptyState
          icon={ActivityIcon}
          title="No activity yet"
          description="Backend events, connection changes and errors will be recorded here."
        />
      ) : (
        <ScrollArea className="min-h-0 flex-1">
          <ul className="py-0.5">
            {entries.map((entry) => {
              const meta = LEVEL_META[entry.level]
              const Icon = meta.icon
              return (
                <li
                  key={entry.id}
                  className="flex h-7 items-center gap-2 px-3 text-xs transition-colors hover:bg-row-hover"
                >
                  <Icon className={cn("size-3.5 shrink-0", meta.className)} />
                  <span className="selectable min-w-0 flex-1 truncate text-foreground/90">
                    {entry.message}
                  </span>
                  <time
                    className="shrink-0 font-mono text-2xs text-muted-foreground/80 tabular"
                    dateTime={entry.timestamp ? new Date(entry.timestamp).toISOString() : undefined}
                  >
                    {entry.timestamp ? formatClock(entry.timestamp) : "—"}
                  </time>
                </li>
              )
            })}
          </ul>
        </ScrollArea>
      )}
    </section>
  )
}

function TabButton({
  active,
  onClick,
  icon: Icon,
  label,
  count,
  title,
}: {
  active: boolean
  onClick: () => void
  icon: LucideIcon
  label: string
  count?: number
  title?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      title={title}
      className={cn(
        "relative flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
        active
          ? "bg-muted/70 text-foreground"
          : "text-muted-foreground hover:bg-muted/40 hover:text-foreground",
      )}
    >
      <Icon className="size-3.5" />
      <span>{label}</span>
      {count === undefined ? null : (
        <span
          className={cn(
            "min-w-4 rounded-full px-1 text-center font-mono text-[10px] leading-4 tabular",
            active ? "bg-background/80 text-foreground/80" : "bg-muted/60 text-muted-foreground",
          )}
        >
          {count}
        </span>
      )}
    </button>
  )
}

function EmptyState({
  icon: Icon,
  title,
  description,
}: {
  icon: LucideIcon
  title: string
  description: string
}) {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center p-4">
      <div className="flex max-w-sm items-center gap-3">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-border/70 bg-muted/30 text-muted-foreground">
          <Icon className="size-4" />
        </span>
        <div>
          <p className="text-xs font-medium text-foreground">{title}</p>
          <p className="mt-0.5 text-2xs leading-relaxed text-muted-foreground">{description}</p>
        </div>
      </div>
    </div>
  )
}

export const BottomPanel = memo(BottomPanelImpl)
