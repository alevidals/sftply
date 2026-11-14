import { act, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import { TransferDragOverlay } from "@/features/transfers/components/transfer-drag-overlay"
import { clearTransferDrag, writeTransferDrag } from "@/features/transfers/model"
import type { FsEntry } from "@/lib/ipc/bindings"

function entry(name: string): FsEntry {
  return {
    name,
    path: `/dir/${name}`,
    kind: "file",
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

function dataTransfer(): DataTransfer {
  const store = new Map<string, string>()
  return {
    effectAllowed: "all",
    dropEffect: "none",
    get types() {
      return [...store.keys()]
    },
    setData: (type: string, value: string) => {
      store.set(type, value)
    },
    getData: (type: string) => store.get(type) ?? "",
  } as unknown as DataTransfer
}

function dragOver(x: number, y: number) {
  act(() => {
    window.dispatchEvent(new MouseEvent("dragover", { clientX: x, clientY: y }))
  })
}

describe("TransferDragOverlay", () => {
  afterEach(clearTransferDrag)

  it("appears with the drag, follows the pointer and counts the entries", () => {
    render(<TransferDragOverlay />)
    expect(screen.queryByTestId("transfer-drag-overlay")).toBeNull()

    act(() => {
      writeTransferDrag(dataTransfer(), {
        scope: { kind: "local" },
        entries: [entry("alpha.txt"), entry("beta.txt"), entry("gamma.txt")],
      })
    })
    // The pointer position is unknown until the first dragover.
    expect(screen.queryByTestId("transfer-drag-overlay")).toBeNull()

    dragOver(100, 50)
    const badge = screen.getByTestId("transfer-drag-overlay")
    expect(badge).toHaveTextContent("3 items")
    expect(badge).toHaveStyle({ left: "114px", top: "64px" })

    dragOver(200, 120)
    expect(screen.getByTestId("transfer-drag-overlay")).toHaveStyle({
      left: "214px",
      top: "134px",
    })
  })

  it("names a single dragged file and disappears when the drag ends", () => {
    render(<TransferDragOverlay />)
    act(() => {
      writeTransferDrag(dataTransfer(), {
        scope: { kind: "remote", sessionId: "s1" },
        entries: [entry("alpha.txt")],
      })
    })
    dragOver(10, 10)
    expect(screen.getByTestId("transfer-drag-overlay")).toHaveTextContent("alpha.txt")

    act(() => clearTransferDrag())
    expect(screen.queryByTestId("transfer-drag-overlay")).toBeNull()
  })
})
