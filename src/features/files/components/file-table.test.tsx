import { fireEvent, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import { FileTable } from "@/features/files/components/file-table"
import type { SelectionState } from "@/features/files/model/selection"
import type { FsEntry } from "@/lib/ipc/bindings"

vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: ({ count, estimateSize }: { count: number; estimateSize: () => number }) => ({
    getTotalSize: () => count * estimateSize(),
    getVirtualItems: () =>
      Array.from({ length: count }, (_, index) => ({
        index,
        key: index,
        start: index * estimateSize(),
        size: estimateSize(),
      })),
    measure: vi.fn(),
    scrollToIndex: vi.fn(),
  }),
}))

const entries: FsEntry[] = [
  {
    name: "alpha.txt",
    path: "/tmp/alpha.txt",
    kind: "file",
    size: 128,
    modifiedAt: 0,
    permissions: 0o644,
    owner: null,
    group: null,
    linkTarget: null,
    hidden: false,
    metadataComplete: true,
  },
  {
    name: "beta",
    path: "/tmp/beta",
    kind: "directory",
    size: 0,
    modifiedAt: 0,
    permissions: 0o755,
    owner: null,
    group: null,
    linkTarget: null,
    hidden: false,
    metadataComplete: true,
  },
]

function selection(active: number | null = 0, selected: string[] = []): SelectionState {
  return { active, anchor: active, selected: new Set(selected) }
}

function renderTable(overrides: { selection?: SelectionState; renamingPath?: string | null } = {}) {
  const handlers = {
    onSelect: vi.fn(),
    onSelectAll: vi.fn(),
    onClearSelection: vi.fn(),
    onMove: vi.fn(),
    onFocusRow: vi.fn(),
    onTypeAhead: vi.fn(),
    onAction: vi.fn(),
    onUp: vi.fn(),
    onRenameSubmit: vi.fn(),
    onRenameCancel: vi.fn(),
  }
  render(
    <FileTable
      entries={entries}
      selection={overrides.selection ?? selection()}
      columns={{ permissions: true }}
      rowHeight={28}
      renamingPath={overrides.renamingPath ?? null}
      canChmod
      allowOpen
      allowReveal
      {...handlers}
    />,
  )
  return { handlers, grid: screen.getByRole("grid", { name: "Folder contents" }) }
}

describe("FileTable keyboard model", () => {
  it("moves the active row and extends selection with shift", () => {
    const { handlers, grid } = renderTable()

    fireEvent.keyDown(grid, { key: "ArrowDown" })
    expect(handlers.onMove).toHaveBeenLastCalledWith(1, false)

    fireEvent.keyDown(grid, { key: "ArrowUp", shiftKey: true })
    expect(handlers.onMove).toHaveBeenLastCalledWith(-1, true)

    fireEvent.keyDown(grid, { key: "Home" })
    expect(handlers.onFocusRow).toHaveBeenLastCalledWith(0, false)

    fireEvent.keyDown(grid, { key: "End", shiftKey: true })
    expect(handlers.onFocusRow).toHaveBeenLastCalledWith(1, true)
  })

  it("maps command and navigation shortcuts", () => {
    const { handlers, grid } = renderTable()

    fireEvent.keyDown(grid, { key: "a", metaKey: true })
    expect(handlers.onSelectAll).toHaveBeenCalledTimes(1)

    fireEvent.keyDown(grid, { key: "Backspace", metaKey: true })
    expect(handlers.onAction).toHaveBeenLastCalledWith("delete")

    fireEvent.keyDown(grid, { key: "ArrowUp", metaKey: true })
    expect(handlers.onUp).toHaveBeenCalledTimes(1)

    fireEvent.keyDown(grid, { key: "Backspace" })
    expect(handlers.onUp).toHaveBeenCalledTimes(2)

    fireEvent.keyDown(grid, { key: "Enter" })
    expect(handlers.onAction).toHaveBeenLastCalledWith("open")

    fireEvent.keyDown(grid, { key: "F2" })
    expect(handlers.onAction).toHaveBeenLastCalledWith("rename")

    fireEvent.keyDown(grid, { key: "Delete" })
    expect(handlers.onAction).toHaveBeenLastCalledWith("delete")

    fireEvent.keyDown(grid, { key: "Escape" })
    expect(handlers.onClearSelection).toHaveBeenCalledTimes(1)
  })

  it("toggles the active row with space and collects type-ahead", () => {
    const { handlers, grid } = renderTable()

    fireEvent.keyDown(grid, { key: " " })
    expect(handlers.onSelect).toHaveBeenCalledWith(0, "toggle")

    fireEvent.keyDown(grid, { key: "b" })
    fireEvent.keyDown(grid, { key: "e" })
    expect(handlers.onTypeAhead).toHaveBeenLastCalledWith("be")
  })

  it("selects a row on click and opens it on double click", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 })
    const { handlers } = renderTable()

    const row = screen.getByRole("row", { name: /beta/ })
    await user.click(row)
    expect(handlers.onSelect).toHaveBeenCalledWith(1, "replace")

    await user.dblClick(row)
    expect(handlers.onAction).toHaveBeenCalledWith("open")
  })
})

describe("FileTable inline rename", () => {
  it("submits a changed name", () => {
    const { handlers } = renderTable({ renamingPath: entries[0]?.path ?? null })

    const input = screen.getByRole("textbox", { name: "New name" })
    fireEvent.change(input, { target: { value: "renamed.txt" } })
    fireEvent.keyDown(input, { key: "Enter" })

    expect(handlers.onRenameSubmit).toHaveBeenCalledWith(entries[0], "renamed.txt")
  })

  it("cancels when the name is unchanged or Escape is pressed", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 })
    const { handlers, grid } = renderTable({ renamingPath: entries[0]?.path ?? null })

    const input = screen.getByRole("textbox", { name: "New name" })
    await user.type(input, "{Enter}")
    expect(handlers.onRenameCancel).toHaveBeenCalledTimes(1)

    fireEvent.keyDown(grid, { key: "Escape" })
    expect(handlers.onClearSelection).toHaveBeenCalled()
  })

  it("rejects an invalid name without submitting", async () => {
    const { handlers } = renderTable({ renamingPath: entries[0]?.path ?? null })

    const input = screen.getByRole("textbox", { name: "New name" })
    fireEvent.change(input, { target: { value: "bad/name" } })
    fireEvent.keyDown(input, { key: "Enter" })

    expect(await screen.findByText(/cannot contain/i)).toBeInTheDocument()
    expect(handlers.onRenameSubmit).not.toHaveBeenCalled()
  })
})
