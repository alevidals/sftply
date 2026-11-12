import { AlertTriangleIcon, FolderPlusIcon, LockIcon } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { entryNameError } from "@/features/files/model/names"
import { errorMessage } from "@/lib/errors"
import { formatModeSymbolic } from "@/lib/format"
import type { FsEntry } from "@/lib/ipc/bindings"

interface NewFolderDialogProps {
  open: boolean
  parentPath: string
  onOpenChange: (open: boolean) => void
  onCreate: (name: string) => Promise<void>
}

export function NewFolderDialog({
  open,
  parentPath,
  onOpenChange,
  onCreate,
}: NewFolderDialogProps) {
  const [name, setName] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    setName("")
    setError(null)
    setBusy(false)
    requestAnimationFrame(() => inputRef.current?.focus())
  }, [open])

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    const message = entryNameError(name)
    if (message) {
      setError(message)
      return
    }
    setBusy(true)
    setError(null)
    try {
      await onCreate(name)
      onOpenChange(false)
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="sm:max-w-sm">
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FolderPlusIcon className="size-4 text-primary" />
              New folder
            </DialogTitle>
            <DialogDescription className="selectable truncate font-mono text-2xs">
              {parentPath}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-1.5 py-4">
            <Label htmlFor="new-folder-name">Name</Label>
            <Input
              id="new-folder-name"
              ref={inputRef}
              value={name}
              onChange={(event) => {
                setName(event.target.value)
                setError(null)
              }}
              aria-invalid={Boolean(error)}
              autoComplete="off"
              spellCheck={false}
              placeholder="untitled folder"
            />
            {error ? (
              <p className="text-xs text-destructive" role="alert">
                {error}
              </p>
            ) : null}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={busy || name.trim().length === 0}>
              {busy ? "Creating…" : "Create folder"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

interface DeleteDialogProps {
  open: boolean
  entries: readonly FsEntry[]
  onOpenChange: (open: boolean) => void
  onConfirm: (recursive: boolean) => Promise<void>
}

export function DeleteDialog({ open, entries, onOpenChange, onConfirm }: DeleteDialogProps) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const hasDirectory = entries.some((entry) => entry.kind === "directory")
  const title =
    entries.length === 1
      ? `Delete “${entries[0]?.name ?? "item"}”?`
      : `Delete ${entries.length} items?`

  useEffect(() => {
    if (open) {
      setBusy(false)
      setError(null)
    }
  }, [open])

  const confirm = async () => {
    setBusy(true)
    setError(null)
    try {
      await onConfirm(hasDirectory)
      onOpenChange(false)
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setBusy(false)
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <AlertTriangleIcon className="size-4 text-destructive" />
            {title}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {hasDirectory
              ? "Folders and everything inside them will be removed. This cannot be undone."
              : "This cannot be undone."}
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="selectable max-h-32 space-y-0.5 overflow-auto rounded-md border border-border bg-muted/30 p-2 font-mono text-2xs text-muted-foreground">
          {entries.slice(0, 12).map((entry) => (
            <div key={entry.path} className="truncate">
              {entry.name}
              {entry.kind === "directory" ? "/" : ""}
            </div>
          ))}
          {entries.length > 12 ? <div>…and {entries.length - 12} more</div> : null}
        </div>

        {error ? (
          <p className="text-xs text-destructive" role="alert">
            {error}
          </p>
        ) : null}

        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={busy}
            onClick={(event) => {
              // Radix closes the dialog on click by default; keep it open until
              // the backend confirms, so failures stay visible.
              event.preventDefault()
              void confirm()
            }}
          >
            {busy ? "Deleting…" : "Delete"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

interface PermissionsDialogProps {
  open: boolean
  entry: FsEntry | null
  onOpenChange: (open: boolean) => void
  onConfirm: (mode: number) => Promise<void>
}

export function PermissionsDialog({
  open,
  entry,
  onOpenChange,
  onConfirm,
}: PermissionsDialogProps) {
  const [value, setValue] = useState("0644")
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    setValue((entry?.permissions ?? 0o644).toString(8).padStart(4, "0"))
    setError(null)
    setBusy(false)
  }, [open, entry])

  const parsed = /^[0-7]{1,4}$/.test(value) ? Number.parseInt(value, 8) : null
  const preview = formatModeSymbolic(parsed, entry?.kind === "directory")

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (parsed === null || parsed > 0o7777) {
      setError("Use one to four octal digits, for example 0644.")
      return
    }
    setBusy(true)
    setError(null)
    try {
      await onConfirm(parsed)
      onOpenChange(false)
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="sm:max-w-sm">
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <LockIcon className="size-4 text-primary" />
              Permissions
            </DialogTitle>
            <DialogDescription className="truncate">{entry?.name}</DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-4">
            <div className="space-y-1.5">
              <Label htmlFor="permissions-mode">Mode</Label>
              <Input
                id="permissions-mode"
                value={value}
                onChange={(event) => {
                  setValue(event.target.value)
                  setError(null)
                }}
                spellCheck={false}
                autoComplete="off"
                className="font-mono"
                aria-invalid={Boolean(error)}
              />
            </div>
            <div className="selectable flex items-center justify-between rounded-md border border-border bg-muted/30 px-3 py-2">
              <span className="font-mono text-sm">{preview}</span>
              <span className="text-2xs text-muted-foreground">
                {parsed === null ? "Invalid mode" : `0o${parsed.toString(8).padStart(4, "0")}`}
              </span>
            </div>
            {error ? (
              <p className="text-xs text-destructive" role="alert">
                {error}
              </p>
            ) : null}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={busy || parsed === null}>
              {busy ? "Saving…" : "Apply"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
