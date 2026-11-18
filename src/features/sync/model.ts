import type {
  SyncEntry_Serialize,
  SyncEntryStatus,
  SyncPlan_Serialize,
  TransferPlanEntry_Deserialize,
} from "@/lib/ipc/bindings"

export function isActionable(entry: SyncEntry_Serialize): boolean {
  return entry.action === "upload" || entry.action === "createDirectory"
}

/** Date-only differences stay unselected, but the user can choose to upload them. */
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
    if (!entry.localPath || !entry.remoteTargetPath) return []
    return [
      {
        sourcePath: entry.localPath,
        targetPath: entry.remoteTargetPath,
        relativePath: entry.relativePath,
        kind: entry.localKind ?? "file",
        size: entry.localSize ?? 0,
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
    if (entry.action !== "upload" && entry.status !== "dateDiffers") return total
    return total + (entry.localSize ?? 0)
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
    if (entry.action === "upload" || entry.status === "dateDiffers") files += 1
    if (entry.action === "createDirectory") directories += 1
  }
  return { files, directories }
}
