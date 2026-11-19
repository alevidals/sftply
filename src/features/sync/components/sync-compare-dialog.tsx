import { useQueryClient } from "@tanstack/react-query"
import { useVirtualizer } from "@tanstack/react-virtual"
import { cn } from "cn"
import {
  AlertTriangleIcon,
  ArrowLeftRightIcon,
  LoaderCircleIcon,
  RefreshCwIcon,
  Trash2Icon,
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
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { LOCAL_SCOPE, remoteScope } from "@/features/files/api"
import { useFormatPreferences, useSettings } from "@/features/settings/settings-context"
import { syncApi } from "@/features/sync/api"
import {
  defaultSelection,
  isActionable,
  isSelectable,
  selectedBytes,
  selectedCount,
  selectionToTransferEntries,
  statusLabel,
} from "@/features/sync/model"
import { transfersApi } from "@/features/transfers/api"
import { errorMessage } from "@/lib/errors"
import { formatBytes } from "@/lib/format"
import type {
  SyncDirection,
  SyncEntry_Serialize,
  SyncEntryStatus,
  SyncPlan_Serialize,
} from "@/lib/ipc/bindings"
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
  const [direction, setDirection] = useState<SyncDirection>("upload")
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [filter, setFilter] = useState("")
  const [showEqual, setShowEqual] = useState(false)
  const [includeGlobs, setIncludeGlobs] = useState("")
  const [excludeGlobs, setExcludeGlobs] = useState("")
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleteTargets, setDeleteTargets] = useState<SyncEntry_Serialize[]>([])
  const [deleteConfirmed, setDeleteConfirmed] = useState(false)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const requestIdRef = useRef(0)

  const sessionName = activeSessionId ? sessions[activeSessionId]?.name : null

  const runCompare = useCallback(
    async (nextDirection: SyncDirection, include: string[], exclude: string[]) => {
      if (!localPath || !remotePath || !activeSessionId) return
      const requestId = ++requestIdRef.current
      setLoading(true)
      setError(null)
      setPlan(null)
      setSelected(new Set())
      setDeleteOpen(false)
      setDeleteTargets([])
      setDeleteConfirmed(false)
      setDeleteError(null)
      try {
        const next = await syncApi.compare(
          localPath,
          remoteScope(activeSessionId),
          remotePath,
          nextDirection,
          include,
          exclude,
        )
        if (requestId !== requestIdRef.current) return
        setPlan(next)
        setSelected(defaultSelection(next))
      } catch (cause) {
        if (requestId === requestIdRef.current) setError(errorMessage(cause))
      } finally {
        if (requestId === requestIdRef.current) setLoading(false)
      }
    },
    [activeSessionId, localPath, remotePath],
  )

  useEffect(() => {
    if (!open) return
    setFilter("")
    setShowEqual(false)
    setIncludeGlobs("")
    setExcludeGlobs("")
    setDirection("upload")
    void runCompare("upload", [], [])
  }, [open, runCompare])

  const changeDirection = (next: SyncDirection) => {
    if (loading || next === direction) return
    setDirection(next)
    void runCompare(next, globList(includeGlobs), globList(excludeGlobs))
  }

  const applyFilters = () => {
    if (loading) return
    void runCompare(direction, globList(includeGlobs), globList(excludeGlobs))
  }

  const close = () => {
    if (busy) return
    requestIdRef.current += 1
    if (loading) void syncApi.cancel().catch(() => {})
    setOpen(false)
  }

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
        (showEqual || (entry.status !== "equal" && entry.status !== "equalContent")) &&
        (!query || entry.relativePath.toLowerCase().includes(query)),
    )
  }, [allEntries, deferredFilter, showEqual])

  const visibleActionable = useMemo(() => entries.filter(isActionable), [entries])
  const allVisibleSelected =
    visibleActionable.length > 0 &&
    visibleActionable.every((entry) => selected.has(entry.relativePath))

  const counts = plan ? selectedCount(plan, selected) : { files: 0, directories: 0 }
  const bytes = plan ? selectedBytes(plan, selected) : 0
  const targetOnly = useMemo(() => {
    if (!plan) return []
    return plan.entries.filter((entry) =>
      plan.direction === "upload" ? entry.status === "remoteOnly" : entry.status === "localOnly",
    )
  }, [plan])

  const openDelete = (targets: SyncEntry_Serialize[]) => {
    if (targets.length === 0) return
    setDeleteTargets(targets)
    setDeleteConfirmed(false)
    setDeleteError(null)
    setDeleteOpen(true)
  }

  const confirmDelete = async () => {
    if (!plan || !activeSessionId || deleteBusy || !deleteConfirmed || deleteTargets.length === 0) {
      return
    }
    setDeleteBusy(true)
    setDeleteError(null)
    try {
      const deleted = await syncApi.delete(
        remoteScope(activeSessionId),
        plan.direction,
        deleteTargets,
      )
      toast.success(`Deleted ${deleted} item${deleted === 1 ? "" : "s"}`)
      setDeleteOpen(false)
      void runCompare(plan.direction, globList(includeGlobs), globList(excludeGlobs))
    } catch (cause) {
      setDeleteError(errorMessage(cause))
    } finally {
      setDeleteBusy(false)
    }
  }

  const virtualizer = useVirtualizer({
    count: entries.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
    getItemKey: (index) => entries[index]?.relativePath ?? index,
  })

  const toggle = (entry: SyncEntry_Serialize) => {
    if (!isSelectable(entry)) return
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
      const selectedEntries = plan.entries.filter(
        (entry) => selected.has(entry.relativePath) && isSelectable(entry),
      )
      const issues = await syncApi.validate(
        remoteScope(activeSessionId),
        plan.direction,
        selectedEntries,
      )
      if (issues.length > 0) {
        const first = issues[0]
        toast.error("The target folder changed", {
          description: first
            ? `${first.relativePath}: ${first.reason} The plan will be refreshed.`
            : "The plan will be refreshed.",
        })
        void runCompare(plan.direction, globList(includeGlobs), globList(excludeGlobs))
        return
      }

      const remote = remoteScope(activeSessionId)
      const source = plan.direction === "upload" ? LOCAL_SCOPE : remote
      const target = plan.direction === "upload" ? remote : LOCAL_SCOPE
      const verb = plan.direction === "upload" ? "upload" : "download"
      const items = await transfersApi.enqueueTree(source, target, "overwrite", transferEntries, [])
      const folders = transferEntries.filter((entry) => entry.kind === "directory").length
      if (items.length > 0) {
        toast.success(`Queued ${items.length} ${verb}${items.length === 1 ? "" : "s"}`)
        recordActivity(
          "info",
          plan.direction === "upload"
            ? `Queued ${items.length} upload${items.length === 1 ? "" : "s"} from ${localPath} to ${sessionName ?? "remote"}`
            : `Queued ${items.length} download${items.length === 1 ? "" : "s"} from ${sessionName ?? "remote"} to ${localPath}`,
        )
      } else if (folders > 0) {
        toast.success(`Created ${folders} folder${folders === 1 ? "" : "s"}`)
        recordActivity(
          "info",
          `Created ${folders} folder${folders === 1 ? "" : "s"} in ${plan.direction === "upload" ? (sessionName ?? "remote") : localPath}`,
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
    <>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!next) close()
        }}
      >
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ArrowLeftRightIcon className="size-4 text-primary" />
              Compare folders
            </DialogTitle>
            <DialogDescription className="selectable truncate font-mono text-2xs">
              {direction === "upload"
                ? `${localPath ?? "No local folder"} → ${remotePath ?? "No remote folder"}`
                : `${remotePath ?? "No remote folder"} → ${localPath ?? "No local folder"}`}
              {sessionName ? ` · ${sessionName}` : ""}
            </DialogDescription>
            <div className="flex items-center gap-1">
              <span className="mr-1 text-2xs text-muted-foreground">Direction</span>
              <Button
                type="button"
                size="sm"
                variant={direction === "upload" ? "default" : "outline"}
                disabled={loading}
                onClick={() => changeDirection("upload")}
              >
                Local → remote
              </Button>
              <Button
                type="button"
                size="sm"
                variant={direction === "download" ? "default" : "outline"}
                disabled={loading}
                onClick={() => changeDirection("download")}
              >
                Remote → local
              </Button>
            </div>
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
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  void runCompare(direction, globList(includeGlobs), globList(excludeGlobs))
                }
              >
                <RefreshCwIcon className="size-3.5" />
                Try again
              </Button>
            </div>
          ) : plan ? (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-2xs text-muted-foreground">
                <Summary
                  label={plan.direction === "upload" ? "To upload" : "To download"}
                  value={plan.transferFiles}
                />
                <Summary label="Folders" value={plan.createDirectories} />
                <Summary label="Changed" value={plan.changed} />
                <Summary label="Date differs" value={plan.dateDiffers} warning />
                <Summary label="Equal" value={plan.equal} />
                <Summary label="Only local" value={plan.localOnly} />
                <Summary label="Only remote" value={plan.remoteOnly} />
                {plan.unknown > 0 ? <Summary label="Unknown" value={plan.unknown} warning /> : null}
                {plan.conflicts > 0 ? (
                  <Summary label="Conflicts" value={plan.conflicts} danger />
                ) : null}
                {plan.skipped > 0 ? <Summary label="Skipped" value={plan.skipped} /> : null}
              </div>

              <p className="text-2xs text-muted-foreground">
                Compare uses size and date. Small files with a different date are checked by
                content; larger files stay as “Date differs” for review. Globs are relative to the
                compared folders.
              </p>

              {targetOnly.length > 0 ? (
                <div className="flex flex-wrap items-center gap-2 rounded-md border border-border/70 bg-muted/20 px-3 py-2 text-2xs text-muted-foreground">
                  <Trash2Icon className="size-3.5 shrink-0" />
                  <span className="min-w-0 flex-1 text-foreground">
                    {targetOnly.length} item{targetOnly.length === 1 ? "" : "s"}{" "}
                    <span className="text-muted-foreground">
                      exist
                      {plan.direction === "download" ? " only locally" : " only remotely"} and are
                      kept by default. Use the trash icon on a row, or delete them all.
                    </span>
                  </span>
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    className="shrink-0"
                    aria-label={`Delete all ${targetOnly.length} ${plan.direction === "download" ? "local-only" : "remote-only"} items`}
                    onClick={() => openDelete(targetOnly)}
                  >
                    <Trash2Icon className="size-3.5" />
                    Delete all {targetOnly.length}…
                  </Button>
                </div>
              ) : null}

              <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
                <Input
                  value={includeGlobs}
                  onChange={(event) => setIncludeGlobs(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !loading) applyFilters()
                  }}
                  placeholder="Include: src/**, **/*.md"
                  aria-label="Include globs"
                  className="h-8 text-xs"
                />
                <Input
                  value={excludeGlobs}
                  onChange={(event) => setExcludeGlobs(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !loading) applyFilters()
                  }}
                  placeholder="Exclude: node_modules/**, .git/**"
                  aria-label="Exclude globs"
                  className="h-8 text-xs"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={loading}
                  onClick={applyFilters}
                >
                  Apply filters
                </Button>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <Input
                  value={filter}
                  onChange={(event) => setFilter(event.target.value)}
                  placeholder="Filter results…"
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
                            targetOnly={
                              plan.direction === "upload"
                                ? entry.status === "remoteOnly"
                                : entry.status === "localOnly"
                            }
                            deleteLabel={
                              plan.direction === "upload"
                                ? "Delete from remote"
                                : "Delete from local"
                            }
                            onDelete={() => openDelete([entry])}
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
                  Stopped at {plan.entries.length.toLocaleString()} entries. Compare a smaller
                  folder for a complete plan.
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
              Date-only differences are not selected by default.{" "}
              {plan?.direction === "download"
                ? "Local-only items are kept unless you delete them explicitly."
                : "Remote-only items are kept unless you delete them explicitly."}
            </p>
            <div className="flex items-center gap-2">
              <Button type="button" variant="ghost" disabled={busy} onClick={close}>
                {loading ? "Stop comparing" : "Cancel"}
              </Button>
              <Button
                type="button"
                disabled={busy || missingPaths || counts.files + counts.directories === 0}
                onClick={() => void apply()}
              >
                {busy
                  ? "Queueing…"
                  : counts.files > 0
                    ? `${plan?.direction === "download" ? "Download" : "Upload"} ${counts.files} file${counts.files === 1 ? "" : "s"}`
                    : `Create ${counts.directories} folder${counts.directories === 1 ? "" : "s"}`}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={deleteOpen}
        onOpenChange={(next) => {
          if (!deleteBusy) setDeleteOpen(next)
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangleIcon className="size-4 text-destructive" />
              Delete {deleteTargets.length === 1 ? "this item" : "these items"}?
            </DialogTitle>
            <DialogDescription>
              {deleteTargets.length === 1 ? "This item exists" : "These items exist"} only in the{" "}
              {plan?.direction === "download" ? "local" : "remote"} folder. Folders are deleted with
              their contents. This cannot be undone.
            </DialogDescription>
          </DialogHeader>

          <div className="max-h-44 space-y-1 overflow-auto rounded-md border border-border bg-muted/30 p-2 text-2xs">
            {deleteTargets.slice(0, 30).map((entry) => (
              <div key={entry.relativePath} className="flex items-center gap-3">
                <span className="selectable min-w-0 flex-1 truncate font-mono text-muted-foreground">
                  {entry.relativePath}
                </span>
                <span className="shrink-0 text-muted-foreground/80">
                  {entry.localKind === "directory" || entry.remoteKind === "directory"
                    ? "folder"
                    : "file"}
                </span>
              </div>
            ))}
            {deleteTargets.length > 30 ? (
              <div className="text-muted-foreground">…and {deleteTargets.length - 30} more</div>
            ) : null}
          </div>

          <span className="flex items-center gap-2 text-xs text-muted-foreground">
            <Checkbox
              checked={deleteConfirmed}
              onCheckedChange={(value) => setDeleteConfirmed(value === true)}
              aria-label="I understand these items will be permanently deleted"
            />
            I understand these items will be permanently deleted.
          </span>

          {deleteError ? (
            <p className="text-xs text-destructive" role="alert">
              {deleteError}
            </p>
          ) : null}

          <DialogFooter className="gap-2 sm:justify-between">
            <Button
              type="button"
              variant="ghost"
              disabled={deleteBusy}
              onClick={() => setDeleteOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={!deleteConfirmed || deleteBusy}
              onClick={() => void confirmDelete()}
            >
              {deleteBusy
                ? "Deleting…"
                : `Delete ${deleteTargets.length} item${deleteTargets.length === 1 ? "" : "s"}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
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
  targetOnly,
  deleteLabel,
  onDelete,
  onToggle,
  style,
}: {
  entry: SyncEntry_Serialize
  selected: boolean
  sizeFormat: "binary" | "decimal"
  targetOnly: boolean
  deleteLabel: string
  onDelete: () => void
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
      <span className="flex w-6 shrink-0 items-center justify-center">
        {targetOnly ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                className="text-muted-foreground hover:text-destructive"
                aria-label={`${deleteLabel}: ${entry.relativePath}`}
                onClick={onDelete}
              >
                <Trash2Icon className="size-3" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top" sideOffset={6}>
              {deleteLabel}
            </TooltipContent>
          </Tooltip>
        ) : (
          <Checkbox
            checked={selected}
            disabled={!isSelectable(entry)}
            onCheckedChange={onToggle}
            aria-label={`Select ${entry.relativePath}`}
          />
        )}
      </span>
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
    case "sizeDiffers":
    case "dateDiffers":
    case "contentDiffers":
    case "unknown":
      return "text-warning"
    case "typeMismatch":
      return "text-destructive"
    default:
      return "text-muted-foreground"
  }
}

function globList(value: string): string[] {
  return value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
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
