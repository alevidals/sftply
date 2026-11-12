import { beforeEach, describe, expect, it } from "vitest"
import {
  canDropTransfer,
  clearTransferDrag,
  isTransferDrag,
  joinLocalPath,
  joinRemotePath,
  readTransferDrag,
  transferableEntries,
  unsupportedEntryCount,
  writeTransferDrag,
} from "@/features/transfers/model"
import type { FsEntry } from "@/lib/ipc/bindings"

function entry(name: string, kind: FsEntry["kind"] = "file"): FsEntry {
  return {
    name,
    path: `/dir/${name}`,
    kind,
    size: 1,
    modifiedAt: 0,
    permissions: 0o644,
    owner: null,
    group: null,
    linkTarget: null,
    hidden: false,
    metadataComplete: true,
  }
}

describe("transfer paths", () => {
  it("joins local POSIX paths", () => {
    expect(joinLocalPath("/Users/ada", "report.pdf")).toBe("/Users/ada/report.pdf")
    expect(joinLocalPath("/Users/ada/", "report.pdf")).toBe("/Users/ada/report.pdf")
    expect(joinLocalPath("/", "report.pdf")).toBe("/report.pdf")
  })

  it("joins Windows paths with a backslash", () => {
    expect(joinLocalPath("C:\\Users\\ada", "report.pdf")).toBe("C:\\Users\\ada\\report.pdf")
    expect(joinLocalPath("C:", "report.pdf")).toBe("C:\\report.pdf")
  })

  it("joins remote paths under the root", () => {
    expect(joinRemotePath("/", "report.pdf")).toBe("/report.pdf")
    expect(joinRemotePath("/home/ada", "report.pdf")).toBe("/home/ada/report.pdf")
    expect(joinRemotePath("/home/ada/", "report.pdf")).toBe("/home/ada/report.pdf")
  })

  it("keeps files and folders and skips special entries", () => {
    const entries = [entry("a.txt"), entry("folder", "directory"), entry("link", "symlink")]
    expect(transferableEntries(entries).map((item) => item.name)).toEqual(["a.txt", "folder"])
    expect(unsupportedEntryCount(entries)).toBe(1)
  })
})

describe("transfer drag payloads", () => {
  beforeEach(clearTransferDrag)

  function dataTransfer(): DataTransfer {
    const store = new Map<string, string>()
    const transfer = {
      effectAllowed: "all",
      dropEffect: "none",
      get types() {
        return [...store.keys()]
      },
      setData: (type: string, value: string) => {
        store.set(type, value)
      },
      getData: (type: string) => store.get(type) ?? "",
    }
    return transfer as unknown as DataTransfer
  }

  it("round-trips a payload and accepts cross-pane drops only", () => {
    const transfer = dataTransfer()
    const payload = {
      scope: { kind: "local" as const },
      entries: [entry("a.txt")],
    }
    writeTransferDrag(transfer, payload)

    expect(isTransferDrag(transfer)).toBe(true)
    expect(readTransferDrag(transfer)).toEqual(payload)
    expect(canDropTransfer(payload, { kind: "remote", sessionId: "s1" })).toBe(true)
    expect(canDropTransfer(payload, { kind: "local" })).toBe(false)
  })

  it("reads the plain-text mirror when the custom MIME is unavailable", () => {
    const transfer = dataTransfer()
    const payload = {
      scope: { kind: "remote" as const, sessionId: "s1" },
      entries: [entry("a.txt")],
    }
    transfer.setData("text/plain", JSON.stringify(payload))

    expect(readTransferDrag(transfer)).toEqual(payload)
  })

  it("ignores malformed payloads", () => {
    const transfer = dataTransfer()
    transfer.setData("application/x-sftply-entries", "{not json")
    expect(readTransferDrag(transfer)).toBeNull()
  })

  it("falls back to the in-memory payload when the WebView hides the types", () => {
    const transfer = dataTransfer()
    const payload = {
      scope: { kind: "local" as const },
      entries: [entry("a.txt")],
    }
    writeTransferDrag(transfer, payload)

    // WebKit on macOS can report no MIME types and no data during dragover.
    const opaque = { ...transfer, types: [], getData: () => "" } as unknown as DataTransfer
    expect(isTransferDrag(opaque)).toBe(true)
    expect(readTransferDrag(opaque)).toEqual(payload)
  })

  it("stops recognising drags once the drag ends", () => {
    const transfer = dataTransfer()
    writeTransferDrag(transfer, {
      scope: { kind: "local" as const },
      entries: [entry("a.txt")],
    })
    clearTransferDrag()

    const opaque = { ...transfer, types: [], getData: () => "" } as unknown as DataTransfer
    expect(isTransferDrag(opaque)).toBe(false)
    expect(readTransferDrag(opaque)).toBeNull()
  })
})
