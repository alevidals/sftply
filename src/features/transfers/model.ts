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

export function writeTransferDrag(dataTransfer: DataTransfer, payload: TransferDragPayload): void {
  dataTransfer.setData(TRANSFER_DRAG_MIME, JSON.stringify(payload))
  dataTransfer.effectAllowed = "copy"
}

export function readTransferDrag(dataTransfer: DataTransfer): TransferDragPayload | null {
  const raw = dataTransfer.getData(TRANSFER_DRAG_MIME)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Partial<TransferDragPayload>
    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.entries)) return null
    if (!parsed.scope || typeof parsed.scope !== "object") return null
    return parsed as TransferDragPayload
  } catch {
    return null
  }
}

/** Transfers only run between the local pane and one remote pane. */
export function canDropTransfer(payload: TransferDragPayload, target: FsScope): boolean {
  if (payload.entries.length === 0) return false
  if (payload.scope.kind === "local") return target.kind === "remote"
  return target.kind === "local"
}
