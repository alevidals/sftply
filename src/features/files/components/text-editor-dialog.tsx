import {
  AlertTriangleIcon,
  FileTextIcon,
  LoaderCircleIcon,
  RotateCcwIcon,
  SaveIcon,
} from "lucide-react"
import { useCallback, useEffect, useRef, useState } from "react"
import { toast } from "sonner"
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
import { textStats } from "@/features/files/model/text"
import { normalizeError } from "@/lib/errors"
import { formatBytes } from "@/lib/format"
import type { FsEntry, FsScope, TextFile } from "@/lib/ipc/bindings"

interface TextEditorDialogProps {
  open: boolean
  entry: FsEntry | null
  scope: FsScope
  canWrite: boolean
  onOpenChange: (open: boolean) => void
  onSaved: (file: TextFile) => void
}

/**
 * Remote/local UTF-8 text editor. The backend enforces the size, binary and
 * encoding limits; this dialog only mirrors them in the UI. Saving sends the
 * version observed at load time so an external edit is reported as a conflict
 * instead of being overwritten silently.
 */
export function TextEditorDialog({
  open,
  entry,
  scope,
  canWrite,
  onOpenChange,
  onSaved,
}: TextEditorDialogProps) {
  const path = entry?.path ?? null
  const scopeRef = useRef(scope)
  scopeRef.current = scope

  const [file, setFile] = useState<TextFile | null>(null)
  const [content, setContent] = useState("")
  const [savedContent, setSavedContent] = useState("")
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [conflict, setConflict] = useState(false)
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const loadId = useRef(0)

  const dirty = file !== null && content !== savedContent
  const stats = textStats(content)

  const load = useCallback(async () => {
    if (!path) return
    const id = ++loadId.current
    setLoading(true)
    setLoadError(null)
    setSaveError(null)
    setConflict(false)
    setConfirmDiscard(false)
    setFile(null)
    try {
      const loaded = await filesApi(scopeRef.current).readText(path)
      if (id !== loadId.current) return
      setFile(loaded)
      setContent(loaded.content)
      setSavedContent(loaded.content)
    } catch (error) {
      if (id !== loadId.current) return
      setLoadError(normalizeError(error).message)
    } finally {
      if (id === loadId.current) setLoading(false)
    }
  }, [path])

  useEffect(() => {
    if (!open) {
      loadId.current += 1
      return
    }
    void load()
  }, [open, load])

  const save = async (force: boolean) => {
    if (!file || saving || !canWrite) return
    setSaving(true)
    setSaveError(null)
    try {
      const saved = await filesApi(scopeRef.current).writeText(
        file.path,
        content,
        force ? null : file.version,
        force,
      )
      setFile(saved)
      setSavedContent(content)
      setConflict(false)
      toast.success(`Saved “${entry?.name ?? "file"}”`)
      onSaved(saved)
    } catch (error) {
      const normalized = normalizeError(error)
      if (normalized.code === "CONFLICT") {
        setConflict(true)
      } else {
        setSaveError(normalized.message)
      }
    } finally {
      setSaving(false)
    }
  }

  const requestClose = () => {
    if (saving) return
    if (dirty) {
      setConfirmDiscard(true)
      return
    }
    onOpenChange(false)
  }

  const title = entry?.name ?? "Text editor"

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) onOpenChange(true)
        else requestClose()
      }}
    >
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex min-w-0 items-center gap-2">
            <FileTextIcon className="size-4 shrink-0 text-primary" />
            <span className="truncate">{title}</span>
          </DialogTitle>
          <DialogDescription className="truncate font-mono text-2xs">
            {path ?? "No file selected"}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2 py-2">
          {loading ? (
            <div className="flex h-[52vh] flex-col items-center justify-center gap-2 rounded-md border border-border bg-muted/20 text-xs text-muted-foreground">
              <LoaderCircleIcon className="size-4 animate-spin" />
              Loading file…
            </div>
          ) : loadError ? (
            <div className="flex h-[52vh] flex-col items-center justify-center gap-3 rounded-md border border-border bg-muted/20 px-6 text-center">
              <AlertTriangleIcon className="size-5 text-destructive" />
              <p className="max-w-md text-xs text-foreground">{loadError}</p>
              <Button variant="outline" size="sm" onClick={() => void load()}>
                <RotateCcwIcon />
                Try again
              </Button>
            </div>
          ) : (
            <>
              {!canWrite ? (
                <p className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-2xs text-warning">
                  This connection cannot save text files. The contents are read-only here.
                </p>
              ) : null}
              {conflict ? (
                <div className="flex flex-wrap items-center gap-2 rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-2xs text-warning">
                  <AlertTriangleIcon className="size-3.5 shrink-0" />
                  <span className="min-w-0 flex-1">
                    The file changed since you opened it. Reload to see the new version, or
                    overwrite it with your edits.
                  </span>
                  <Button variant="outline" size="xs" disabled={saving} onClick={() => void load()}>
                    <RotateCcwIcon />
                    Reload
                  </Button>
                  <Button size="xs" disabled={saving} onClick={() => void save(true)}>
                    Overwrite
                  </Button>
                </div>
              ) : null}
              <textarea
                value={content}
                onChange={(event) => {
                  setContent(event.target.value)
                  setSaveError(null)
                }}
                onKeyDown={(event) => {
                  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
                    event.preventDefault()
                    void save(false)
                  }
                }}
                readOnly={!canWrite}
                spellCheck={false}
                autoComplete="off"
                aria-label="File contents"
                className="select-text h-[52vh] w-full resize-none rounded-md border border-border bg-background p-3 font-mono text-xs leading-relaxed text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
              />
              {saveError ? (
                <p className="text-xs text-destructive" role="alert">
                  {saveError}
                </p>
              ) : null}
            </>
          )}
        </div>

        <DialogFooter className="sm:justify-between">
          <div className="flex items-center gap-3 text-2xs text-muted-foreground tabular">
            <span>{stats.lines} lines</span>
            <span>{formatBytes(stats.bytes)}</span>
            <span>UTF-8</span>
            {dirty ? <span className="text-warning">Unsaved changes</span> : null}
          </div>

          {confirmDiscard ? (
            <div className="flex items-center gap-2">
              <span className="text-2xs text-warning">Discard your changes?</span>
              <Button variant="ghost" size="sm" onClick={() => setConfirmDiscard(false)}>
                Keep editing
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => {
                  setConfirmDiscard(false)
                  onOpenChange(false)
                }}
              >
                Discard
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" disabled={saving} onClick={requestClose}>
                Close
              </Button>
              <Button
                size="sm"
                disabled={!canWrite || !dirty || saving || loading || Boolean(loadError)}
                onClick={() => void save(false)}
              >
                {saving ? <LoaderCircleIcon className="animate-spin" /> : <SaveIcon />}
                {saving ? "Saving…" : "Save"}
              </Button>
            </div>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
