import type { FsEntry } from "@/lib/ipc/bindings"

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

/** Entries that the single-file transfer pipeline can move today. */
export function transferableEntries(entries: readonly FsEntry[]): FsEntry[] {
  return entries.filter((entry) => entry.kind === "file")
}

/** Number of selected entries that cannot be transferred yet. */
export function unsupportedEntryCount(entries: readonly FsEntry[]): number {
  return entries.length - transferableEntries(entries).length
}
