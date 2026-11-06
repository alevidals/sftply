import type { FsEntry } from "@/lib/ipc/bindings"

export type SortColumn = "name" | "size" | "modified" | "permissions"
export type SortDirection = "asc" | "desc"

export interface SortState {
  column: SortColumn
  direction: SortDirection
}

export const DEFAULT_SORT: SortState = { column: "name", direction: "asc" }

/** Toggle a column: same column flips direction, a different column starts ascending. */
export function nextSort(current: SortState, column: SortColumn): SortState {
  if (current.column === column) {
    return { column, direction: current.direction === "asc" ? "desc" : "asc" }
  }
  return { column, direction: "asc" }
}

function compareNullable(a: number | null, b: number | null, factor: number): number {
  if (a === null && b === null) return 0
  if (a === null) return 1
  if (b === null) return -1
  return (a - b) * factor
}

function compareEntries(a: FsEntry, b: FsEntry, sort: SortState, factor: number): number {
  switch (sort.column) {
    case "name":
      return (
        a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }) * factor
      )
    case "size":
      return compareNullable(a.size, b.size, factor)
    case "modified":
      return compareNullable(a.modifiedAt ?? null, b.modifiedAt ?? null, factor)
    case "permissions":
      return compareNullable(a.permissions ?? null, b.permissions ?? null, factor)
  }
}

/**
 * Sort a listing. Folders always come first regardless of column or direction;
 * this matches every desktop file manager and keeps navigation predictable.
 */
export function sortEntries(entries: readonly FsEntry[], sort: SortState): FsEntry[] {
  const factor = sort.direction === "asc" ? 1 : -1
  return [...entries].sort((a, b) => {
    const aDirectory = a.kind === "directory"
    const bDirectory = b.kind === "directory"
    if (aDirectory !== bDirectory) return aDirectory ? -1 : 1
    return compareEntries(a, b, sort, factor)
  })
}
