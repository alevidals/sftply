import { describe, expect, it } from "vitest"
import { DEFAULT_SORT, nextSort, type SortState, sortEntries } from "@/features/files/model/sort"
import type { FsEntry } from "@/lib/ipc/bindings"

function entry(overrides: Partial<FsEntry> & Pick<FsEntry, "name">): FsEntry {
  return {
    path: `/tmp/${overrides.name}`,
    kind: "file",
    size: 0,
    modifiedAt: null,
    permissions: null,
    owner: null,
    group: null,
    linkTarget: null,
    hidden: false,
    metadataComplete: true,
    ...overrides,
  }
}

describe("nextSort", () => {
  it("flips the direction for the active column and resets others", () => {
    expect(nextSort(DEFAULT_SORT, "name")).toEqual({ column: "name", direction: "desc" })
    expect(nextSort(DEFAULT_SORT, "size")).toEqual({ column: "size", direction: "asc" })
  })
})

describe("sortEntries", () => {
  const entries = [
    entry({ name: "b.txt", size: 20 }),
    entry({ name: "Folder", kind: "directory" }),
    entry({ name: "a.txt", size: 10 }),
    entry({ name: "c.txt", size: 30, modifiedAt: 100 }),
    entry({ name: "missing.txt", size: 5, modifiedAt: null }),
  ]

  it("always keeps folders first", () => {
    const sorted = sortEntries(entries, { column: "size", direction: "desc" })
    expect(sorted[0]?.name).toBe("Folder")
  })

  it("sorts by name ascending by default", () => {
    const sorted = sortEntries(entries, DEFAULT_SORT)
    expect(sorted.map((item) => item.name)).toEqual([
      "Folder",
      "a.txt",
      "b.txt",
      "c.txt",
      "missing.txt",
    ])
  })

  it("sorts numeric columns and puts missing metadata last", () => {
    const sort: SortState = { column: "size", direction: "asc" }
    const sorted = sortEntries(entries, sort)
    expect(sorted.slice(1).map((item) => item.name)).toEqual([
      "missing.txt",
      "a.txt",
      "b.txt",
      "c.txt",
    ])

    const byModified = sortEntries(entries, { column: "modified", direction: "desc" })
    expect(byModified.at(-1)?.name).toBe("missing.txt")
  })
})

describe("large listing performance", () => {
  it("sorts and filters 10k entries within the interaction budget", () => {
    const entries = Array.from({ length: 10_000 }, (_, index) =>
      entry({
        name: `entry-${String(index).padStart(5, "0")}.txt`,
        size: (index * 7919) % 1_000_000,
        modifiedAt: 1_700_000_000_000 + index * 1000,
        permissions: 0o644,
      }),
    )

    const started = performance.now()
    const filtered = entries.filter((item) => item.name.includes("99"))
    const sorted = sortEntries(filtered, { column: "size", direction: "desc" })
    const elapsed = performance.now() - started

    expect(sorted.length).toBeGreaterThan(0)
    expect(elapsed).toBeLessThan(1000)
  })
})
