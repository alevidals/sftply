import { useQueryClient } from "@tanstack/react-query"
import { cn } from "cn"
import {
  AlertTriangleIcon,
  ArrowDownToLineIcon,
  ArrowLeftRightIcon,
  ArrowUpFromLineIcon,
  Columns3Icon,
  CopyIcon,
  EyeIcon,
  EyeOffIcon,
  FilePlusIcon,
  FileTextIcon,
  FolderPlusIcon,
  FolderSearchIcon,
  InfoIcon,
  LoaderCircleIcon,
  type LucideIcon,
  MoreHorizontalIcon,
  PencilIcon,
  RefreshCwIcon,
  SearchIcon,
  StarIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react"
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react"
import { toast } from "sonner"
import { tinykeys } from "tinykeys"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { filesApi, localFiles, scopeKey } from "@/features/files/api"
import { BookmarksDialog } from "@/features/files/components/bookmarks-dialog"
import { ColumnHeader } from "@/features/files/components/column-header"
import {
  DeleteDialog,
  NewFileDialog,
  NewFolderDialog,
  PermissionsDialog,
} from "@/features/files/components/file-dialogs"
import { type FileAction, FileTable } from "@/features/files/components/file-table"
import { PaneEmpty } from "@/features/files/components/pane-empty"
import { PathBar } from "@/features/files/components/path-bar"
import { TextEditorDialog } from "@/features/files/components/text-editor-dialog"
import { fsListingKey, useFsListing } from "@/features/files/hooks/use-fs-listing"
import { usePathNavigation } from "@/features/files/hooks/use-path-navigation"
import { type ColumnOptions, fileGridTemplate } from "@/features/files/model/columns"
import { addBookmark, addRecentPath, removeBookmark } from "@/features/files/model/navigation"
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
import { isEditableTextSize } from "@/features/files/model/text"
import { useSettings } from "@/features/settings/settings-context"
import { TransferConflictDialog } from "@/features/transfers/components/transfer-conflict-dialog"
import {
  canDropTransfer,
  clearTransferDrag,
  isTransferDrag,
  readTransferDrag,
  type TransferDragPayload,
} from "@/features/transfers/model"
import { useTransferActions } from "@/features/transfers/use-transfer-actions"
import { useTransferDrag } from "@/features/transfers/use-transfer-drag"
import { useDebouncedSettingsPatch } from "@/hooks/use-debounced-settings"
import { normalizeError } from "@/lib/errors"
import { formatCount, formatMode } from "@/lib/format"
import type { FsEntry, FsScope, TextFile } from "@/lib/ipc/bindings"
import { shortcutLabel } from "@/lib/shortcuts"
import { recordActivity } from "@/stores/activity-store"
import { useSessionStore } from "@/stores/session-store"
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
  /** Connection id used to persist bookmarks and recent folders. */
  bookmarkKey?: string
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
  bookmarkKey,
}: DirectoryBrowserProps) {
  const { settings, updateSettings } = useSettings()
  const queryClient = useQueryClient()
  const persistNavigation = useDebouncedSettingsPatch()
  const activePane = useUiStore((state) => state.activePane)
  const setActivePane = useUiStore((state) => state.setActivePane)
  const setLocalSummary = useUiStore((state) => state.setLocalSummary)
  const setRemoteSummary = useUiStore((state) => state.setRemoteSummary)
  const remotePath = useUiStore((state) => state.remoteSummary.path)
  const setSyncCompareOpen = useUiStore((state) => state.setSyncCompareOpen)
  const activeSessionId = useSessionStore((state) => state.activeSessionId)

  const navigation = usePathNavigation(initialPath)
  const { path, navigate, back, forward, canBack, canForward } = navigation
  const listingQuery = useFsListing(scope, path, settings.showHiddenFiles)
  const listing = listingQuery.data ?? null
  const isActive = activePane === pane
  const { canTransfer, transferLabel, transfer, transferFrom, conflictPrompt } = useTransferActions(
    pane,
    scope,
  )

  const [sort, setSort] = useState<SortState>(DEFAULT_SORT)
  const [columns, setColumns] = useState<ColumnOptions>({ permissions: true })
  const [filter, setFilter] = useState("")
  const [filterOpen, setFilterOpen] = useState(false)
  const [selection, setSelection] = useState<SelectionState>(EMPTY_SELECTION)
  const [renamingPath, setRenamingPath] = useState<string | null>(null)
  const [newFolderOpen, setNewFolderOpen] = useState(false)
  const [newFileOpen, setNewFileOpen] = useState(false)
  const [newFileTarget, setNewFileTarget] = useState<"editor" | "system">("editor")
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [permissionsOpen, setPermissionsOpen] = useState(false)
  const [permissionsTargets, setPermissionsTargets] = useState<FsEntry[]>([])
  const [bookmarksOpen, setBookmarksOpen] = useState(false)
  const [editorOpen, setEditorOpen] = useState(false)
  const [editorTarget, setEditorTarget] = useState<FsEntry | null>(null)
  const [dropActive, setDropActive] = useState(false)
  const transferDrag = useTransferDrag()
  const dragTarget: "none" | "valid" | "blocked" = transferDrag
    ? canDropTransfer(transferDrag, scope)
      ? "valid"
      : "blocked"
    : "none"

  const rowHeight = settings.density === "comfortable" ? 38 : 30
  const canChmod = listing?.capabilities.chmod ?? false
  const canMkdir = listing?.capabilities.mkdir ?? false
  const canRename = listing?.capabilities.rename ?? false
  const canRemove = listing?.capabilities.remove ?? false
  const canEdit = listing?.capabilities.textRead ?? false
  const canWriteText = listing?.capabilities.textWrite ?? false

  // Filtering and sorting thousands of rows is the expensive part of typing;
  // the deferred value keeps the input responsive and lets React skip the
  // intermediate renders while keys arrive in a burst.
  const deferredFilter = useDeferredValue(filter)
  const entries = useMemo(() => {
    const source = listing?.entries ?? []
    const needle = deferredFilter.trim().toLocaleLowerCase()
    const filtered = needle
      ? source.filter((entry) => entry.name.toLocaleLowerCase().includes(needle))
      : source
    return sortEntries(filtered, sort)
  }, [listing, deferredFilter, sort])

  const activeEntry = selection.active === null ? null : (entries[selection.active] ?? null)
  const selectedEntries = useMemo(
    () => entries.filter((entry) => selection.selected.has(entry.path)),
    [entries, selection.selected],
  )
  const parent = listing?.parent ?? (path ? parentPath(path) : null)
  const bookmarks = bookmarkKey ? (settings.remoteBookmarks[bookmarkKey] ?? []) : []
  const recentPaths = bookmarkKey ? (settings.recentPaths[bookmarkKey] ?? []) : []
  const isBookmarked = Boolean(path && bookmarks.includes(path))

  const reportError = useCallback((title: string, error: unknown) => {
    const normalized = normalizeError(error)
    toast.error(title, { description: normalized.message })
    recordActivity("error", `${title}: ${normalized.message}`)
  }, [])

  const invalidate = useCallback(
    () => queryClient.invalidateQueries({ queryKey: ["fs", scopeKey(scope)] }),
    [queryClient, scope],
  )

  const canEditEntry = useCallback(
    (entry: FsEntry | null): entry is FsEntry =>
      Boolean(entry && entry.kind === "file" && canEdit && isEditableTextSize(entry.size)),
    [canEdit],
  )

  const openEditor = useCallback(
    (entry: FsEntry) => {
      if (!canEditEntry(entry)) return
      setEditorTarget(entry)
      setEditorOpen(true)
    },
    [canEditEntry],
  )

  // Reset transient UI as soon as the folder changes. Doing it during render
  // avoids one committed frame where the selection still points at the previous
  // folder's rows, which could be acted on with Enter.
  const [lastPath, setLastPath] = useState(path)
  if (lastPath !== path) {
    setLastPath(path)
    setSelection(EMPTY_SELECTION)
    setFilter("")
    setFilterOpen(false)
    setRenamingPath(null)
    setPermissionsTargets([])
  }

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

  // Remember visited folders per connection. Debounced so a burst of
  // navigation writes settings once, and skipped when the path is already the
  // newest entry.
  useEffect(() => {
    if (!bookmarkKey || !path) return
    const current = settings.recentPaths[bookmarkKey] ?? []
    if (current[0] === path) return
    persistNavigation({
      recentPaths: { ...settings.recentPaths, [bookmarkKey]: addRecentPath(current, path) },
    })
  }, [bookmarkKey, path, settings.recentPaths, persistNavigation])

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
        if (canEditEntry(entry)) {
          openEditor(entry)
          return
        }
        toast.info("Remote files cannot be opened here yet. Download the file first.")
        return
      }
      localFiles.open(entry.path).catch((error) => {
        reportError(`Could not open “${entry.name}”`, error)
      })
    },
    [allowOpenFile, canEditEntry, navigate, openEditor, reportError],
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

  const revealFolder = useCallback(() => {
    if (!allowReveal) return
    const folder = listing?.path ?? path
    if (!folder) return
    localFiles.reveal(folder).catch((error) => {
      reportError("Could not reveal the folder", error)
    })
  }, [allowReveal, listing, path, reportError])

  const handleAction = useCallback(
    (action: FileAction) => {
      switch (action) {
        case "open":
          if (activeEntry) openEntry(activeEntry)
          break
        case "edit":
          if (activeEntry) openEditor(activeEntry)
          break
        case "rename":
          if (activeEntry) setRenamingPath(activeEntry.path)
          break
        case "delete":
          if (selectedEntries.length > 0) setDeleteOpen(true)
          break
        case "reveal":
          if (!allowReveal) break
          if (activeEntry) revealEntry(activeEntry)
          else revealFolder()
          break
        case "reveal-folder":
          revealFolder()
          break
        case "new-file-editor":
          setNewFileTarget("editor")
          setNewFileOpen(true)
          break
        case "new-file-system":
          setNewFileTarget("system")
          setNewFileOpen(true)
          break
        case "permissions":
          if (selectedEntries.length > 0 && canChmod) {
            setPermissionsTargets(selectedEntries)
            setPermissionsOpen(true)
          }
          break
        case "new-folder":
          setNewFolderOpen(true)
          break
        case "copy-path": {
          const fallback = activeEntry?.path ?? listing?.path
          const paths =
            selectedEntries.length > 0
              ? selectedEntries.map((entry) => entry.path)
              : fallback
                ? [fallback]
                : []
          if (paths.length === 0) break
          navigator.clipboard.writeText(paths.join("\n")).then(
            () =>
              toast.success(paths.length === 1 ? "Path copied" : `${paths.length} paths copied`),
            (error) => reportError("Could not copy the path", error),
          )
          break
        }
        case "transfer":
          if (selectedEntries.length > 0) transfer(selectedEntries)
          break
      }
    },
    [
      activeEntry,
      allowReveal,
      canChmod,
      listing,
      openEditor,
      openEntry,
      reportError,
      revealEntry,
      revealFolder,
      selectedEntries,
      transfer,
    ],
  )

  const createFile = async (name: string) => {
    if (!listing) throw new Error("No folder is loaded.")
    const entry = await localFiles.createFile(listing.path, name)
    await invalidate()
    if (newFileTarget === "editor") {
      openEditor(entry)
      return
    }
    localFiles.openEditor(entry.path).catch((error) => {
      reportError(`Could not open “${name}” in the system editor`, error)
    })
  }

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
    if (permissionsTargets.length === 0) throw new Error("No items are selected.")
    let failed: { entry: FsEntry; error: unknown } | null = null

    for (const entry of permissionsTargets) {
      try {
        await filesApi(scope).chmod(entry.path, mode)
      } catch (error) {
        failed = { entry, error }
        break
      }
    }

    await invalidate()

    if (failed) {
      const normalized = normalizeError(failed.error)
      throw new Error(`Could not change “${failed.entry.name}”: ${normalized.message}`)
    }

    const message =
      permissionsTargets.length === 1
        ? `Changed permissions on “${permissionsTargets[0]?.name ?? "item"}” to ${formatMode(mode)}`
        : `Changed permissions on ${permissionsTargets.length} items to ${formatMode(mode)}`
    recordActivity("success", message)
    toast.success("Permissions updated")
  }

  const refresh = () => {
    listingQuery.refetch().catch((error) => {
      reportError("Could not refresh the folder", error)
    })
  }

  const handleTextSaved = useCallback(
    (saved: TextFile) => {
      void invalidate()
      recordActivity("success", `Saved “${editorTarget?.name ?? saved.path}”`)
    },
    [editorTarget, invalidate],
  )

  const toggleHidden = () => {
    updateSettings({ showHiddenFiles: !settings.showHiddenFiles }).catch((error) => {
      reportError("Could not update hidden files", error)
    })
  }

  const goHome = () => {
    if (homePath) navigate(homePath)
  }

  const updateBookmarks = (next: string[], message: string) => {
    if (!bookmarkKey) return
    updateSettings({ remoteBookmarks: { ...settings.remoteBookmarks, [bookmarkKey]: next } })
      .then(() => toast.success(message))
      .catch((error) => reportError("Could not save the bookmark", error))
  }

  const toggleBookmark = () => {
    if (!bookmarkKey || !path) return
    updateBookmarks(
      isBookmarked ? removeBookmark(bookmarks, path) : addBookmark(bookmarks, path),
      isBookmarked ? "Bookmark removed" : "Folder bookmarked",
    )
  }

  const removeSavedBookmark = (target: string) => {
    updateBookmarks(removeBookmark(bookmarks, target), "Bookmark removed")
  }

  const clearRecentPaths = () => {
    if (!bookmarkKey) return
    updateSettings({ recentPaths: { ...settings.recentPaths, [bookmarkKey]: [] } })
      .then(() => toast.success("Recent folders cleared"))
      .catch((error) => reportError("Could not clear recent folders", error))
  }

  const suggestPaths = useCallback(
    async (value: string) => {
      const trimmed = value.trim()
      const slash = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"))
      if (slash < 0) return []
      const parent = slash === 0 ? "/" : trimmed.slice(0, slash)
      const separator = trimmed.includes("\\") && !trimmed.startsWith("/") ? "\\" : "/"
      const stem = trimmed.slice(slash + 1).toLowerCase()

      try {
        const listed = await filesApi(scope).list(parent, settings.showHiddenFiles)
        const base =
          listed.path.endsWith("/") || listed.path.endsWith("\\")
            ? listed.path.slice(0, -1)
            : listed.path
        return listed.entries
          .filter(
            (entry) => entry.kind === "directory" && entry.name.toLowerCase().startsWith(stem),
          )
          .slice(0, 8)
          .map((entry) => `${base}${separator}${entry.name}`)
      } catch {
        // A folder that cannot be listed simply offers no completions.
        return []
      }
    },
    [scope, settings.showHiddenFiles],
  )

  const navigateFromPathBar = async (target: string) => {
    try {
      // List first and only then commit the path: an invalid or unreadable
      // folder must not leave the pane showing an empty listing.
      const fetched = await queryClient.fetchQuery({
        queryKey: fsListingKey(scope, target, settings.showHiddenFiles),
        queryFn: () => filesApi(scope).list(target, settings.showHiddenFiles),
        retry: false,
        staleTime: 5_000,
      })
      navigate(fetched.path)
    } catch (cause) {
      const normalized = normalizeError(cause)
      toast.error("That folder could not be opened", { description: normalized.message })
      recordActivity("error", `Open folder failed: ${normalized.message}`)
    }
  }

  const shortcutActions = useRef({
    refresh,
    back,
    forward,
    up: () => parent && navigate(parent),
    openFilter: () => setFilterOpen(true),
    openNewFolder: () => setNewFolderOpen(true),
  })
  shortcutActions.current = {
    refresh,
    back,
    forward,
    up: () => parent && navigate(parent),
    openFilter: () => setFilterOpen(true),
    openNewFolder: () => setNewFolderOpen(true),
  }

  useEffect(() => {
    const isActive = () => {
      const ui = useUiStore.getState()
      return ui.activePane === pane && !ui.paletteOpen && !ui.settingsOpen
    }
    return tinykeys(window, {
      "$mod+KeyR": (event) => {
        if (!isActive()) return
        event.preventDefault()
        shortcutActions.current.refresh()
      },
      "$mod+KeyF": (event) => {
        if (!isActive()) return
        event.preventDefault()
        shortcutActions.current.openFilter()
      },
      "$mod+Shift+KeyN": (event) => {
        if (!isActive()) return
        event.preventDefault()
        shortcutActions.current.openNewFolder()
      },
      "$mod+BracketLeft": (event) => {
        if (!isActive() || event.defaultPrevented) return
        event.preventDefault()
        shortcutActions.current.back()
      },
      "$mod+BracketRight": (event) => {
        if (!isActive() || event.defaultPrevented) return
        event.preventDefault()
        shortcutActions.current.forward()
      },
      "$mod+ArrowUp": (event) => {
        if (!isActive() || event.defaultPrevented) return
        event.preventDefault()
        shortcutActions.current.up()
      },
    })
  }, [pane])

  const select = (index: number, mode: SelectionMode) => {
    setSelection((current) => selectRow(entries, current, index, mode))
  }

  const dropInto = (payload: TransferDragPayload, directory: string) => {
    setDropActive(false)
    clearTransferDrag()
    if (!canDropTransfer(payload, scope)) {
      toast.info("Drop files into the other pane to transfer them.")
      return
    }
    transferFrom(payload.scope, payload.entries, directory)
  }

  const handleDragOver = (event: React.DragEvent<HTMLElement>) => {
    if (!isTransferDrag(event.dataTransfer)) return
    // Only a pane on the other side can accept the drop. Leaving the event
    // unprevented makes the browser show its own "not allowed" cursor instead
    // of our drop affordance.
    const payload = readTransferDrag(event.dataTransfer)
    if (!payload || !canDropTransfer(payload, scope)) {
      setDropActive(false)
      return
    }
    event.preventDefault()
    event.dataTransfer.dropEffect = "copy"
    setDropActive(true)
  }

  const handleDragLeave = (event: React.DragEvent<HTMLElement>) => {
    const related = event.relatedTarget
    if (related instanceof Node && event.currentTarget.contains(related)) return
    setDropActive(false)
  }

  const handleDrop = (event: React.DragEvent<HTMLElement>) => {
    const payload = readTransferDrag(event.dataTransfer)
    clearTransferDrag()
    setDropActive(false)
    if (!payload) return
    event.preventDefault()
    if (!canDropTransfer(payload, scope)) {
      toast.info("Drop files into the other pane to transfer them.")
      return
    }
    transferFrom(payload.scope, payload.entries, path || undefined)
  }

  return (
    <section
      id={`pane-${pane}`}
      aria-label={`${title} pane`}
      tabIndex={-1}
      onFocus={() => setActivePane(pane)}
      data-active={isActive}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      data-drop-target={dragTarget}
      className={cn(
        "relative flex h-full min-h-0 flex-col bg-background outline-none",
        "data-[active=true]:ring-1 data-[active=true]:ring-primary/25 data-[active=true]:ring-inset",
        "data-[drop-target=valid]:ring-2 data-[drop-target=valid]:ring-primary/25 data-[drop-target=valid]:ring-inset",
      )}
    >
      {isActive ? (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 z-10 h-0.5 bg-primary/80"
        />
      ) : null}
      {dragTarget === "valid" && !dropActive ? (
        <div className="pointer-events-none absolute inset-x-0 top-10 z-10 flex justify-center">
          <span className="rounded-full border border-dashed border-primary/40 bg-popover/90 px-3 py-1 text-2xs font-medium text-primary shadow-sm">
            Drop here to {pane === "local" ? "download" : "upload"}
          </span>
        </div>
      ) : null}
      {dropActive ? (
        <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-primary/10 ring-2 ring-primary/50 ring-inset">
          <span className="flex items-center gap-2 rounded-md border border-primary/40 bg-popover px-3 py-1.5 text-xs font-medium text-foreground shadow-sm">
            {pane === "local" ? (
              <ArrowDownToLineIcon className="size-3.5 text-primary" />
            ) : (
              <ArrowUpFromLineIcon className="size-3.5 text-primary" />
            )}
            {transferDrag && transferDrag.entries.length > 1
              ? `Drop ${transferDrag.entries.length} items to ${pane === "local" ? "download" : "upload"}`
              : `Drop to ${pane === "local" ? "download" : "upload"}`}
          </span>
        </div>
      ) : null}
      <div
        data-active={isActive}
        className="flex h-10 shrink-0 items-center gap-2 border-b border-border/70 bg-panel-header px-3 data-[active=true]:bg-primary/[0.06]"
      >
        <PaneIcon className={cn("size-3.5", isActive ? "text-primary" : "text-muted-foreground")} />
        <span className="min-w-0 truncate text-xs font-semibold text-foreground">{title}</span>
        <Badge variant="secondary" className="h-4.5 px-1.5 text-[10px] font-medium">
          {listing ? `${formatCount(listing.entries.length)} items` : "…"}
        </Badge>
        {headerExtra}

        <div className="ml-auto flex items-center gap-0.5">
          <ToolbarButton
            label="New folder"
            shortcut={shortcutLabel("new-folder")}
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
            canEdit={canEditEntry(activeEntry)}
            canRename={Boolean(activeEntry) && canRename}
            canDelete={selectedEntries.length > 0 && canRemove}
            canPermissions={selectedEntries.length > 0 && canChmod}
            chmodSupported={canChmod}
            canReveal={allowReveal}
            canTransfer={canTransfer && selectedEntries.length > 0}
            transferLabel={transferLabel}
            transferDirection={pane === "local" ? "upload" : "download"}
            onAction={handleAction}
          />
        </div>
      </div>

      {path ? (
        <PathBar
          pane={pane}
          path={path}
          canBack={canBack}
          canForward={canForward}
          canUp={Boolean(parent)}
          onBack={back}
          onForward={forward}
          onUp={() => parent && navigate(parent)}
          onHome={homePath ? goHome : undefined}
          onNavigate={navigate}
          onSubmitPath={navigateFromPathBar}
          suggestPath={suggestPaths}
        >
          {bookmarkKey ? (
            <ToolbarButton
              label="Bookmarks and recent folders"
              active={isBookmarked}
              onClick={() => setBookmarksOpen(true)}
            >
              <StarIcon className={cn(isBookmarked && "fill-current")} />
            </ToolbarButton>
          ) : null}
          {pane === "local" ? (
            <ToolbarButton
              label="Compare with remote folder"
              disabled={!activeSessionId || !remotePath}
              onClick={() => setSyncCompareOpen(true)}
            >
              <ArrowLeftRightIcon />
            </ToolbarButton>
          ) : null}
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
              shortcut={shortcutLabel("filter")}
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
        <ContextMenu>
          <ContextMenuTrigger asChild>
            <div className="flex min-h-0 flex-1">
              <PaneEmpty
                filtered={filter.trim().length > 0 && (listing?.entries.length ?? 0) > 0}
                description={emptyDescription}
                canCreate={canMkdir}
                canCreateFile={allowReveal}
                onNewFolder={() => setNewFolderOpen(true)}
                onNewFile={(target) => {
                  setNewFileTarget(target)
                  setNewFileOpen(true)
                }}
                onClearFilter={() => {
                  setFilter("")
                  setFilterOpen(false)
                }}
              />
            </div>
          </ContextMenuTrigger>
          <ContextMenuContent className="w-56">
            <ContextMenuLabel className="font-normal">Folder</ContextMenuLabel>
            <ContextMenuSeparator />
            <ContextMenuItem onSelect={() => setNewFolderOpen(true)}>
              <FolderPlusIcon />
              New folder
              <ContextMenuShortcut>{shortcutLabel("new-folder")}</ContextMenuShortcut>
            </ContextMenuItem>
            {allowReveal ? (
              <ContextMenuSub>
                <ContextMenuSubTrigger>
                  <FilePlusIcon />
                  New file
                </ContextMenuSubTrigger>
                <ContextMenuSubContent>
                  <ContextMenuItem
                    onSelect={() => {
                      setNewFileTarget("editor")
                      setNewFileOpen(true)
                    }}
                  >
                    Edit in sftply
                  </ContextMenuItem>
                  <ContextMenuItem
                    onSelect={() => {
                      setNewFileTarget("system")
                      setNewFileOpen(true)
                    }}
                  >
                    Open in system editor
                  </ContextMenuItem>
                </ContextMenuSubContent>
              </ContextMenuSub>
            ) : null}
            <ContextMenuItem onSelect={() => handleAction("copy-path")}>
              <CopyIcon />
              Copy folder path
            </ContextMenuItem>
            {allowReveal ? (
              <ContextMenuItem onSelect={revealFolder}>
                <FolderSearchIcon />
                Reveal folder in file manager
              </ContextMenuItem>
            ) : null}
          </ContextMenuContent>
        </ContextMenu>
      ) : (
        <FileTable
          entries={entries}
          selection={selection}
          columns={columns}
          rowHeight={rowHeight}
          renamingPath={renamingPath}
          canChmod={canChmod}
          canEdit={canEdit}
          allowOpen={allowOpenFile}
          allowReveal={allowReveal}
          canTransfer={canTransfer}
          transferLabel={transferLabel}
          transferDirection={pane === "local" ? "upload" : "download"}
          dragScope={scope}
          onDropPayload={(payload, directory) => dropInto(payload, directory.path)}
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
      <NewFileDialog
        open={newFileOpen}
        parentPath={listing?.path ?? path ?? ""}
        onOpenChange={setNewFileOpen}
        onCreate={createFile}
      />
      <DeleteDialog
        open={deleteOpen}
        entries={selectedEntries}
        scope={title}
        onOpenChange={setDeleteOpen}
        onConfirm={deleteEntries}
      />
      <PermissionsDialog
        open={permissionsOpen}
        entries={permissionsTargets}
        onOpenChange={setPermissionsOpen}
        onConfirm={applyPermissions}
      />
      <TextEditorDialog
        open={editorOpen}
        entry={editorTarget}
        scope={scope}
        canWrite={canWriteText}
        onOpenChange={setEditorOpen}
        onSaved={handleTextSaved}
      />
      {bookmarkKey ? (
        <BookmarksDialog
          open={bookmarksOpen}
          onOpenChange={setBookmarksOpen}
          currentPath={path}
          bookmarks={bookmarks}
          recent={recentPaths}
          isBookmarked={isBookmarked}
          onToggleBookmark={toggleBookmark}
          onRemoveBookmark={removeSavedBookmark}
          onNavigate={(target) => navigate(target)}
          onClearRecent={clearRecentPaths}
        />
      ) : null}
      {conflictPrompt ? (
        <TransferConflictDialog
          open={conflictPrompt.open}
          conflicts={conflictPrompt.conflicts}
          direction={conflictPrompt.direction}
          onOpenChange={conflictPrompt.onOpenChange}
          onConfirm={conflictPrompt.onConfirm}
        />
      ) : null}
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
  canEdit,
  canRename,
  canDelete,
  canPermissions,
  chmodSupported,
  canReveal,
  canTransfer,
  transferLabel,
  transferDirection,
  onAction,
}: {
  canOpen: boolean
  canEdit: boolean
  canRename: boolean
  canDelete: boolean
  canPermissions: boolean
  chmodSupported: boolean
  canReveal: boolean
  canTransfer: boolean
  transferLabel: string
  transferDirection: "upload" | "download"
  onAction: (action: FileAction) => void
}) {
  const TransferIcon = transferDirection === "upload" ? ArrowUpFromLineIcon : ArrowDownToLineIcon
  // Keep focus on the inline rename input instead of the toolbar trigger.
  const renameFocusPending = useRef(false)
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-xs" aria-label="File actions">
          <MoreHorizontalIcon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-56"
        onCloseAutoFocus={(event) => {
          if (!renameFocusPending.current) return
          renameFocusPending.current = false
          event.preventDefault()
        }}
      >
        <DropdownMenuLabel>File actions</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={!canOpen} onSelect={() => onAction("open")}>
          <ArrowDownToLineIcon />
          Open
          <DropdownMenuShortcut>{shortcutLabel("open")}</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem disabled={!canEdit} onSelect={() => onAction("edit")}>
          <FileTextIcon />
          Edit text…
        </DropdownMenuItem>
        <DropdownMenuItem disabled={!canTransfer} onSelect={() => onAction("transfer")}>
          <TransferIcon />
          {transferLabel}
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={!canRename}
          onSelect={() => {
            renameFocusPending.current = true
            onAction("rename")
          }}
        >
          <PencilIcon />
          Rename
          <DropdownMenuShortcut>F2</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onAction("new-folder")}>
          <FolderPlusIcon />
          New folder
          <DropdownMenuShortcut>{shortcutLabel("new-folder")}</DropdownMenuShortcut>
        </DropdownMenuItem>
        {canReveal ? (
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <FilePlusIcon />
              New file
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuItem onSelect={() => onAction("new-file-editor")}>
                Edit in sftply
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => onAction("new-file-system")}>
                Open in system editor
              </DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        ) : null}
        <DropdownMenuItem disabled={!canDelete} onSelect={() => onAction("delete")}>
          <Trash2Icon />
          Delete
          <DropdownMenuShortcut>{shortcutLabel("delete")}</DropdownMenuShortcut>
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
        <DropdownMenuItem onSelect={() => onAction("copy-path")}>
          <CopyIcon />
          Copy path
        </DropdownMenuItem>
        <DropdownMenuItem disabled={!canPermissions} onSelect={() => onAction("permissions")}>
          <InfoIcon />
          Permissions…
          {!chmodSupported ? (
            <span className="ml-auto text-2xs text-muted-foreground">Not supported</span>
          ) : null}
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
        <h2 className="selectable text-sm font-medium text-foreground">{message}</h2>
        {normalized.detail ? (
          <p className="selectable mt-1 line-clamp-3 font-mono text-2xs break-words text-muted-foreground">
            {normalized.detail}
          </p>
        ) : (
          <p className="selectable mt-1 text-xs text-muted-foreground">{normalized.message}</p>
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
