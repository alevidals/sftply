import { useQueryClient } from "@tanstack/react-query"
import { cn } from "cn"
import {
  AlertTriangleIcon,
  ArrowDownToLineIcon,
  Columns3Icon,
  EyeIcon,
  EyeOffIcon,
  FolderOpenIcon,
  FolderPlusIcon,
  FolderSearchIcon,
  InfoIcon,
  LoaderCircleIcon,
  type LucideIcon,
  MoreHorizontalIcon,
  PencilIcon,
  RefreshCwIcon,
  SearchIcon,
  SearchXIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { toast } from "sonner"
import { tinykeys } from "tinykeys"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { filesApi, localFiles, scopeKey } from "@/features/files/api"
import { ColumnHeader } from "@/features/files/components/column-header"
import {
  DeleteDialog,
  NewFolderDialog,
  PermissionsDialog,
} from "@/features/files/components/file-dialogs"
import { type FileAction, FileTable } from "@/features/files/components/file-table"
import { PathBar } from "@/features/files/components/path-bar"
import { useFsListing } from "@/features/files/hooks/use-fs-listing"
import { usePathNavigation } from "@/features/files/hooks/use-path-navigation"
import { type ColumnOptions, fileGridTemplate } from "@/features/files/model/columns"
import { parentPath } from "@/features/files/model/path"
import {
  clearSelection,
  EMPTY_SELECTION,
  focusRow,
  moveSelection,
  pruneSelection,
  type SelectionMode,
  type SelectionState,
  selectAll,
  selectByPrefix,
  selectRow,
} from "@/features/files/model/selection"
import { DEFAULT_SORT, nextSort, type SortState, sortEntries } from "@/features/files/model/sort"
import { useSettings } from "@/features/settings/settings-context"
import { normalizeError } from "@/lib/errors"
import { formatCount, formatMode } from "@/lib/format"
import type { FsEntry, FsScope } from "@/lib/ipc/bindings"
import { recordActivity } from "@/stores/activity-store"
import { useUiStore } from "@/stores/ui-store"

interface DirectoryBrowserProps {
  pane: "local" | "remote"
  title: string
  icon: LucideIcon
  scope: FsScope
  initialPath: string
  /** Whether files can be opened (local) or only folders navigated (remote). */
  allowOpenFile: boolean
  allowReveal: boolean
  /** Persist the current folder (local settings). */
  onPathChange?: (path: string) => void
  /** Extra header content, e.g. protocol/latency badges. */
  headerExtra?: React.ReactNode
  emptyDescription?: string
  /** Footer status text, for example "Local filesystem" or the protocol. */
  statusLabel?: string
  /** Optional location for the error state's "Go home" action. */
  homePath?: string
  /** Cancel the in-flight remote operation, when supported by the scope. */
  onCancel?: () => void
}

export function DirectoryBrowser({
  pane,
  title,
  icon: PaneIcon,
  scope,
  initialPath,
  allowOpenFile,
  allowReveal,
  onPathChange,
  headerExtra,
  emptyDescription,
  statusLabel,
  homePath,
  onCancel,
}: DirectoryBrowserProps) {
  const { settings, updateSettings } = useSettings()
  const queryClient = useQueryClient()
  const activePane = useUiStore((state) => state.activePane)
  const setActivePane = useUiStore((state) => state.setActivePane)
  const setLocalSummary = useUiStore((state) => state.setLocalSummary)
  const setRemoteSummary = useUiStore((state) => state.setRemoteSummary)

  const navigation = usePathNavigation(initialPath)
  const { path, navigate, back, forward, canBack, canForward } = navigation
  const listingQuery = useFsListing(scope, path, settings.showHiddenFiles)
  const listing = listingQuery.data ?? null
  const isActive = activePane === pane

  const [sort, setSort] = useState<SortState>(DEFAULT_SORT)
  const [columns, setColumns] = useState<ColumnOptions>({ permissions: true })
  const [filter, setFilter] = useState("")
  const [filterOpen, setFilterOpen] = useState(false)
  const [selection, setSelection] = useState<SelectionState>(EMPTY_SELECTION)
  const [renamingPath, setRenamingPath] = useState<string | null>(null)
  const [newFolderOpen, setNewFolderOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [permissionsOpen, setPermissionsOpen] = useState(false)
  const [permissionsTarget, setPermissionsTarget] = useState<FsEntry | null>(null)

  const rowHeight = settings.density === "comfortable" ? 38 : 30
  const canChmod = listing?.capabilities.chmod ?? false
  const canMkdir = listing?.capabilities.mkdir ?? false
  const canRename = listing?.capabilities.rename ?? false
  const canRemove = listing?.capabilities.remove ?? false

  const entries = useMemo(() => {
    const source = listing?.entries ?? []
    const needle = filter.trim().toLocaleLowerCase()
    const filtered = needle
      ? source.filter((entry) => entry.name.toLocaleLowerCase().includes(needle))
      : source
    return sortEntries(filtered, sort)
  }, [listing, filter, sort])

  const activeEntry = selection.active === null ? null : (entries[selection.active] ?? null)
  const selectedEntries = useMemo(
    () => entries.filter((entry) => selection.selected.has(entry.path)),
    [entries, selection.selected],
  )
  const parent = listing?.parent ?? (path ? parentPath(path) : null)

  const reportError = useCallback((title: string, error: unknown) => {
    const normalized = normalizeError(error)
    toast.error(title, { description: normalized.message })
    recordActivity("error", `${title}: ${normalized.message}`)
  }, [])

  const invalidate = useCallback(
    () => queryClient.invalidateQueries({ queryKey: ["fs", scopeKey(scope)] }),
    [queryClient, scope],
  )

  // biome-ignore lint/correctness/useExhaustiveDependencies: reset transient UI state when the folder changes
  useEffect(() => {
    setSelection(EMPTY_SELECTION)
    setFilter("")
    setFilterOpen(false)
    setRenamingPath(null)
    setPermissionsTarget(null)
  }, [path])

  useEffect(() => {
    setSelection((current) => pruneSelection(entries, current))
  }, [entries])

  // Clearing the active row after a re-sort or filter keeps keyboard focus
  // honest, because the row at an index may now be a different file.
  // biome-ignore lint/correctness/useExhaustiveDependencies: run only when ordering changes
  useEffect(() => {
    setSelection((current) =>
      current.active === null && current.anchor === null
        ? current
        : { ...current, active: null, anchor: null },
    )
  }, [sort.column, sort.direction, filter])

  useEffect(() => {
    if (path) onPathChange?.(path)
  }, [path, onPathChange])

  useEffect(() => {
    const summary = {
      path,
      items: entries.length,
      selected: selection.selected.size,
    }
    if (pane === "local") setLocalSummary(summary)
    else setRemoteSummary(summary)
  }, [pane, path, entries.length, selection.selected.size, setLocalSummary, setRemoteSummary])

  const openEntry = useCallback(
    (entry: FsEntry) => {
      if (entry.kind === "directory") {
        navigate(entry.path)
        return
      }
      if (!allowOpenFile) {
        toast.info("Opening remote files will arrive with transfers.")
        return
      }
      localFiles.open(entry.path).catch((error) => {
        reportError(`Could not open “${entry.name}”`, error)
      })
    },
    [allowOpenFile, navigate, reportError],
  )

  const revealEntry = useCallback(
    (entry: FsEntry) => {
      if (!allowReveal) return
      localFiles.reveal(entry.path).catch((error) => {
        reportError(`Could not reveal “${entry.name}”`, error)
      })
    },
    [allowReveal, reportError],
  )

  const handleAction = useCallback(
    (action: FileAction) => {
      switch (action) {
        case "open":
          if (activeEntry) openEntry(activeEntry)
          break
        case "rename":
          if (activeEntry) setRenamingPath(activeEntry.path)
          break
        case "delete":
          if (selectedEntries.length > 0) setDeleteOpen(true)
          break
        case "reveal":
          if (activeEntry && allowReveal) revealEntry(activeEntry)
          break
        case "permissions":
          if (activeEntry && canChmod && selection.selected.size === 1) {
            setPermissionsTarget(activeEntry)
            setPermissionsOpen(true)
          }
          break
        case "new-folder":
          setNewFolderOpen(true)
          break
      }
    },
    [
      activeEntry,
      allowReveal,
      canChmod,
      openEntry,
      revealEntry,
      selectedEntries.length,
      selection.selected.size,
    ],
  )

  const createFolder = async (name: string) => {
    if (!listing) throw new Error("No folder is loaded.")
    await filesApi(scope).mkdir(listing.path, name)
    await invalidate()
    recordActivity("success", `Created folder “${name}”`)
    toast.success(`Created “${name}”`)
  }

  const renameEntry = async (entry: FsEntry, name: string) => {
    setRenamingPath(null)
    try {
      await filesApi(scope).rename(entry.path, name)
      await invalidate()
      recordActivity("success", `Renamed “${entry.name}” to “${name}”`)
      toast.success(`Renamed to “${name}”`)
    } catch (error) {
      reportError(`Could not rename “${entry.name}”`, error)
    }
  }

  const deleteEntries = async (recursive: boolean) => {
    if (selectedEntries.length === 0) return
    let lastError: unknown = null

    for (const entry of selectedEntries) {
      try {
        await filesApi(scope).remove(entry.path, recursive && entry.kind === "directory")
      } catch (error) {
        lastError = error
        reportError(`Could not delete “${entry.name}”`, error)
      }
    }

    await invalidate()
    setSelection(EMPTY_SELECTION)

    if (lastError) throw lastError

    const message =
      selectedEntries.length === 1
        ? `Deleted “${selectedEntries[0]?.name ?? "item"}”`
        : `Deleted ${selectedEntries.length} items`
    recordActivity("success", message)
    toast.success(message)
  }

  const applyPermissions = async (mode: number) => {
    if (!permissionsTarget) throw new Error("No item is selected.")
    await filesApi(scope).chmod(permissionsTarget.path, mode)
    await invalidate()
    recordActivity(
      "success",
      `Changed permissions on “${permissionsTarget.name}” to ${formatMode(mode)}`,
    )
    toast.success("Permissions updated")
  }

  const refresh = () => {
    listingQuery.refetch().catch((error) => {
      reportError("Could not refresh the folder", error)
    })
  }

  const toggleHidden = () => {
    updateSettings({ showHiddenFiles: !settings.showHiddenFiles }).catch((error) => {
      reportError("Could not update hidden files", error)
    })
  }

  const goHome = () => {
    if (homePath) navigate(homePath)
  }

  const shortcutActions = useRef({
    refresh,
    openFilter: () => setFilterOpen(true),
    openNewFolder: () => setNewFolderOpen(true),
  })
  shortcutActions.current = {
    refresh,
    openFilter: () => setFilterOpen(true),
    openNewFolder: () => setNewFolderOpen(true),
  }

  useEffect(
    () =>
      tinykeys(window, {
        "$mod+KeyR": (event) => {
          const ui = useUiStore.getState()
          if (ui.activePane !== pane || ui.paletteOpen || ui.settingsOpen) return
          event.preventDefault()
          shortcutActions.current.refresh()
        },
        "$mod+KeyF": (event) => {
          const ui = useUiStore.getState()
          if (ui.activePane !== pane || ui.paletteOpen || ui.settingsOpen) return
          event.preventDefault()
          shortcutActions.current.openFilter()
        },
        "$mod+Shift+KeyN": (event) => {
          const ui = useUiStore.getState()
          if (ui.activePane !== pane || ui.paletteOpen || ui.settingsOpen) return
          event.preventDefault()
          shortcutActions.current.openNewFolder()
        },
      }),
    [pane],
  )

  const select = (index: number, mode: SelectionMode) => {
    setSelection((current) => selectRow(entries, current, index, mode))
  }

  return (
    <section
      id={`pane-${pane}`}
      aria-label={`${title} pane`}
      tabIndex={-1}
      onFocus={() => setActivePane(pane)}
      data-active={isActive}
      className={cn(
        "flex h-full min-h-0 flex-col bg-background outline-none",
        "data-[active=true]:ring-1 data-[active=true]:ring-primary/15 data-[active=true]:ring-inset",
      )}
    >
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border/70 bg-panel-header px-3">
        <PaneIcon className={cn("size-3.5", isActive ? "text-primary" : "text-muted-foreground")} />
        <span className="min-w-0 truncate text-xs font-semibold text-foreground">{title}</span>
        <Badge variant="secondary" className="h-4.5 px-1.5 text-[10px] font-medium">
          {listing ? `${formatCount(listing.entries.length)} items` : "…"}
        </Badge>
        {headerExtra}

        <div className="ml-auto flex items-center gap-0.5">
          <ToolbarButton
            label="New folder"
            shortcut="⌘⇧N"
            disabled={!listing || !canMkdir}
            onClick={() => setNewFolderOpen(true)}
          >
            <FolderPlusIcon />
          </ToolbarButton>
          <ToolbarButton
            label={listingQuery.isFetching ? "Refreshing…" : "Refresh"}
            disabled={!listing}
            onClick={refresh}
          >
            <RefreshCwIcon className={cn(listingQuery.isFetching && "animate-spin")} />
          </ToolbarButton>
          {onCancel && listingQuery.isFetching ? (
            <ToolbarButton label="Cancel this operation" onClick={onCancel}>
              <XIcon />
            </ToolbarButton>
          ) : null}
          <ActionsMenu
            canOpen={Boolean(activeEntry) && (activeEntry?.kind === "directory" || allowOpenFile)}
            canRename={Boolean(activeEntry) && canRename}
            canDelete={selectedEntries.length > 0 && canRemove}
            canPermissions={Boolean(activeEntry) && canChmod && selection.selected.size === 1}
            canReveal={allowReveal}
            onAction={handleAction}
          />
        </div>
      </div>

      {path ? (
        <PathBar
          path={path}
          canBack={canBack}
          canForward={canForward}
          canUp={Boolean(parent)}
          onBack={back}
          onForward={forward}
          onUp={() => parent && navigate(parent)}
          onNavigate={navigate}
        >
          {filterOpen ? (
            <FilterBox
              value={filter}
              onChange={setFilter}
              onClose={() => {
                setFilter("")
                setFilterOpen(false)
              }}
            />
          ) : (
            <ToolbarButton
              label="Filter this folder"
              shortcut="⌘F"
              onClick={() => setFilterOpen(true)}
            >
              <SearchIcon />
            </ToolbarButton>
          )}

          <ToolbarButton
            label={settings.showHiddenFiles ? "Hide hidden files" : "Show hidden files"}
            active={settings.showHiddenFiles}
            onClick={toggleHidden}
          >
            {settings.showHiddenFiles ? <EyeIcon /> : <EyeOffIcon />}
          </ToolbarButton>

          <DropdownMenu>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label="View options"
                    className={cn(
                      "text-muted-foreground",
                      columns.permissions && "text-foreground",
                    )}
                  >
                    <Columns3Icon />
                  </Button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent side="bottom" sideOffset={6}>
                View options
              </TooltipContent>
            </Tooltip>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuLabel>Columns</DropdownMenuLabel>
              <DropdownMenuCheckboxItem
                checked={columns.permissions}
                onCheckedChange={(checked) =>
                  setColumns((current) => ({ ...current, permissions: checked }))
                }
              >
                Permissions
              </DropdownMenuCheckboxItem>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>Rows</DropdownMenuLabel>
              <DropdownMenuCheckboxItem
                checked={settings.density === "comfortable"}
                onCheckedChange={(checked) => {
                  updateSettings({ density: checked ? "comfortable" : "compact" }).catch(
                    (error) => {
                      reportError("Could not update row density", error)
                    },
                  )
                }}
              >
                Comfortable
              </DropdownMenuCheckboxItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </PathBar>
      ) : (
        <div className="h-9 shrink-0 border-b border-border/60 bg-background/40" />
      )}

      <ColumnHeader
        sort={sort}
        columns={columns}
        onSort={(column) => setSort((s) => nextSort(s, column))}
      />

      {listing && listing.warnings.length > 0 ? (
        <div className="flex shrink-0 items-start gap-2 border-b border-warning/20 bg-warning/10 px-3 py-1.5 text-2xs text-warning">
          <AlertTriangleIcon className="mt-px size-3 shrink-0" />
          <span>{listing.warnings.join(" ")}</span>
        </div>
      ) : null}

      {listingQuery.isError ? (
        <PaneError
          error={listingQuery.error}
          onRetry={() => void listingQuery.refetch()}
          onHome={homePath ? goHome : undefined}
        />
      ) : listingQuery.isPending ? (
        <TableSkeleton columns={columns} rowHeight={rowHeight} />
      ) : entries.length === 0 ? (
        <PaneEmpty
          filtered={filter.trim().length > 0 && (listing?.entries.length ?? 0) > 0}
          description={emptyDescription}
          onNewFolder={() => canMkdir && setNewFolderOpen(true)}
          onClearFilter={() => {
            setFilter("")
            setFilterOpen(false)
          }}
        />
      ) : (
        <FileTable
          entries={entries}
          selection={selection}
          columns={columns}
          rowHeight={rowHeight}
          renamingPath={renamingPath}
          canChmod={canChmod}
          allowOpen={allowOpenFile}
          allowReveal={allowReveal}
          onSelect={select}
          onSelectAll={() => setSelection(selectAll(entries))}
          onClearSelection={() => setSelection(clearSelection(entries))}
          onMove={(delta, extend) =>
            setSelection((current) => moveSelection(entries, current, delta, extend))
          }
          onFocusRow={(index, extend) =>
            setSelection((current) => focusRow(entries, current, index, extend))
          }
          onTypeAhead={(prefix) =>
            setSelection((current) => selectByPrefix(entries, current, prefix) ?? current)
          }
          onAction={handleAction}
          onUp={() => parent && navigate(parent)}
          onRenameSubmit={renameEntry}
          onRenameCancel={() => setRenamingPath(null)}
        />
      )}

      <div className="flex h-7 shrink-0 items-center gap-3 border-t border-border/60 px-3 text-2xs text-muted-foreground">
        <span>
          {formatCount(entries.length)} items
          {filter.trim() && listing ? ` of ${formatCount(listing.entries.length)}` : ""}
        </span>
        {selection.selected.size > 0 ? (
          <span className="text-foreground">{formatCount(selection.selected.size)} selected</span>
        ) : null}
        <span className="ml-auto flex items-center gap-1.5">
          {listingQuery.isFetching ? (
            <>
              <LoaderCircleIcon className="size-3 animate-spin" />
              Refreshing
            </>
          ) : (
            <>
              <span className="size-1.5 rounded-full bg-success" />
              {statusLabel ?? (pane === "local" ? "Local filesystem" : "Remote session")}
            </>
          )}
        </span>
      </div>

      <NewFolderDialog
        open={newFolderOpen}
        parentPath={listing?.path ?? path ?? ""}
        onOpenChange={setNewFolderOpen}
        onCreate={createFolder}
      />
      <DeleteDialog
        open={deleteOpen}
        entries={selectedEntries}
        onOpenChange={setDeleteOpen}
        onConfirm={deleteEntries}
      />
      <PermissionsDialog
        open={permissionsOpen}
        entry={permissionsTarget}
        onOpenChange={setPermissionsOpen}
        onConfirm={applyPermissions}
      />
    </section>
  )
}

function ToolbarButton({
  label,
  shortcut,
  disabled,
  active,
  onClick,
  children,
}: {
  label: string
  shortcut?: string
  disabled?: boolean
  active?: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={label}
          disabled={disabled}
          onClick={onClick}
          className={cn("text-muted-foreground", active && "bg-muted/60 text-foreground")}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={6}>
        {label}
        {shortcut ? <span className="ml-1 text-muted-foreground">{shortcut}</span> : null}
      </TooltipContent>
    </Tooltip>
  )
}

function ActionsMenu({
  canOpen,
  canRename,
  canDelete,
  canPermissions,
  canReveal,
  onAction,
}: {
  canOpen: boolean
  canRename: boolean
  canDelete: boolean
  canPermissions: boolean
  canReveal: boolean
  onAction: (action: FileAction) => void
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-xs" aria-label="File actions">
          <MoreHorizontalIcon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>File actions</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={!canOpen} onSelect={() => onAction("open")}>
          <ArrowDownToLineIcon />
          Open
          <DropdownMenuShortcut>↩</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem disabled={!canRename} onSelect={() => onAction("rename")}>
          <PencilIcon />
          Rename
          <DropdownMenuShortcut>F2</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onAction("new-folder")}>
          <FolderPlusIcon />
          New folder
          <DropdownMenuShortcut>⌘⇧N</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem disabled={!canDelete} onSelect={() => onAction("delete")}>
          <Trash2Icon />
          Delete
          <DropdownMenuShortcut>⌫</DropdownMenuShortcut>
        </DropdownMenuItem>
        {canReveal ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => onAction("reveal")}>
              <FolderSearchIcon />
              Reveal in file manager
            </DropdownMenuItem>
          </>
        ) : null}
        <DropdownMenuItem disabled={!canPermissions} onSelect={() => onAction("permissions")}>
          <InfoIcon />
          Permissions…
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function FilterBox({
  value,
  onChange,
  onClose,
}: {
  value: string
  onChange: (value: string) => void
  onClose: () => void
}) {
  const ref = useRef<HTMLInputElement>(null)

  useEffect(() => {
    ref.current?.focus()
  }, [])

  return (
    <div className="relative">
      <SearchIcon className="pointer-events-none absolute top-1/2 left-1.5 size-3 -translate-y-1/2 text-muted-foreground" />
      <Input
        ref={ref}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault()
            onClose()
          }
        }}
        placeholder="Filter…"
        aria-label="Filter this folder"
        spellCheck={false}
        className="h-6 w-40 pr-6 pl-6 text-[11px]"
      />
      <button
        type="button"
        aria-label="Close filter"
        onClick={onClose}
        className="absolute top-1/2 right-1 flex size-4 -translate-y-1/2 items-center justify-center rounded text-muted-foreground hover:text-foreground"
      >
        <XIcon className="size-3" />
      </button>
    </div>
  )
}

const SKELETON_WIDTHS = [42, 68, 55, 74, 38, 61, 48, 70, 57, 44]

function TableSkeleton({ columns, rowHeight }: { columns: ColumnOptions; rowHeight: number }) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      aria-label="Loading folder"
      className="min-h-0 flex-1 overflow-hidden"
    >
      {SKELETON_WIDTHS.map((width) => (
        <div
          key={width}
          className="grid items-center gap-3 border-b border-border/30 px-3"
          style={{ gridTemplateColumns: fileGridTemplate(columns), height: rowHeight }}
        >
          <div className="flex items-center gap-2">
            <Skeleton className="size-3.5 rounded-sm" />
            <Skeleton className="h-3 rounded-sm" style={{ width: `${width}%` }} />
          </div>
          <Skeleton className="ml-auto h-3 w-12 rounded-sm" />
          <Skeleton className="ml-auto h-3 w-16 rounded-sm" />
          {columns.permissions ? <Skeleton className="ml-auto h-3 w-8 rounded-sm" /> : null}
        </div>
      ))}
    </div>
  )
}

function PaneEmpty({
  filtered,
  description,
  onNewFolder,
  onClearFilter,
}: {
  filtered: boolean
  description?: string
  onNewFolder: () => void
  onClearFilter: () => void
}) {
  const Icon = filtered ? SearchXIcon : FolderOpenIcon
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center p-6">
      <div className="flex max-w-[280px] flex-col items-center text-center">
        <span className="mb-3 flex size-11 items-center justify-center rounded-xl border border-border/70 bg-muted/40 text-muted-foreground">
          <Icon className="size-5" />
        </span>
        <h2 className="text-sm font-medium text-foreground">
          {filtered ? "No matching items" : "This folder is empty"}
        </h2>
        <p className="mt-1 text-xs leading-relaxed text-balance text-muted-foreground">
          {filtered
            ? "No files or folders match the current filter."
            : (description ?? "Create a folder to get started, or go to another location.")}
        </p>
        <Button
          variant="outline"
          size="sm"
          className="mt-3"
          onClick={filtered ? onClearFilter : onNewFolder}
        >
          {filtered ? "Clear filter" : "New folder"}
        </Button>
      </div>
    </div>
  )
}

function PaneError({
  error,
  onRetry,
  onHome,
  title,
}: {
  error: unknown
  onRetry: () => void
  onHome?: () => void
  title?: string
}) {
  const normalized = normalizeError(error)
  const message =
    normalized.code === "PERMISSION_DENIED"
      ? "You do not have permission to read this folder."
      : normalized.code === "NOT_FOUND"
        ? "This folder no longer exists."
        : (title ?? normalized.message)

  return (
    <div className="flex min-h-0 flex-1 items-center justify-center p-6">
      <div className="flex max-w-[340px] flex-col items-center text-center">
        <span className="mb-3 flex size-11 items-center justify-center rounded-xl border border-destructive/30 bg-destructive/10 text-destructive">
          <AlertTriangleIcon className="size-5" />
        </span>
        <h2 className="text-sm font-medium text-foreground">{message}</h2>
        {normalized.detail ? (
          <p className="mt-1 line-clamp-3 font-mono text-2xs break-words text-muted-foreground">
            {normalized.detail}
          </p>
        ) : (
          <p className="mt-1 text-xs text-muted-foreground">{normalized.message}</p>
        )}
        <div className="mt-3 flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={onRetry}>
            Try again
          </Button>
          {onHome ? (
            <Button variant="ghost" size="sm" onClick={onHome}>
              Go home
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  )
}
