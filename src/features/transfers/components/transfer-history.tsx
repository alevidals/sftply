import { useQuery, useQueryClient } from "@tanstack/react-query"
import { cn } from "cn"
import {
  ArrowDownToLineIcon,
  ArrowUpFromLineIcon,
  BanIcon,
  CircleCheckIcon,
  HistoryIcon,
  OctagonXIcon,
  Trash2Icon,
} from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { useFormatPreferences } from "@/features/settings/settings-context"
import { TRANSFER_HISTORY_QUERY_KEY, transfersApi } from "@/features/transfers/api"
import { errorMessage } from "@/lib/errors"
import { formatBytes, formatClock } from "@/lib/format"
import type { TransferHistoryEntry_Serialize, TransferStatus } from "@/lib/ipc/bindings"
import { recordActivity } from "@/stores/activity-store"

const STATUS_META: Record<
  TransferStatus,
  { label: string; icon: typeof CircleCheckIcon; className: string }
> = {
  queued: { label: "Queued", icon: HistoryIcon, className: "text-muted-foreground" },
  running: { label: "Transferring", icon: HistoryIcon, className: "text-info" },
  completed: { label: "Completed", icon: CircleCheckIcon, className: "text-success" },
  failed: { label: "Failed", icon: OctagonXIcon, className: "text-destructive" },
  cancelled: { label: "Cancelled", icon: BanIcon, className: "text-warning" },
}

/** Finished transfers, persisted across restarts. */
export function TransferHistoryList() {
  const queryClient = useQueryClient()
  const query = useQuery({
    queryKey: TRANSFER_HISTORY_QUERY_KEY,
    queryFn: transfersApi.history,
  })
  const entries = query.data ?? []

  const clear = () => {
    transfersApi
      .clearHistory()
      .then((removed) => {
        queryClient.setQueryData(TRANSFER_HISTORY_QUERY_KEY, [])
        if (removed > 0) recordActivity("info", `Cleared ${removed} history entries`)
      })
      .catch((error) => {
        toast.error("Could not clear the transfer history", {
          description: errorMessage(error),
        })
      })
  }

  if (query.isPending) {
    return (
      <p className="px-3 py-2 text-2xs text-muted-foreground" role="status">
        Loading history…
      </p>
    )
  }

  if (query.isError) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 p-4">
        <p className="text-xs font-medium text-foreground">Could not read the history</p>
        <p className="text-2xs text-muted-foreground">{errorMessage(query.error)}</p>
        <Button variant="outline" size="xs" onClick={() => void query.refetch()}>
          Try again
        </Button>
      </div>
    )
  }

  if (entries.length === 0) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center p-4">
        <div className="flex max-w-sm items-center gap-3">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-border/70 bg-muted/30 text-muted-foreground">
            <HistoryIcon className="size-4" />
          </span>
          <div>
            <p className="text-xs font-medium text-foreground">No finished transfers</p>
            <p className="mt-0.5 text-2xs leading-relaxed text-muted-foreground">
              Completed, failed and cancelled transfers are kept here across restarts.
            </p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ScrollArea className="min-h-0 flex-1">
        <ul className="py-0.5" aria-label="Transfer history">
          {entries.map((entry) => (
            <HistoryRow key={entry.id} entry={entry} />
          ))}
        </ul>
      </ScrollArea>
      <div className="flex h-7 shrink-0 items-center gap-3 border-t border-border/60 px-3 text-2xs text-muted-foreground">
        <span className="tabular">
          {entries.length} {entries.length === 1 ? "entry" : "entries"}
        </span>
        <Button
          variant="ghost"
          size="xs"
          className="ml-auto h-5 gap-1 px-1.5 text-2xs text-muted-foreground"
          onClick={clear}
        >
          <Trash2Icon className="size-3" />
          Clear history
        </Button>
      </div>
    </div>
  )
}

function HistoryRow({ entry }: { entry: TransferHistoryEntry_Serialize }) {
  const meta = STATUS_META[entry.status]
  const Icon = meta.icon
  const { sizeFormat } = useFormatPreferences()
  const DirectionIcon = entry.direction === "upload" ? ArrowUpFromLineIcon : ArrowDownToLineIcon

  return (
    <li
      className="group flex items-center gap-2 px-3 py-1.5 transition-colors hover:bg-row-hover"
      title={entry.error ?? undefined}
    >
      <DirectionIcon
        className={cn(
          "size-3.5 shrink-0",
          entry.direction === "upload" ? "text-info" : "text-success",
        )}
      />
      <span className="min-w-0 flex-1 truncate text-xs text-foreground" title={entry.name}>
        {entry.name}
      </span>
      <span className="hidden min-w-0 max-w-64 truncate text-2xs text-muted-foreground sm:block">
        {entry.sourceLabel} → {entry.targetLabel}
      </span>
      <span className={cn("flex shrink-0 items-center gap-1 text-2xs", meta.className)}>
        <Icon className="size-3" />
        {meta.label}
      </span>
      <span className="w-20 shrink-0 text-right font-mono text-2xs text-muted-foreground tabular">
        {formatBytes(entry.transferred, sizeFormat)} / {formatBytes(entry.size, sizeFormat)}
      </span>
      <time
        className="w-12 shrink-0 text-right font-mono text-2xs text-muted-foreground/80 tabular"
        dateTime={entry.finishedAt ? new Date(entry.finishedAt).toISOString() : undefined}
      >
        {entry.finishedAt ? formatClock(entry.finishedAt) : "—"}
      </time>
    </li>
  )
}
