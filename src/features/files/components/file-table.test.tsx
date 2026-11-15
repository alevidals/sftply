import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"
import { FileTable } from "@/features/files/components/file-table"
import type { SelectionState } from "@/features/files/model/selection"
import { clearTransferDrag, type TransferDragPayload } from "@/features/transfers/model"
import type { FsEntry, FsScope } from "@/lib/ipc/bindings"

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

function renderTable(
  overrides: {
    selection?: SelectionState
    renamingPath?: string | null
    dragScope?: FsScope
    canEdit?: boolean
    onDropPayload?: (payload: TransferDragPayload, directory: FsEntry) => void
  } = {},
) {
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
    onDropPayload: overrides.onDropPayload ?? vi.fn(),
  }
  render(
    <FileTable
      entries={entries}
      selection={overrides.selection ?? selection()}
      columns={{ permissions: true }}
      rowHeight={28}
      renamingPath={overrides.renamingPath ?? null}
      canChmod
      canEdit={overrides.canEdit ?? true}
      allowOpen
      allowReveal
      canTransfer
      transferLabel="Download to local"
      transferDirection="download"
      dragScope={overrides.dragScope ?? { kind: "remote", sessionId: "s1" }}
      {...handlers}
    />,
  )
  return { handlers, grid: screen.getByRole("grid", { name: "Folder contents" }) }
}

describe("FileTable background menu", () => {
  it("offers folder actions on the empty background", async () => {
    const { grid } = renderTable({ selection: selection(null, []) })

    fireEvent.contextMenu(grid)

    expect(await screen.findByRole("menuitem", { name: /New folder/ })).toBeInTheDocument()
    expect(screen.getByRole("menuitem", { name: /Select all/ })).toBeInTheDocument()
    expect(screen.getByRole("menuitem", { name: /Copy folder path/ })).toBeInTheDocument()
    expect(screen.queryByRole("menuitem", { name: /Rename/ })).not.toBeInTheDocument()
  })

  it("clears the selection when the empty background is clicked", () => {
    const { handlers, grid } = renderTable({ selection: selection(0, ["/tmp/alpha.txt"]) })

    fireEvent.mouseDown(screen.getByText("alpha.txt"), { button: 0 })
    expect(handlers.onClearSelection).not.toHaveBeenCalled()

    fireEvent.mouseDown(grid, { button: 0 })
    expect(handlers.onClearSelection).toHaveBeenCalledTimes(1)
  })

  it("selects the row under the cursor when the menu opens", async () => {
    const { handlers } = renderTable({ selection: selection(null, []) })

    fireEvent.contextMenu(screen.getByText("alpha.txt"))

    await waitFor(() => expect(handlers.onSelect).toHaveBeenCalledWith(0, "replace"))
    expect(await screen.findByRole("menuitem", { name: /Rename/ })).toBeInTheDocument()
  })
})

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

function dataTransfer(): DataTransfer {
  const store = new Map<string, string>()
  return {
    effectAllowed: "all",
    dropEffect: "none",
    types: [],
    setData: (type: string, value: string) => {
      store.set(type, value)
    },
    setDragImage: vi.fn(),
    getData: (type: string) => store.get(type) ?? "",
  } as unknown as DataTransfer
}

describe("FileTable context menu", () => {
  it("copies the active path from the row menu", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 })
    const { handlers } = renderTable({ selection: selection(0, ["/tmp/alpha.txt"]) })

    await user.pointer({
      keys: "[MouseRight]",
      target: screen.getByRole("row", { name: /alpha/ }),
    })
    await user.click(await screen.findByRole("menuitem", { name: "Copy path" }))

    expect(handlers.onAction).toHaveBeenCalledWith("copy-path")
  })

  it("allows permissions for a multi-row selection", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 })
    const { handlers } = renderTable({
      selection: selection(1, ["/tmp/alpha.txt", "/tmp/beta"]),
    })

    await user.pointer({
      keys: "[MouseRight]",
      target: screen.getByRole("row", { name: /beta/ }),
    })
    const item = await screen.findByRole("menuitem", { name: /Permissions/ })

    expect(item).not.toHaveAttribute("aria-disabled")
    await user.click(item)
    expect(handlers.onAction).toHaveBeenCalledWith("permissions")
  })

  it("opens the text editor for a regular file", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 })
    const { handlers } = renderTable({ selection: selection(0, ["/tmp/alpha.txt"]) })

    await user.pointer({
      keys: "[MouseRight]",
      target: screen.getByRole("row", { name: /alpha/ }),
    })
    const item = await screen.findByRole("menuitem", { name: /Edit text/ })

    expect(item).not.toHaveAttribute("aria-disabled")
    await user.click(item)
    expect(handlers.onAction).toHaveBeenCalledWith("edit")
  })

  it("disables the text editor for folders and when unsupported", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 })
    renderTable({ selection: selection(1, ["/tmp/beta"]) })

    await user.pointer({
      keys: "[MouseRight]",
      target: screen.getByRole("row", { name: /beta/ }),
    })
    expect(await screen.findByRole("menuitem", { name: /Edit text/ })).toHaveAttribute(
      "aria-disabled",
      "true",
    )
  })

  it("disables the text editor when the pane cannot read text", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 })
    renderTable({ selection: selection(0, ["/tmp/alpha.txt"]), canEdit: false })

    await user.pointer({
      keys: "[MouseRight]",
      target: screen.getByRole("row", { name: /alpha/ }),
    })
    expect(await screen.findByRole("menuitem", { name: /Edit text/ })).toHaveAttribute(
      "aria-disabled",
      "true",
    )
  })
})

describe("FileTable drag and drop", () => {
  afterEach(clearTransferDrag)

  it("drags the selection and drops it on a folder row", () => {
    const onDropPayload = vi.fn()
    const transfer = dataTransfer()
    renderTable({ selection: selection(0, ["/tmp/alpha.txt"]), onDropPayload })

    fireEvent.dragStart(screen.getByTitle("/tmp/alpha.txt"), { dataTransfer: transfer })
    expect(transfer.getData("application/x-sftply-entries")).toContain("alpha.txt")

    fireEvent.drop(screen.getByTitle("/tmp/beta"), { dataTransfer: transfer })

    expect(onDropPayload).toHaveBeenCalledTimes(1)
    const [payload, directory] = onDropPayload.mock.calls[0] as [TransferDragPayload, FsEntry]
    expect(payload.entries.map((entry) => entry.name)).toEqual(["alpha.txt"])
    expect(directory.name).toBe("beta")
  })

  it("replaces the browser drag image with the app's own badge", () => {
    const transfer = dataTransfer()
    renderTable({ selection: selection(0, ["/tmp/alpha.txt"]) })

    fireEvent.dragStart(screen.getByTitle("/tmp/alpha.txt"), { dataTransfer: transfer })

    expect(transfer.setDragImage).toHaveBeenCalledTimes(1)
  })

  it("keeps a multi-selection when pressing a selected row and drags all of it", () => {
    const transfer = dataTransfer()
    const { handlers } = renderTable({
      selection: selection(0, ["/tmp/alpha.txt", "/tmp/beta"]),
    })
    const alpha = screen.getByTitle("/tmp/alpha.txt")

    fireEvent.mouseDown(alpha)
    expect(handlers.onSelect).toHaveBeenCalledWith(0, "focus")

    fireEvent.dragStart(alpha, { dataTransfer: transfer })
    const payload = JSON.parse(
      transfer.getData("application/x-sftply-entries"),
    ) as TransferDragPayload
    expect(payload.entries.map((entry) => entry.name)).toEqual(["alpha.txt", "beta"])
  })

  it("collapses a multi-selection on a plain click without dragging", () => {
    const { handlers } = renderTable({
      selection: selection(0, ["/tmp/alpha.txt", "/tmp/beta"]),
    })
    const alpha = screen.getByTitle("/tmp/alpha.txt")

    fireEvent.mouseDown(alpha)
    fireEvent.click(alpha)

    expect(handlers.onSelect).toHaveBeenLastCalledWith(0, "replace")
  })

  it("does not offer a folder as a drop target for a same-pane drag", () => {
    const transfer = dataTransfer()
    renderTable({ selection: selection(0, ["/tmp/alpha.txt"]) })

    fireEvent.dragStart(screen.getByTitle("/tmp/alpha.txt"), { dataTransfer: transfer })
    const folder = screen.getByTitle("/tmp/beta")
    fireEvent.dragOver(folder, { dataTransfer: transfer })

    expect(folder.className).not.toContain("bg-primary/10")
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
