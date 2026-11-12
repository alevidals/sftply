import { cn } from "cn"
import {
  ArrowDownToLineIcon,
  ArrowUpFromLineIcon,
  BanIcon,
  CircleCheckIcon,
  ClockIcon,
  LoaderCircleIcon,
  OctagonXIcon,
  PauseIcon,
  PlayIcon,
  RotateCcwIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { transfersApi } from "@/features/transfers/api"
import { errorMessage } from "@/lib/errors"
import { formatBytes, formatEta } from "@/lib/format"
import type { TransferItem_Serialize, TransferStatus } from "@/lib/ipc/bindings"
import { recordActivity } from "@/stores/activity-store"
import {
  selectActiveTransferCount,
  selectTransferSpeed,
  useTransferStore,
} from "@/stores/transfer-store"

const STATUS_META: Record<
  TransferStatus,
  { label: string; icon: typeof ClockIcon; className: string }
> = {
  queued: { label: "Queued", icon: ClockIcon, className: "text-muted-foreground" },
  running: { label: "Transferring", icon: LoaderCircleIcon, className: "text-info" },
  completed: { label: "Completed", icon: CircleCheckIcon, className: "text-success" },
  failed: { label: "Failed", icon: OctagonXIcon, className: "text-destructive" },
  cancelled: { label: "Cancelled", icon: BanIcon, className: "text-warning" },
}

export function TransferList() {
  const items = useTransferStore((state) => state.items)
  const order = useTransferStore((state) => state.order)
  const activeCount = useTransferStore(selectActiveTransferCount)
  const speed = useTransferStore(selectTransferSpeed)
  const paused = useTransferStore((state) => state.paused)
  const setPaused = useTransferStore((state) => state.setPaused)
  const hasFinished = order.some((id) => {
    const item = items[id]
    return item ? !["queued", "running"].includes(item.status) : false
  })

  if (order.length === 0) return null

  const toggleQueue = () => {
    const action = paused ? transfersApi.resumeQueue() : transfersApi.pauseQueue()
    action
      .then((next) => {
        setPaused(next)
        recordActivity("info", next ? "Paused the transfer queue" : "Resumed the transfer queue")
      })
      .catch((error) => {
        toast.error("Could not change the transfer queue", { description: errorMessage(error) })
      })
  }

  const clearFinished = () => {
    transfersApi
      .clearFinished()
      .then((removed) => {
        if (removed > 0) {
          useTransferStore.getState().remove(
            order.filter((id) => {
              const item = items[id]
              return item ? !["queued", "running"].includes(item.status) : false
            }),
          )
        }
      })
      .catch((error) => {
        toast.error("Could not clear finished transfers", { description: errorMessage(error) })
      })
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ScrollArea className="min-h-0 flex-1">
        <ul className="py-0.5" aria-label="Transfers">
          {order.map((id) => {
            const item = items[id]
            return item ? <TransferRow key={id} item={item} /> : null
          })}
        </ul>
      </ScrollArea>

      <div className="flex h-7 shrink-0 items-center gap-3 border-t border-border/60 px-3 text-2xs text-muted-foreground">
        <span className="tabular">
          {activeCount === 0 ? "Idle" : `${activeCount} active`}
          {speed > 0 ? ` · ${formatBytes(speed)}/s` : ""}
        </span>
        <span className="ml-auto flex items-center gap-1">
          {paused ? <span className="mr-1 text-warning">Queue paused</span> : null}
          {paused || activeCount > 0 ? (
            <Button
              variant="ghost"
              size="xs"
              className="h-5 gap-1 px-1.5 text-2xs text-muted-foreground"
              onClick={toggleQueue}
            >
              {paused ? <PlayIcon className="size-3" /> : <PauseIcon className="size-3" />}
              {paused ? "Resume queue" : "Pause queue"}
            </Button>
          ) : null}
          {hasFinished ? (
            <Button
              variant="ghost"
              size="xs"
              className="h-5 gap-1 px-1.5 text-2xs text-muted-foreground"
              onClick={clearFinished}
            >
              <Trash2Icon className="size-3" />
              Clear finished
            </Button>
          ) : null}
        </span>
      </div>
    </div>
  )
}

function TransferRow({ item }: { item: TransferItem_Serialize }) {
  const meta = STATUS_META[item.status]
  const Icon = meta.icon
  const DirectionIcon = item.direction === "upload" ? ArrowUpFromLineIcon : ArrowDownToLineIcon
  const percent =
    item.size > 0
      ? Math.min(100, Math.max(0, (item.transferred / item.size) * 100))
      : item.status === "completed"
        ? 100
        : 0
  const cancellable = item.status === "queued" || item.status === "running"
  const retryable = item.status === "failed" || item.status === "cancelled"

  const cancel = () => {
    transfersApi
      .cancel(item.id)
      .then((accepted) => {
        if (accepted) recordActivity("warning", `Cancelled “${item.name}”`)
      })
      .catch((error) => {
        toast.error(`Could not cancel “${item.name}”`, { description: errorMessage(error) })
      })
  }

  const retry = () => {
    transfersApi
      .retry(item.id)
      .then(() => recordActivity("info", `Retried “${item.name}”`))
      .catch((error) => {
        toast.error(`Could not retry “${item.name}”`, { description: errorMessage(error) })
      })
  }

  return (
    <li
      className="group relative px-3 py-1.5 transition-colors hover:bg-row-hover"
      data-status={item.status}
    >
      <div className="flex items-center gap-2">
        <DirectionIcon
          className={cn(
            "size-3.5 shrink-0",
            item.direction === "upload" ? "text-info" : "text-success",
          )}
        />
        <span className="min-w-0 flex-1 truncate text-xs text-foreground" title={item.name}>
          {item.name}
        </span>
        <span className={cn("flex shrink-0 items-center gap-1 text-2xs", meta.className)}>
          <Icon className={cn("size-3", item.status === "running" && "animate-spin")} />
          {meta.label}
        </span>
        <span className="w-28 shrink-0 text-right font-mono text-2xs text-muted-foreground tabular">
          {item.status === "running"
            ? `${formatBytes(item.bytesPerSec)}/s`
            : `${formatBytes(item.transferred)} / ${formatBytes(item.size)}`}
        </span>
        {cancellable ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label={`Cancel ${item.name}`}
                className="size-5 text-muted-foreground opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                onClick={cancel}
              >
                <XIcon className="size-3" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top" sideOffset={6}>
              Cancel transfer
            </TooltipContent>
          </Tooltip>
        ) : retryable ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label={`Retry ${item.name}`}
                className="size-5 text-muted-foreground opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                onClick={retry}
              >
                <RotateCcwIcon className="size-3" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top" sideOffset={6}>
              Retry transfer
            </TooltipContent>
          </Tooltip>
        ) : (
          <span className="size-5 shrink-0" />
        )}
      </div>

      <div className="mt-1 ml-[22px] flex items-center gap-2">
        <div className="h-1 min-w-0 flex-1 overflow-hidden rounded-full bg-muted">
          <div
            className={cn(
              "h-full rounded-full transition-[width] duration-200",
              item.status === "failed"
                ? "bg-destructive"
                : item.status === "cancelled"
                  ? "bg-warning"
                  : item.status === "completed"
                    ? "bg-success"
                    : "bg-primary",
            )}
            style={{ width: `${percent}%` }}
          />
        </div>
        <span className="selectable w-28 shrink-0 truncate text-right text-2xs text-muted-foreground/80">
          {detail(item)}
        </span>
      </div>

      <div className="mt-0.5 ml-[22px] flex items-center gap-2 text-2xs text-muted-foreground/70">
        <span className="truncate">
          {item.sourceLabel} → {item.targetLabel}
        </span>
        <span className="ml-auto shrink-0 tabular">
          {item.status === "completed" ? formatBytes(item.size) : `${Math.round(percent)}%`}
        </span>
      </div>
    </li>
  )
}

function detail(item: TransferItem_Serialize): string {
  if (item.status === "failed") return item.error ?? "Transfer failed"
  if (item.status === "cancelled") return "Stopped by you"
  if (item.status === "completed") return "Finished"
  if (item.status === "queued") return "Waiting for a slot"
  if (item.etaMs != null) return `${formatEta(item.etaMs)} left`
  return "Calculating…"
}
