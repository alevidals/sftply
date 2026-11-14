import type { FsEntry } from "@/lib/ipc/bindings"

export type PermissionClass = "owner" | "group" | "other"
export type PermissionBit = "read" | "write" | "execute"

export const PERMISSION_CLASSES: ReadonlyArray<{ id: PermissionClass; label: string }> = [
  { id: "owner", label: "Owner" },
  { id: "group", label: "Group" },
  { id: "other", label: "Other" },
]

export const PERMISSION_BITS: ReadonlyArray<{ id: PermissionBit; label: string }> = [
  { id: "read", label: "Read" },
  { id: "write", label: "Write" },
  { id: "execute", label: "Execute" },
]

const CLASS_SHIFT: Record<PermissionClass, number> = {
  owner: 6,
  group: 3,
  other: 0,
}

const BIT_VALUE: Record<PermissionBit, number> = {
  read: 0o4,
  write: 0o2,
  execute: 0o1,
}

/** True when the mode grants a class the given permission. */
export function hasPermission(
  mode: number,
  permissionClass: PermissionClass,
  bit: PermissionBit,
): boolean {
  const mask = BIT_VALUE[bit] << CLASS_SHIFT[permissionClass]
  return (mode & mask) !== 0
}

/** Toggle one permission bit while preserving the other bits, including setuid. */
export function setPermission(
  mode: number,
  permissionClass: PermissionClass,
  bit: PermissionBit,
  enabled: boolean,
): number {
  const mask = BIT_VALUE[bit] << CLASS_SHIFT[permissionClass]
  return enabled ? mode | mask : mode & ~mask
}

/**
 * The mode shared by every entry, or null when the selection is empty, mixed
 * or missing permission data. The dialog uses this to avoid pretending that
 * different modes are one value.
 */
export function commonMode(entries: readonly FsEntry[]): number | null {
  if (entries.length === 0) return null
  const first = entries[0]?.permissions
  if (first == null) return null
  return entries.every((entry) => entry.permissions === first) ? first : null
}
