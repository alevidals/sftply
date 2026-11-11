import { describe, expect, it } from "vitest"
import {
  joinLocalPath,
  joinRemotePath,
  transferableEntries,
  unsupportedEntryCount,
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

  it("separates files from folders and special entries", () => {
    const entries = [entry("a.txt"), entry("folder", "directory"), entry("link", "symlink")]
    expect(transferableEntries(entries).map((item) => item.name)).toEqual(["a.txt"])
    expect(unsupportedEntryCount(entries)).toBe(2)
  })
})
