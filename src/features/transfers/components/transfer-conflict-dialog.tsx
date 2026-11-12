import { FilesIcon } from "lucide-react"
import { useState } from "react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import type { ConflictChoice } from "@/features/transfers/use-transfer-actions"
import { errorMessage } from "@/lib/errors"
import { formatBytes } from "@/lib/format"
import type { TransferConflict, TransferDirection } from "@/lib/ipc/bindings"

interface TransferConflictDialogProps {
  open: boolean
  conflicts: readonly TransferConflict[]
  direction: TransferDirection
  onOpenChange: (open: boolean) => void
  onConfirm: (choice: ConflictChoice) => Promise<void>
}

/** Ask once for every existing target before the queue starts. */
export function TransferConflictDialog({
  open,
  conflicts,
  direction,
  onOpenChange,
  onConfirm,
}: TransferConflictDialogProps) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const choose = async (choice: ConflictChoice) => {
    setBusy(true)
    setError(null)
    try {
      await onConfirm(choice)
      onOpenChange(false)
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setBusy(false)
    }
  }

  const noun = direction === "upload" ? "remote" : "local"

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FilesIcon className="size-4 text-warning" />
            {conflicts.length === 1
              ? `“${conflicts[0]?.targetPath.split(/[\\/]/).pop() ?? "A file"}” already exists`
              : `${conflicts.length} files already exist`}
          </DialogTitle>
          <DialogDescription>
            {conflicts.length === 1
              ? `A file with that name is already in the ${noun} folder.`
              : `These names already exist in the ${noun} folder. Choose what to do for all of them.`}
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-36 space-y-1 overflow-auto rounded-md border border-border bg-muted/30 p-2 text-2xs">
          {conflicts.slice(0, 10).map((conflict) => (
            <div key={conflict.targetPath} className="flex items-center gap-2">
              <span className="selectable min-w-0 flex-1 truncate font-mono text-muted-foreground">
                {conflict.targetPath}
              </span>
              <span className="shrink-0 tabular text-muted-foreground/80">
                {conflict.kind === "directory" ? "folder" : formatBytes(conflict.size)}
              </span>
            </div>
          ))}
          {conflicts.length > 10 ? (
            <div className="text-muted-foreground">…and {conflicts.length - 10} more</div>
          ) : null}
        </div>

        {error ? (
          <p className="text-xs text-destructive" role="alert">
            {error}
          </p>
        ) : null}

        <DialogFooter className="gap-2 sm:justify-between">
          <Button type="button" variant="ghost" disabled={busy} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => void choose("skip")}
            >
              Skip existing
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => void choose("rename")}
            >
              Keep both
            </Button>
            <Button type="button" disabled={busy} onClick={() => void choose("overwrite")}>
              {busy ? "Queueing…" : "Replace"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
