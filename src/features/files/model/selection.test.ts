import { describe, expect, it } from "vitest"
import {
  clearSelection,
  EMPTY_SELECTION,
  focusRow,
  moveSelection,
  pruneSelection,
  selectAll,
  selectByPrefix,
  selectRow,
} from "@/features/files/model/selection"

const entries = ["a", "b", "c", "d"].map((name) => ({ path: `/tmp/${name}` }))

describe("selectRow", () => {
  it("replaces the selection on a plain click", () => {
    const first = selectRow(entries, EMPTY_SELECTION, 1, "replace")
    expect([...first.selected]).toEqual(["/tmp/b"])
    expect(first.anchor).toBe(1)
    expect(first.active).toBe(1)
  })

  it("toggles individual rows with a modifier click", () => {
    const first = selectRow(entries, EMPTY_SELECTION, 0, "replace")
    const second = selectRow(entries, first, 2, "toggle")
    expect([...second.selected].sort()).toEqual(["/tmp/a", "/tmp/c"])
    const third = selectRow(entries, second, 0, "toggle")
    expect([...third.selected]).toEqual(["/tmp/c"])
  })

  it("selects an inclusive range from the anchor", () => {
    const first = selectRow(entries, EMPTY_SELECTION, 1, "replace")
    const range = selectRow(entries, first, 3, "range")
    expect([...range.selected].sort()).toEqual(["/tmp/b", "/tmp/c", "/tmp/d"])
    expect(range.anchor).toBe(1)
    expect(range.active).toBe(3)
  })

  it("moves the active row without clearing a multi-selection", () => {
    const first = selectRow(entries, EMPTY_SELECTION, 0, "replace")
    const second = selectRow(entries, first, 2, "toggle")
    const focused = selectRow(entries, second, 2, "focus")
    expect([...focused.selected].sort()).toEqual(["/tmp/a", "/tmp/c"])
    expect(focused.anchor).toBe(2)
    expect(focused.active).toBe(2)
  })
})

describe("keyboard movement", () => {
  it("moves without extending", () => {
    const first = selectRow(entries, EMPTY_SELECTION, 0, "replace")
    const moved = moveSelection(entries, first, 1, false)
    expect([...moved.selected]).toEqual(["/tmp/b"])
    expect(moved.active).toBe(1)
    expect(moved.anchor).toBe(1)
  })

  it("extends from the anchor with shift", () => {
    const first = selectRow(entries, EMPTY_SELECTION, 1, "replace")
    const extended = moveSelection(entries, first, 2, true)
    expect([...extended.selected].sort()).toEqual(["/tmp/b", "/tmp/c", "/tmp/d"])
    expect(extended.anchor).toBe(1)
  })

  it("clamps to the list and seeds the first row", () => {
    const down = moveSelection(entries, EMPTY_SELECTION, 1, false)
    expect(down.active).toBe(0)
    const up = moveSelection(entries, EMPTY_SELECTION, -1, false)
    expect(up.active).toBe(3)
    const clamped = moveSelection(entries, down, 100, false)
    expect(clamped.active).toBe(3)
  })

  it("focuses rows for Home and End", () => {
    expect(focusRow(entries, EMPTY_SELECTION, 3, false).active).toBe(3)
    const range = focusRow(entries, { ...EMPTY_SELECTION, anchor: 1, active: 1 }, 3, true)
    expect([...range.selected].sort()).toEqual(["/tmp/b", "/tmp/c", "/tmp/d"])
  })
})

describe("selectAll and clearSelection", () => {
  it("selects every entry and clears to the first row", () => {
    const all = selectAll(entries)
    expect(all.selected.size).toBe(4)
    expect(all.active).toBe(3)

    const cleared = clearSelection(entries)
    expect(cleared.selected.size).toBe(0)
    expect(cleared.active).toBe(0)
  })
})

describe("type-ahead", () => {
  it("finds a prefix after the active row and wraps", () => {
    const first = selectRow(entries, EMPTY_SELECTION, 2, "replace")
    const match = selectByPrefix(entries, first, "a")
    expect([...(match?.selected ?? [])]).toEqual(["/tmp/a"])
    expect(match?.active).toBe(0)
  })

  it("returns null when nothing matches", () => {
    expect(selectByPrefix(entries, EMPTY_SELECTION, "zzz")).toBeNull()
  })
})

describe("pruneSelection", () => {
  it("drops paths that disappeared from the listing", () => {
    const selected = selectAll(entries)
    const pruned = pruneSelection(entries.slice(0, 2), selected)
    expect([...pruned.selected].sort()).toEqual(["/tmp/a", "/tmp/b"])
    expect(pruned.active).toBeNull()
  })

  it("keeps the same object when nothing changed", () => {
    const selected = selectAll(entries)
    expect(pruneSelection(entries, selected)).toBe(selected)
  })
})
