import { describe, expect, it } from "vitest"
import {
  defaultSelection,
  selectedBytes,
  selectedCount,
  selectionToTransferEntries,
  statusLabel,
} from "@/features/sync/model"
import type { SyncEntry_Serialize, SyncPlan_Serialize } from "@/lib/ipc/bindings"

function entry(
  relativePath: string,
  action: SyncEntry_Serialize["action"],
  overrides: Partial<SyncEntry_Serialize> = {},
): SyncEntry_Serialize {
  const name = relativePath.split("/").pop() ?? relativePath
  return {
    relativePath,
    name,
    localPath: `/local/${relativePath}`,
    remotePath: null,
    remoteTargetPath: `/remote/${relativePath}`,
    localKind: "file",
    remoteKind: null,
    localSize: 10,
    remoteSize: null,
    localModifiedAt: 1_000,
    remoteModifiedAt: null,
    status: "localOnly",
    action,
    ...overrides,
  }
}

function plan(entries: SyncEntry_Serialize[]): SyncPlan_Serialize {
  return {
    localRoot: "/local",
    remoteRoot: "/remote",
    entries,
    uploadFiles: entries.filter((entry) => entry.action === "upload").length,
    uploadBytes: entries.reduce((total, entry) => total + (entry.localSize ?? 0), 0),
    createDirectories: entries.filter((entry) => entry.action === "createDirectory").length,
    equal: 0,
    remoteOnly: 0,
    unknown: 0,
    conflicts: 0,
    skipped: 0,
    truncated: false,
    warnings: [],
  }
}

describe("sync model", () => {
  it("selects uploads and new folders by default", () => {
    const value = plan([
      entry("new.txt", "upload"),
      entry("photos", "createDirectory", { localKind: "directory", localSize: 0 }),
      entry("existing.txt", "skip", { status: "equal" }),
      entry("remote-only.txt", "skip", {
        localPath: null,
        localKind: null,
        localSize: null,
        status: "remoteOnly",
        remotePath: "/remote/remote-only.txt",
      }),
      entry("unknown.txt", "review", { status: "unknown" }),
    ])

    expect([...defaultSelection(value)]).toEqual(["new.txt", "photos"])
  })

  it("adds missing parent folders for every selected file", () => {
    const value = plan([
      entry("photos", "createDirectory", { localKind: "directory", localSize: 0 }),
      entry("photos/2024", "createDirectory", { localKind: "directory", localSize: 0 }),
      entry("photos/2024/a.jpg", "upload"),
      entry("photos/2024/b.jpg", "upload"),
    ])
    const selected = new Set(["photos/2024/a.jpg", "photos/2024/b.jpg"])

    const transfers = selectionToTransferEntries(value, selected)

    expect(transfers.map((entry) => entry.relativePath)).toEqual([
      "photos/2024/a.jpg",
      "photos/2024/b.jpg",
      "photos",
      "photos/2024",
    ])
    expect(transfers[0]).toMatchObject({
      sourcePath: "/local/photos/2024/a.jpg",
      targetPath: "/remote/photos/2024/a.jpg",
      kind: "file",
    })
  })

  it("counts only selected uploads and folders", () => {
    const value = plan([
      entry("a.txt", "upload", { localSize: 10 }),
      entry("b.txt", "upload", { localSize: 20 }),
      entry("photos", "createDirectory", { localKind: "directory", localSize: 0 }),
    ])
    const selected = new Set(["a.txt", "photos"])

    expect(selectedBytes(value, selected)).toBe(10)
    expect(selectedCount(value, selected)).toEqual({ files: 1, directories: 1 })
  })

  it("labels every status for the UI", () => {
    expect(statusLabel("localOnly")).toBe("Only local")
    expect(statusLabel("typeMismatch")).toBe("Type mismatch")
  })
})
