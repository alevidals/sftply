import { AlertTriangleIcon, FileTextIcon, ImageIcon, LoaderCircleIcon } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { filesApi } from "@/features/files/api"
import { useFormatPreferences } from "@/features/settings/settings-context"
import { errorMessage } from "@/lib/errors"
import { formatBytes } from "@/lib/format"
import type { FsEntry, FsScope, PreviewPayload_Serialize } from "@/lib/ipc/bindings"

interface PreviewDialogProps {
  open: boolean
  scope: FsScope
  entry: FsEntry | null
  onOpenChange: (open: boolean) => void
}

/** Read-only text or image preview. HTML and SVG are shown as text. */
export function PreviewDialog({ open, scope, entry, onOpenChange }: PreviewDialogProps) {
  const { sizeFormat } = useFormatPreferences()
  const [payload, setPayload] = useState<PreviewPayload_Serialize | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const scopeRef = useRef(scope)
  scopeRef.current = scope
  const entryPath = entry?.path ?? null

  useEffect(() => {
    if (!open || !entryPath) return
    let cancelled = false
    setLoading(true)
    setError(null)
    setPayload(null)
    filesApi(scopeRef.current)
      .preview(entryPath)
      .then((next) => {
        if (!cancelled) setPayload(next)
      })
      .catch((cause) => {
        if (!cancelled) setError(errorMessage(cause))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [entryPath, open])

  const isImage = payload?.kind === "image"

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100vh-2rem)] grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {isImage ? (
              <ImageIcon className="size-4 text-primary" />
            ) : (
              <FileTextIcon className="size-4 text-primary" />
            )}
            <span className="min-w-0 truncate">{entry?.name ?? "Preview"}</span>
          </DialogTitle>
          <DialogDescription className="selectable truncate font-mono text-2xs">
            {entry?.path ?? ""}
            {payload ? ` · ${formatBytes(payload.size, sizeFormat)}` : ""}
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 overflow-auto">
          {loading ? (
            <div className="flex h-48 flex-col items-center justify-center gap-2 text-xs text-muted-foreground">
              <LoaderCircleIcon className="size-5 animate-spin" />
              Loading preview…
            </div>
          ) : error ? (
            <div className="flex h-48 flex-col items-center justify-center gap-3 text-center">
              <AlertTriangleIcon className="size-5 text-destructive" />
              <p className="max-w-md text-xs text-destructive" role="alert">
                {error}
              </p>
            </div>
          ) : payload?.kind === "text" ? (
            <pre className="max-h-[58vh] overflow-auto rounded-md border border-border bg-muted/30 p-3 font-mono text-xs leading-relaxed break-words whitespace-pre-wrap">
              {payload.content || "(empty file)"}
            </pre>
          ) : payload?.kind === "image" && payload.dataUrl ? (
            <div className="flex max-h-[58vh] items-center justify-center overflow-auto rounded-md border border-border bg-muted/30 p-3">
              <img
                src={payload.dataUrl}
                alt={entry?.name ?? "File preview"}
                className="max-h-[54vh] max-w-full object-contain"
              />
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
