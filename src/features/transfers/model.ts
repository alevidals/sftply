import type { FsEntry, FsScope } from "@/lib/ipc/bindings"

/** Join a local directory and a file name using the directory's separator. */
export function joinLocalPath(directory: string, name: string): string {
  if (!directory) return name
  if (directory.endsWith("/") || directory.endsWith("\\")) return `${directory}${name}`

  const windowsDrive = /^[A-Za-z]:$/.test(directory)
  const usesBackslash = directory.includes("\\") && !directory.includes("/")
  const separator = windowsDrive || usesBackslash ? "\\" : "/"
  return `${directory}${separator}${name}`
}

/** Join a POSIX remote directory and a file name. */
export function joinRemotePath(directory: string, name: string): string {
  if (!directory || directory === "/") return `/${name}`
  return `${directory.replace(/\/+$/, "")}/${name}`
}

/** Entries that the transfer pipeline can move. Symlinks are never followed. */
export function transferableEntries(entries: readonly FsEntry[]): FsEntry[] {
  return entries.filter((entry) => entry.kind === "file" || entry.kind === "directory")
}

/** Number of selected entries that cannot be transferred. */
export function unsupportedEntryCount(entries: readonly FsEntry[]): number {
  return entries.length - transferableEntries(entries).length
}

/** In-app drag payload. OS file drops are handled separately. */
export const TRANSFER_DRAG_MIME = "application/x-sftply-entries"

export interface TransferDragPayload {
  scope: FsScope
  entries: FsEntry[]
}

/**
 * The payload of the drag currently in progress. WebKit on macOS can hide both
 * custom MIME types and `text/plain` during `dragover`, so the drop targets
 * fall back to this in-memory copy. It is cleared when the drag ends.
 */
let activeDrag: TransferDragPayload | null = null

export function writeTransferDrag(dataTransfer: DataTransfer, payload: TransferDragPayload): void {
  activeDrag = payload
  const encoded = JSON.stringify(payload)
  dataTransfer.setData(TRANSFER_DRAG_MIME, encoded)
  // Some WebViews do not expose custom MIME types during dragover. A plain
  // text mirror keeps the drop target working; reads still validate the JSON.
  dataTransfer.setData("text/plain", encoded)
  dataTransfer.effectAllowed = "copy"
}

/** Forget the in-flight payload once the drag ends or is dropped. */
export function clearTransferDrag(): void {
  activeDrag = null
}

/** Payload of the in-app drag in progress, if any. */
export function currentTransferDrag(): TransferDragPayload | null {
  return activeDrag
}

export function readTransferDrag(dataTransfer: DataTransfer): TransferDragPayload | null {
  const raw = dataTransfer.getData(TRANSFER_DRAG_MIME) || dataTransfer.getData("text/plain")
  if (!raw) return activeDrag
  try {
    const parsed = JSON.parse(raw) as Partial<TransferDragPayload>
    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.entries)) return null
    if (!parsed.scope || typeof parsed.scope !== "object") return null
    return parsed as TransferDragPayload
  } catch {
    return null
  }
}

/** Whether a drag event may carry an in-app transfer payload. */
export function isTransferDrag(dataTransfer: DataTransfer): boolean {
  return (
    activeDrag !== null ||
    dataTransfer.types.includes(TRANSFER_DRAG_MIME) ||
    dataTransfer.types.includes("text/plain")
  )
}

/** Transfers only run between the local pane and one remote pane. */
export function canDropTransfer(payload: TransferDragPayload, target: FsScope): boolean {
  if (payload.entries.length === 0) return false
  if (payload.scope.kind === "local") return target.kind === "remote"
  return target.kind === "local"
}
