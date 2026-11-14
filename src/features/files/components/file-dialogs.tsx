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
import { Label } from "@/components/ui/label"
import { entryNameError } from "@/features/files/model/names"
import {
  commonMode,
  hasPermission,
  PERMISSION_BITS,
  PERMISSION_CLASSES,
  setPermission,
} from "@/features/files/model/permissions"
import { errorMessage } from "@/lib/errors"
import { formatMode, formatModeSymbolic } from "@/lib/format"
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
  /** Pane the entries belong to: "Local" or "Remote". */
  scope: string
  onOpenChange: (open: boolean) => void
  onConfirm: (recursive: boolean) => Promise<void>
}

export function DeleteDialog({ open, entries, scope, onOpenChange, onConfirm }: DeleteDialogProps) {
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
            <span className="rounded border border-border px-1.5 py-0.5 text-2xs font-normal text-muted-foreground">
              {scope}
            </span>
          </AlertDialogTitle>
          <AlertDialogDescription>
            {hasDirectory
              ? `The folders and everything inside them will be removed from ${scope === "Local" ? "this computer" : "the server"}. This cannot be undone.`
              : `The files will be removed from ${scope === "Local" ? "this computer" : "the server"}. This cannot be undone.`}
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
  entries: readonly FsEntry[]
  onOpenChange: (open: boolean) => void
  onConfirm: (mode: number) => Promise<void>
}

export function PermissionsDialog({
  open,
  entries,
  onOpenChange,
  onConfirm,
}: PermissionsDialogProps) {
  const [mode, setMode] = useState(0o644)
  const [value, setValue] = useState("0644")
  const [valid, setValid] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const shared = commonMode(entries)
  const mixed = entries.length > 0 && shared === null
  const allDirectories = entries.length > 0 && entries.every((entry) => entry.kind === "directory")
  const hasDirectory = entries.some((entry) => entry.kind === "directory")
  const title =
    entries.length === 1 ? (entries[0]?.name ?? "Permissions") : `${entries.length} items`

  // Seed from the shared mode; a mixed selection starts from the first entry
  // and says so, rather than pretending the modes are identical.
  useEffect(() => {
    if (!open) return
    const initial = commonMode(entries) ?? entries[0]?.permissions ?? 0o644
    setMode(initial)
    setValue(formatMode(initial))
    setValid(true)
    setError(null)
    setBusy(false)
  }, [open, entries])

  const parsed = valid ? mode : null
  const preview = formatModeSymbolic(parsed, allDirectories)

  const toggle = (
    permissionClass: (typeof PERMISSION_CLASSES)[number]["id"],
    bit: (typeof PERMISSION_BITS)[number]["id"],
    enabled: boolean,
  ) => {
    const next = setPermission(mode, permissionClass, bit, enabled)
    setMode(next)
    setValue(formatMode(next))
    setValid(true)
    setError(null)
  }

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
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <LockIcon className="size-4 text-primary" />
              Permissions
            </DialogTitle>
            <DialogDescription className="truncate">{title}</DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-4">
            {mixed ? (
              <p className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-2xs leading-relaxed text-warning">
                The selected items have different or unknown modes. The value below starts from “
                {entries[0]?.name}” and will be applied to all of them.
              </p>
            ) : null}

            <div className="space-y-1.5">
              <Label htmlFor="permissions-mode">Mode</Label>
              <Input
                id="permissions-mode"
                value={value}
                onChange={(event) => {
                  const next = event.target.value
                  setValue(next)
                  setError(null)
                  if (/^[0-7]{1,4}$/.test(next)) {
                    setMode(Number.parseInt(next, 8))
                    setValid(true)
                  } else {
                    setValid(false)
                  }
                }}
                spellCheck={false}
                autoComplete="off"
                className="font-mono"
                aria-invalid={Boolean(error) || !valid}
                aria-describedby="permissions-hint"
              />
              <p id="permissions-hint" className="text-2xs text-muted-foreground">
                One to four octal digits, for example 0644.
              </p>
            </div>

            <fieldset
              aria-label="Permission bits"
              className="m-0 overflow-hidden rounded-md border border-border bg-muted/20 p-0"
            >
              <div className="grid grid-cols-[64px_repeat(3,minmax(0,1fr))] items-center gap-2 border-b border-border/60 bg-muted/40 px-3 py-1.5 text-2xs font-medium tracking-wide text-muted-foreground uppercase">
                <span />
                {PERMISSION_BITS.map((bit) => (
                  <span key={bit.id} className="text-center">
                    {bit.label}
                  </span>
                ))}
              </div>
              {PERMISSION_CLASSES.map((permissionClass) => (
                <div
                  key={permissionClass.id}
                  className="grid grid-cols-[64px_repeat(3,minmax(0,1fr))] items-center gap-2 border-b border-border/40 px-3 py-1.5 last:border-b-0"
                >
                  <span className="text-2xs text-muted-foreground">{permissionClass.label}</span>
                  {PERMISSION_BITS.map((bit) => (
                    <span key={bit.id} className="flex justify-center">
                      <Checkbox
                        checked={hasPermission(mode, permissionClass.id, bit.id)}
                        onCheckedChange={(checked) =>
                          toggle(permissionClass.id, bit.id, checked === true)
                        }
                        aria-label={`${permissionClass.label} ${bit.label.toLowerCase()}`}
                      />
                    </span>
                  ))}
                </div>
              ))}
            </fieldset>

            <div className="selectable flex items-center justify-between rounded-md border border-border bg-muted/30 px-3 py-2">
              <span className="font-mono text-sm">{preview}</span>
              <span className="text-2xs text-muted-foreground">
                {parsed === null ? "Invalid mode" : `0o${parsed.toString(8)}`}
              </span>
            </div>

            {hasDirectory ? (
              <p className="text-2xs leading-relaxed text-muted-foreground">
                Folders are changed themselves; their contents keep their current modes.
              </p>
            ) : null}

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
