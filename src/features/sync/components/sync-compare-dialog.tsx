import { useQueryClient } from "@tanstack/react-query"
import { useVirtualizer } from "@tanstack/react-virtual"
import { cn } from "cn"
import {
  AlertTriangleIcon,
  ArrowLeftRightIcon,
  LoaderCircleIcon,
  RefreshCwIcon,
} from "lucide-react"
import {
  type CSSProperties,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { LOCAL_SCOPE, remoteScope } from "@/features/files/api"
import { useFormatPreferences, useSettings } from "@/features/settings/settings-context"
import { syncApi } from "@/features/sync/api"
import {
  defaultSelection,
  isActionable,
  selectedBytes,
  selectedCount,
  selectionToTransferEntries,
  statusLabel,
} from "@/features/sync/model"
import { transfersApi } from "@/features/transfers/api"
import { errorMessage } from "@/lib/errors"
import { formatBytes } from "@/lib/format"
import type { SyncEntry_Serialize, SyncEntryStatus, SyncPlan_Serialize } from "@/lib/ipc/bindings"
import { recordActivity } from "@/stores/activity-store"
import { useSessionStore } from "@/stores/session-store"
import { useUiStore } from "@/stores/ui-store"

const ROW_HEIGHT = 38

/** Dry-run comparison between the current local and remote folders. */
export function SyncCompareDialog() {
  const open = useUiStore((state) => state.syncCompareOpen)
  const setOpen = useUiStore((state) => state.setSyncCompareOpen)
  const setBottomTab = useUiStore((state) => state.setBottomTab)
  const localPath = useUiStore((state) => state.localSummary.path)
  const remotePath = useUiStore((state) => state.remoteSummary.path)
  const activeSessionId = useSessionStore((state) => state.activeSessionId)
  const sessions = useSessionStore((state) => state.sessions)
  const { settings, updateSettings } = useSettings()
  const { sizeFormat } = useFormatPreferences()
  const queryClient = useQueryClient()

  const [plan, setPlan] = useState<SyncPlan_Serialize | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [filter, setFilter] = useState("")
  const [showEqual, setShowEqual] = useState(false)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  const sessionName = activeSessionId ? sessions[activeSessionId]?.name : null

  const load = useCallback(async () => {
    if (!localPath || !remotePath || !activeSessionId) return
    setLoading(true)
    setError(null)
    setPlan(null)
    setSelected(new Set())
    try {
      const next = await syncApi.compare(localPath, remoteScope(activeSessionId), remotePath)
      setPlan(next)
      setSelected(defaultSelection(next))
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setLoading(false)
    }
  }, [activeSessionId, localPath, remotePath])

  useEffect(() => {
    if (!open) return
    setFilter("")
    setShowEqual(false)
    void load()
  }, [open, load])

  const allEntries = useMemo(() => {
    if (!plan) return []
    return [...plan.entries].sort((left, right) =>
      left.relativePath.localeCompare(right.relativePath),
    )
  }, [plan])

  const deferredFilter = useDeferredValue(filter)
  const entries = useMemo(() => {
    const query = deferredFilter.trim().toLowerCase()
    return allEntries.filter(
      (entry) =>
        (showEqual || entry.status !== "equal") &&
        (!query || entry.relativePath.toLowerCase().includes(query)),
    )
  }, [allEntries, deferredFilter, showEqual])

  const visibleActionable = useMemo(() => entries.filter(isActionable), [entries])
  const allVisibleSelected =
    visibleActionable.length > 0 &&
    visibleActionable.every((entry) => selected.has(entry.relativePath))

  const counts = plan ? selectedCount(plan, selected) : { files: 0, directories: 0 }
  const bytes = plan ? selectedBytes(plan, selected) : 0
  const changed = useMemo(
    () =>
      plan?.entries.reduce((total, entry) => total + (entry.status === "different" ? 1 : 0), 0) ??
      0,
    [plan],
  )

  const virtualizer = useVirtualizer({
    count: entries.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
    getItemKey: (index) => entries[index]?.relativePath ?? index,
  })

  const toggle = (entry: SyncEntry_Serialize) => {
    if (!isActionable(entry)) return
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(entry.relativePath)) next.delete(entry.relativePath)
      else next.add(entry.relativePath)
      return next
    })
  }

  const toggleVisible = () => {
    setSelected((current) => {
      const next = new Set(current)
      for (const entry of visibleActionable) {
        if (allVisibleSelected) next.delete(entry.relativePath)
        else next.add(entry.relativePath)
      }
      return next
    })
  }

  const apply = async () => {
    if (!plan || !activeSessionId || busy) return
    const transferEntries = selectionToTransferEntries(plan, selected)
    if (transferEntries.length === 0) {
      toast.info("Select at least one file or folder to sync.")
      return
    }

    setBusy(true)
    setError(null)
    try {
      const items = await transfersApi.enqueueTree(
        LOCAL_SCOPE,
        remoteScope(activeSessionId),
        "overwrite",
        transferEntries,
        [],
      )
      const folders = transferEntries.filter((entry) => entry.kind === "directory").length
      if (items.length > 0) {
        toast.success(`Queued ${items.length} upload${items.length === 1 ? "" : "s"}`)
        recordActivity(
          "info",
          `Queued ${items.length} upload${items.length === 1 ? "" : "s"} from ${localPath} to ${sessionName ?? "remote"}`,
        )
      } else if (folders > 0) {
        toast.success(`Created ${folders} folder${folders === 1 ? "" : "s"}`)
        recordActivity(
          "info",
          `Created ${folders} folder${folders === 1 ? "" : "s"} in ${sessionName ?? "remote"}`,
        )
      }
      setBottomTab("transfers")
      if (!settings.bottomPanelOpen) {
        updateSettings({ bottomPanelOpen: true }).catch(() => {
          // The status bar still exposes the queue.
        })
      }
      void queryClient.invalidateQueries({ queryKey: ["fs"] })
      setOpen(false)
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setBusy(false)
    }
  }

  const missingPaths = !localPath || !remotePath || !activeSessionId

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && setOpen(next)}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ArrowLeftRightIcon className="size-4 text-primary" />
            Compare folders
          </DialogTitle>
          <DialogDescription className="selectable truncate font-mono text-2xs">
            {localPath ?? "No local folder"} → {remotePath ?? "No remote folder"}
            {sessionName ? ` · ${sessionName}` : ""}
          </DialogDescription>
        </DialogHeader>

        {missingPaths ? (
          <EmptyState
            title="Open both folders first"
            description="Navigate to a local folder and connect a remote session, then compare again."
          />
        ) : loading ? (
          <div className="flex h-52 flex-col items-center justify-center gap-2 text-xs text-muted-foreground">
            <LoaderCircleIcon className="size-5 animate-spin" />
            Comparing folders…
          </div>
        ) : error ? (
          <div className="flex h-52 flex-col items-center justify-center gap-3 text-center">
            <AlertTriangleIcon className="size-5 text-destructive" />
            <p className="max-w-md text-xs text-destructive" role="alert">
              {error}
            </p>
            <Button variant="outline" size="sm" onClick={() => void load()}>
              <RefreshCwIcon className="size-3.5" />
              Try again
            </Button>
          </div>
        ) : plan ? (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-2xs text-muted-foreground">
              <Summary label="To upload" value={plan.uploadFiles} />
              <Summary label="Folders" value={plan.createDirectories} />
              <Summary label="Changed" value={changed} />
              <Summary label="Equal" value={plan.equal} />
              <Summary label="Only remote" value={plan.remoteOnly} />
              {plan.unknown > 0 ? <Summary label="Unknown" value={plan.unknown} warning /> : null}
              {plan.conflicts > 0 ? (
                <Summary label="Conflicts" value={plan.conflicts} danger />
              ) : null}
              {plan.skipped > 0 ? <Summary label="Skipped" value={plan.skipped} /> : null}
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <Input
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
                placeholder="Filter by path…"
                className="h-8 flex-1 text-xs"
              />
              <span className="flex items-center gap-2 text-2xs text-muted-foreground">
                <Checkbox
                  checked={showEqual}
                  onCheckedChange={(value) => setShowEqual(value === true)}
                  aria-label="Show equal files"
                />
                Show equal
              </span>
            </div>

            <div className="overflow-hidden rounded-md border border-border">
              <div className="flex items-center gap-3 border-b border-border bg-panel-header px-3 py-2 text-2xs text-muted-foreground">
                <Checkbox
                  checked={allVisibleSelected}
                  disabled={visibleActionable.length === 0}
                  onCheckedChange={toggleVisible}
                  aria-label="Select visible changes"
                />
                <span className="flex-1">
                  {visibleActionable.length} change{visibleActionable.length === 1 ? "" : "s"}{" "}
                  visible
                </span>
                <span>{entries.length} entries</span>
              </div>
              <div ref={scrollRef} className="h-[42vh] overflow-auto">
                {entries.length === 0 ? (
                  <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
                    No entries match this filter.
                  </div>
                ) : (
                  <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
                    {virtualizer.getVirtualItems().map((row) => {
                      const entry = entries[row.index]
                      if (!entry) return null
                      return (
                        <SyncRow
                          key={entry.relativePath}
                          entry={entry}
                          selected={selected.has(entry.relativePath)}
                          sizeFormat={sizeFormat}
                          onToggle={() => toggle(entry)}
                          style={{
                            height: ROW_HEIGHT,
                            transform: `translateY(${row.start}px)`,
                          }}
                        />
                      )
                    })}
                  </div>
                )}
              </div>
            </div>

            {plan.truncated ? (
              <p className="text-2xs text-warning" role="status">
                Stopped at {plan.entries.length.toLocaleString()} entries. Compare a smaller folder
                for a complete plan.
              </p>
            ) : null}

            {plan.warnings.length > 0 ? (
              <details className="rounded-md border border-border bg-muted/30 px-3 py-2 text-2xs">
                <summary className="cursor-pointer text-muted-foreground">
                  {plan.warnings.length} warning{plan.warnings.length === 1 ? "" : "s"}
                </summary>
                <ul className="mt-2 space-y-1 text-muted-foreground">
                  {plan.warnings.slice(0, 20).map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              </details>
            ) : null}
          </div>
        ) : null}

        <DialogFooter className="gap-2 sm:justify-between">
          <p className="max-w-sm text-2xs text-muted-foreground">
            {plan ? `${formatBytes(bytes, sizeFormat)} selected. ` : ""}
            Remote-only files are kept. Changed files are replaced on the remote side.
          </p>
          <div className="flex items-center gap-2">
            <Button type="button" variant="ghost" disabled={busy} onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              disabled={busy || missingPaths || counts.files + counts.directories === 0}
              onClick={() => void apply()}
            >
              {busy
                ? "Queueing…"
                : counts.files > 0
                  ? `Sync ${counts.files} file${counts.files === 1 ? "" : "s"}`
                  : `Create ${counts.directories} folder${counts.directories === 1 ? "" : "s"}`}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function Summary({
  label,
  value,
  warning = false,
  danger = false,
}: {
  label: string
  value: number
  warning?: boolean
  danger?: boolean
}) {
  return (
    <span className={cn(danger && "text-destructive", warning && "text-warning")}>
      <strong className="font-semibold text-foreground">{value}</strong> {label.toLowerCase()}
    </span>
  )
}

function SyncRow({
  entry,
  selected,
  sizeFormat,
  onToggle,
  style,
}: {
  entry: SyncEntry_Serialize
  selected: boolean
  sizeFormat: "binary" | "decimal"
  onToggle: () => void
  style: CSSProperties
}) {
  const size = entry.localSize ?? entry.remoteSize ?? 0
  const directory = entry.localKind === "directory" || entry.remoteKind === "directory"
  return (
    <div
      className="absolute top-0 left-0 flex w-full items-center gap-3 border-b border-border/50 px-3"
      style={style}
    >
      <Checkbox
        checked={selected}
        disabled={!isActionable(entry)}
        onCheckedChange={onToggle}
        aria-label={`Select ${entry.relativePath}`}
      />
      <span className={cn("w-24 shrink-0 text-2xs", statusClass(entry.status))}>
        {statusLabel(entry.status)}
      </span>
      <span className="min-w-0 flex-1 truncate font-mono text-xs" title={entry.relativePath}>
        {entry.relativePath}
      </span>
      <span className="w-20 shrink-0 text-right text-2xs tabular text-muted-foreground">
        {directory ? "folder" : formatBytes(size, sizeFormat)}
      </span>
    </div>
  )
}

function statusClass(status: SyncEntryStatus): string {
  switch (status) {
    case "localOnly":
      return "text-primary"
    case "different":
    case "unknown":
      return "text-warning"
    case "typeMismatch":
      return "text-destructive"
    default:
      return "text-muted-foreground"
  }
}

function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="flex h-52 flex-col items-center justify-center gap-2 text-center">
      <AlertTriangleIcon className="size-5 text-muted-foreground" />
      <h3 className="text-sm font-medium text-foreground">{title}</h3>
      <p className="max-w-sm text-xs text-muted-foreground">{description}</p>
    </div>
  )
}
