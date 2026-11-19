import type {
  SyncEntry_Serialize,
  SyncEntryStatus,
  SyncPlan_Serialize,
  TransferPlanEntry_Deserialize,
} from "@/lib/ipc/bindings"

export function isActionable(entry: SyncEntry_Serialize): boolean {
  return (
    entry.action === "upload" || entry.action === "download" || entry.action === "createDirectory"
  )
}

/** Date-only differences stay unselected, but the user can choose to transfer them. */
export function isSelectable(entry: SyncEntry_Serialize): boolean {
  return isActionable(entry) || entry.status === "dateDiffers"
}

export function defaultSelection(plan: SyncPlan_Serialize): Set<string> {
  return new Set(plan.entries.filter(isActionable).map((entry) => entry.relativePath))
}

/** Add the missing parent folders of every selected file. */
export function selectionToTransferEntries(
  plan: SyncPlan_Serialize,
  selected: ReadonlySet<string>,
): TransferPlanEntry_Deserialize[] {
  const byPath = new Map(plan.entries.map((entry) => [entry.relativePath, entry]))
  const chosen = new Map<string, SyncEntry_Serialize>()

  for (const entry of plan.entries) {
    if (!selected.has(entry.relativePath) || !isSelectable(entry)) continue
    chosen.set(entry.relativePath, entry)
  }

  for (const entry of [...chosen.values()]) {
    const parts = entry.relativePath.split("/")
    for (let index = 1; index < parts.length; index += 1) {
      const parent = parts.slice(0, index).join("/")
      const parentEntry = byPath.get(parent)
      if (parentEntry?.action === "createDirectory") {
        chosen.set(parent, parentEntry)
      }
    }
  }

  return [...chosen.values()].flatMap((entry) => {
    const upload = plan.direction === "upload"
    const sourcePath = upload ? entry.localPath : entry.remotePath
    const targetPath = upload ? entry.remoteTargetPath : entry.localTargetPath
    const kind = upload ? entry.localKind : entry.remoteKind
    const size = upload ? entry.localSize : entry.remoteSize
    if (!sourcePath || !targetPath) return []
    return [
      {
        sourcePath,
        targetPath,
        relativePath: entry.relativePath,
        kind: kind ?? "file",
        size: size ?? 0,
        conflict: null,
      },
    ]
  })
}

export function statusLabel(status: SyncEntryStatus): string {
  switch (status) {
    case "localOnly":
      return "Only local"
    case "remoteOnly":
      return "Only remote"
    case "sizeDiffers":
      return "Size differs"
    case "dateDiffers":
      return "Date differs"
    case "contentDiffers":
      return "Content differs"
    case "equal":
      return "Equal"
    case "equalContent":
      return "Equal (content)"
    case "unknown":
      return "Unknown"
    case "typeMismatch":
      return "Type mismatch"
    case "unsupported":
      return "Skipped"
  }
}

export function selectedBytes(plan: SyncPlan_Serialize, selected: ReadonlySet<string>): number {
  return plan.entries.reduce((total, entry) => {
    if (!selected.has(entry.relativePath) || !isSelectable(entry)) return total
    if (
      entry.action !== "upload" &&
      entry.action !== "download" &&
      entry.status !== "dateDiffers"
    ) {
      return total
    }
    return total + ((plan.direction === "upload" ? entry.localSize : entry.remoteSize) ?? 0)
  }, 0)
}

export function selectedCount(
  plan: SyncPlan_Serialize,
  selected: ReadonlySet<string>,
): { files: number; directories: number } {
  let files = 0
  let directories = 0
  for (const entry of plan.entries) {
    if (!selected.has(entry.relativePath)) continue
    if (
      entry.action === "upload" ||
      entry.action === "download" ||
      entry.status === "dateDiffers"
    ) {
      files += 1
    }
    if (entry.action === "createDirectory") directories += 1
  }
  return { files, directories }
}
