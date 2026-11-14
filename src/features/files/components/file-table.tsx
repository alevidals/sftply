import { useVirtualizer } from "@tanstack/react-virtual"
import { cn } from "cn"
import {
  ArrowDownToLineIcon,
  ArrowUpFromLineIcon,
  CopyIcon,
  FileTextIcon,
  FolderPlusIcon,
  FolderSearchIcon,
  InfoIcon,
  PencilIcon,
  Trash2Icon,
} from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
import { Input } from "@/components/ui/input"
import { FileEntryIcon } from "@/features/files/components/file-entry-icon"
import { type ColumnOptions, fileGridTemplate } from "@/features/files/model/columns"
import { entryNameError } from "@/features/files/model/names"
import type { SelectionMode, SelectionState } from "@/features/files/model/selection"
import { isEditableTextSize } from "@/features/files/model/text"
import { useFormatPreferences } from "@/features/settings/settings-context"
import {
  canDropTransfer,
  clearTransferDrag,
  currentTransferDrag,
  isTransferDrag,
  readTransferDrag,
  type TransferDragPayload,
  transferableEntries,
  writeTransferDrag,
} from "@/features/transfers/model"
import { formatBytes, formatMode, formatModified } from "@/lib/format"
import type { FsEntry, FsScope } from "@/lib/ipc/bindings"
import { shortcutLabel } from "@/lib/shortcuts"

export type FileAction =
  | "open"
  | "edit"
  | "rename"
  | "delete"
  | "reveal"
  | "permissions"
  | "new-folder"
  | "copy-path"
  | "transfer"

interface FileTableProps {
  entries: readonly FsEntry[]
  selection: SelectionState
  columns: ColumnOptions
  rowHeight: number
  renamingPath: string | null
  canChmod: boolean
  /** Whether regular files in this pane can be opened in the text editor. */
  canEdit: boolean
  /** Whether non-directory entries can be opened. Remote panes only navigate. */
  allowOpen: boolean
  /** Whether items can be revealed in the OS file manager (local only). */
  allowReveal: boolean
  /** Whether selected files can be sent to the other pane. */
  canTransfer: boolean
  transferLabel: string
  transferDirection: "upload" | "download"
  /** Scope that drag payloads from this table belong to. */
  dragScope: FsScope
  /** Drop entries onto a folder row. */
  onDropPayload: (payload: TransferDragPayload, directory: FsEntry) => void
  onSelect: (index: number, mode: SelectionMode) => void
  onSelectAll: () => void
  onClearSelection: () => void
  onMove: (delta: number, extend: boolean) => void
  onFocusRow: (index: number, extend: boolean) => void
  onTypeAhead: (prefix: string) => void
  onAction: (action: FileAction) => void
  onUp: () => void
  onRenameSubmit: (entry: FsEntry, name: string) => void
  onRenameCancel: () => void
}

export function FileTable({
  entries,
  selection,
  columns,
  rowHeight,
  renamingPath,
  canChmod,
  canEdit,
  allowOpen,
  allowReveal,
  canTransfer,
  transferLabel,
  transferDirection,
  dragScope,
  onDropPayload,
  onSelect,
  onSelectAll,
  onClearSelection,
  onMove,
  onFocusRow,
  onTypeAhead,
  onAction,
  onUp,
  onRenameSubmit,
  onRenameCancel,
}: FileTableProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const suppressClick = useRef(false)
  const typeAhead = useRef<{ value: string; timer: ReturnType<typeof setTimeout> | null }>({
    value: "",
    timer: null,
  })
  const [contextIndex, setContextIndex] = useState<number | null>(null)
  // Radix restores focus to the trigger when a menu closes. A rename opens an
  // input in the same commit, so restoring focus would steal it back to the row.
  const renameFocusPending = useRef(false)
  const [dropPath, setDropPath] = useState<string | null>(null)
  const { sizeFormat, dateFormat } = useFormatPreferences()
  // One string for every row: building it inside the row map costs a string
  // concatenation per visible row on every render.
  const gridTemplate = useMemo(() => fileGridTemplate(columns), [columns])

  const virtualizer = useVirtualizer({
    count: entries.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHeight,
    overscan: 12,
    getItemKey: (index) => entries[index]?.path ?? index,
  })

  // Row height is a virtualizer configuration input; remeasure when it changes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: rowHeight lives in the virtualizer options
  useEffect(() => {
    virtualizer.measure()
  }, [virtualizer, rowHeight])

  useEffect(() => {
    if (selection.active === null) return
    virtualizer.scrollToIndex(selection.active, { align: "auto" })
  }, [selection.active, virtualizer])

  useEffect(
    () => () => {
      if (typeAhead.current.timer) clearTimeout(typeAhead.current.timer)
    },
    [],
  )

  const activeEntry = selection.active === null ? null : entries[selection.active]
  const hasSelection = selection.selected.size > 0

  const actionDisabled = (action: FileAction): boolean => {
    switch (action) {
      case "open":
        return !activeEntry || (activeEntry.kind !== "directory" && !allowOpen)
      case "edit":
        return activeEntry?.kind !== "file" || !canEdit || !isEditableTextSize(activeEntry.size)
      case "rename":
      case "reveal":
        return !activeEntry
      case "delete":
        return !hasSelection
      case "transfer":
        return !canTransfer || !hasSelection
      case "permissions":
        return !hasSelection || !canChmod
      case "new-folder":
        return false
      case "copy-path":
        return false
    }
  }

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.target instanceof HTMLInputElement) return

    const command = event.metaKey || event.ctrlKey
    if (command) {
      if (event.key.toLowerCase() === "a") {
        event.preventDefault()
        onSelectAll()
        return
      }
      if (event.key === "Backspace") {
        event.preventDefault()
        onAction("delete")
        return
      }
      if (event.key === "ArrowUp") {
        event.preventDefault()
        onUp()
        return
      }
    }

    switch (event.key) {
      case "ArrowDown":
        event.preventDefault()
        onMove(1, event.shiftKey)
        return
      case "ArrowUp":
        event.preventDefault()
        onMove(-1, event.shiftKey)
        return
      case "Home":
        event.preventDefault()
        onFocusRow(0, event.shiftKey)
        return
      case "End":
        event.preventDefault()
        onFocusRow(entries.length - 1, event.shiftKey)
        return
      case " ":
        if (selection.active !== null) {
          event.preventDefault()
          onSelect(selection.active, "toggle")
        }
        return
      case "Enter":
        event.preventDefault()
        onAction("open")
        return
      case "Backspace":
        event.preventDefault()
        onUp()
        return
      case "Delete":
        event.preventDefault()
        onAction("delete")
        return
      case "F2":
        event.preventDefault()
        onAction("rename")
        return
      case "Escape":
        onClearSelection()
        return
    }

    if (!command && !event.altKey && event.key.length === 1) {
      event.preventDefault()
      if (typeAhead.current.timer) clearTimeout(typeAhead.current.timer)
      typeAhead.current.value += event.key
      typeAhead.current.timer = setTimeout(() => {
        typeAhead.current.value = ""
        typeAhead.current.timer = null
      }, 600)
      onTypeAhead(typeAhead.current.value)
    }
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          ref={scrollRef}
          role="grid"
          aria-label="Folder contents"
          aria-multiselectable
          aria-rowcount={entries.length + 1}
          aria-activedescendant={
            selection.active === null ? undefined : `file-row-${selection.active}`
          }
          tabIndex={0}
          onKeyDown={handleKeyDown}
          className="relative min-h-0 flex-1 overflow-auto outline-none focus-visible:ring-1 focus-visible:ring-ring/30 focus-visible:ring-inset"
        >
          <div className="relative w-full" style={{ height: `${virtualizer.getTotalSize()}px` }}>
            {virtualizer.getVirtualItems().map((virtualRow) => {
              const entry = entries[virtualRow.index]
              if (!entry) return null
              const index = virtualRow.index
              const selected = selection.selected.has(entry.path)
              const active = selection.active === index
              const renaming = renamingPath === entry.path

              return (
                // Keyboard selection is handled once on the grid container,
                // which owns the roving tab stop; rows are not tab stops.
                // biome-ignore lint/a11y/useKeyWithClickEvents: keyboard selection lives on the grid container
                <div
                  key={entry.path}
                  id={`file-row-${index}`}
                  role="row"
                  aria-rowindex={index + 1}
                  aria-selected={selected}
                  title={entry.path}
                  onMouseDown={(event) => {
                    if (event.button !== 0) return
                    suppressClick.current = false
                    scrollRef.current?.focus()
                    if (event.shiftKey) {
                      onSelect(index, "range")
                    } else if (event.metaKey || event.ctrlKey) {
                      onSelect(index, "toggle")
                    } else if (!selected) {
                      onSelect(index, "replace")
                    } else {
                      // Keep a multi-selection intact until mouseup so the drag
                      // can carry every selected row.
                      onSelect(index, "focus")
                    }
                  }}
                  onClick={(event) => {
                    if (event.shiftKey || event.metaKey || event.ctrlKey) return
                    if (suppressClick.current) return
                    if (selected) onSelect(index, "replace")
                  }}
                  onDoubleClick={() => {
                    if (!renaming) onAction("open")
                  }}
                  onContextMenu={() => {
                    setContextIndex(index)
                    if (!selected) onSelect(index, "replace")
                  }}
                  draggable={!renaming}
                  onDragStart={(event) => {
                    suppressClick.current = true
                    const dragged = selected
                      ? entries.filter((item) => selection.selected.has(item.path))
                      : [entry]
                    const supported = transferableEntries(dragged)
                    if (supported.length === 0) {
                      event.preventDefault()
                      return
                    }
                    writeTransferDrag(event.dataTransfer, { scope: dragScope, entries: supported })
                  }}
                  onDragEnd={clearTransferDrag}
                  onDragOver={(event) => {
                    if (entry.kind !== "directory") return
                    if (!isTransferDrag(event.dataTransfer)) return
                    const payload = currentTransferDrag() ?? readTransferDrag(event.dataTransfer)
                    if (!payload || !canDropTransfer(payload, dragScope)) return
                    event.preventDefault()
                    event.stopPropagation()
                    event.dataTransfer.dropEffect = "copy"
                    if (dropPath !== entry.path) setDropPath(entry.path)
                  }}
                  onDragLeave={(event) => {
                    if (entry.kind !== "directory") return
                    const related = event.relatedTarget
                    if (related instanceof Node && event.currentTarget.contains(related)) return
                    setDropPath((current) => (current === entry.path ? null : current))
                  }}
                  onDrop={(event) => {
                    if (entry.kind !== "directory") return
                    const payload = readTransferDrag(event.dataTransfer)
                    setDropPath(null)
                    if (!payload) return
                    event.preventDefault()
                    event.stopPropagation()
                    onDropPayload(payload, entry)
                  }}
                  style={{
                    height: `${rowHeight}px`,
                    transform: `translateY(${virtualRow.start}px)`,
                    gridTemplateColumns: gridTemplate,
                  }}
                  className={cn(
                    "absolute top-0 left-0 grid w-full cursor-default items-center gap-3 px-3 text-xs select-none",
                    "text-foreground transition-colors",
                    selected ? "bg-row-selected" : "hover:bg-row-hover",
                    active && "ring-1 ring-primary/25 ring-inset",
                    dropPath === entry.path && "bg-primary/10 ring-1 ring-primary/40 ring-inset",
                  )}
                >
                  <div role="gridcell" className="flex min-w-0 items-center gap-2">
                    <FileEntryIcon kind={entry.kind} name={entry.name} />
                    {renaming ? (
                      <RenameField
                        entry={entry}
                        onSubmit={(name) => onRenameSubmit(entry, name)}
                        onCancel={onRenameCancel}
                      />
                    ) : (
                      <span className="flex min-w-0 items-baseline gap-1.5">
                        <span className={cn("truncate", entry.hidden && "text-muted-foreground")}>
                          {entry.name}
                        </span>
                        {entry.kind === "symlink" && entry.linkTarget ? (
                          <span className="truncate text-2xs text-muted-foreground/70">
                            → {entry.linkTarget}
                          </span>
                        ) : null}
                      </span>
                    )}
                  </div>

                  <div
                    role="gridcell"
                    className="truncate text-right font-mono text-2xs text-muted-foreground tabular"
                  >
                    {entry.kind === "directory" ? "—" : formatBytes(entry.size, sizeFormat)}
                  </div>

                  <div
                    role="gridcell"
                    className="truncate text-right text-2xs text-muted-foreground tabular"
                  >
                    {formatModified(entry.modifiedAt, dateFormat)}
                  </div>

                  {columns.permissions ? (
                    <div
                      role="gridcell"
                      className="truncate text-right font-mono text-2xs text-muted-foreground"
                    >
                      {formatMode(entry.permissions)}
                    </div>
                  ) : null}
                </div>
              )
            })}
          </div>
        </div>
      </ContextMenuTrigger>

      <ContextMenuContent
        className="w-56"
        onCloseAutoFocus={(event) => {
          if (!renameFocusPending.current) return
          renameFocusPending.current = false
          event.preventDefault()
        }}
      >
        <ContextMenuLabel className="max-w-52 truncate font-normal">
          {contextIndex === null ? "Actions" : (entries[contextIndex]?.name ?? "Actions")}
        </ContextMenuLabel>
        <ContextMenuSeparator />
        <ContextMenuItem disabled={actionDisabled("open")} onSelect={() => onAction("open")}>
          <ArrowDownToLineIcon />
          Open
          <ContextMenuShortcut>{shortcutLabel("open")}</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem disabled={actionDisabled("edit")} onSelect={() => onAction("edit")}>
          <FileTextIcon />
          Edit text…
        </ContextMenuItem>
        <ContextMenuItem
          disabled={actionDisabled("transfer")}
          onSelect={() => onAction("transfer")}
        >
          {transferDirection === "upload" ? <ArrowUpFromLineIcon /> : <ArrowDownToLineIcon />}
          {transferLabel}
        </ContextMenuItem>
        {allowReveal ? (
          <ContextMenuItem disabled={actionDisabled("reveal")} onSelect={() => onAction("reveal")}>
            <FolderSearchIcon />
            Reveal in file manager
          </ContextMenuItem>
        ) : null}
        <ContextMenuItem onSelect={() => onAction("copy-path")}>
          <CopyIcon />
          Copy path
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          disabled={actionDisabled("rename")}
          onSelect={() => {
            renameFocusPending.current = true
            onAction("rename")
          }}
        >
          <PencilIcon />
          Rename
          <ContextMenuShortcut>F2</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => onAction("new-folder")}>
          <FolderPlusIcon />
          New folder
          <ContextMenuShortcut>{shortcutLabel("new-folder")}</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem
          variant="destructive"
          disabled={actionDisabled("delete")}
          onSelect={() => onAction("delete")}
        >
          <Trash2Icon />
          Delete
          <ContextMenuShortcut>{shortcutLabel("delete")}</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          disabled={actionDisabled("permissions")}
          onSelect={() => onAction("permissions")}
        >
          <InfoIcon />
          Permissions…
          {!canChmod ? (
            <span className="ml-auto text-2xs text-muted-foreground">Unavailable</span>
          ) : null}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}

function RenameField({
  entry,
  onSubmit,
  onCancel,
}: {
  entry: FsEntry
  onSubmit: (name: string) => void
  onCancel: () => void
}) {
  const [value, setValue] = useState(entry.name)
  const [error, setError] = useState<string | null>(null)
  const done = useRef(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  const commit = () => {
    if (done.current) return
    const message = entryNameError(value)
    if (message) {
      setError(message)
      return
    }
    done.current = true
    if (value === entry.name) {
      onCancel()
    } else {
      onSubmit(value)
    }
  }

  return (
    <div className="min-w-0 flex-1">
      <Input
        ref={inputRef}
        value={value}
        onChange={(event) => {
          setValue(event.target.value)
          setError(null)
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault()
            event.stopPropagation()
            commit()
          } else if (event.key === "Escape") {
            event.preventDefault()
            event.stopPropagation()
            done.current = true
            onCancel()
          }
        }}
        onBlur={() => {
          if (!done.current) {
            done.current = true
            onCancel()
          }
        }}
        onClick={(event) => event.stopPropagation()}
        aria-label="New name"
        aria-invalid={Boolean(error)}
        className="h-5.5 rounded px-1.5 text-xs"
      />
      {error ? (
        <span className="absolute top-full left-0 z-10 mt-0.5 rounded bg-popover px-1 py-0.5 text-2xs text-destructive shadow-sm">
          {error}
        </span>
      ) : null}
    </div>
  )
}
