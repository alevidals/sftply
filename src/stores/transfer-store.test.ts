import { beforeEach, describe, expect, it } from "vitest"
import type { TransferItem_Serialize, TransferStatus } from "@/lib/ipc/bindings"
import { useTransferStore } from "@/stores/transfer-store"

function item(
  id: string,
  startedAt: number,
  status: TransferStatus = "queued",
): TransferItem_Serialize {
  return {
    id,
    direction: "upload",
    status,
    sourcePath: `/local/${id}`,
    targetPath: `/remote/${id}`,
    sourceLabel: "Local",
    targetLabel: "Remote",
    name: id,
    size: 10,
    transferred: 0,
    bytesPerSec: 0,
    etaMs: null,
    error: null,
    startedAt,
    finishedAt: null,
  }
}

describe("transfer store", () => {
  beforeEach(() => {
    useTransferStore.getState().clear()
  })

  it("sorts a fresh snapshot newest first", () => {
    useTransferStore.getState().setAll([item("a", 1), item("c", 3), item("b", 2)])
    expect(useTransferStore.getState().order).toEqual(["c", "b", "a"])
  })

  it("does not reorder on progress updates", () => {
    useTransferStore.getState().setAll([item("a", 1), item("b", 2)])
    const order = useTransferStore.getState().order

    useTransferStore.getState().applyDelta({
      upserts: [{ ...item("a", 1, "running"), transferred: 5 }],
      removed: [],
    })

    expect(useTransferStore.getState().order).toBe(order)
    expect(useTransferStore.getState().items.a?.transferred).toBe(5)
  })

  it("prepends new rows and drops removed ones", () => {
    useTransferStore.getState().setAll([item("a", 1), item("b", 2)])

    useTransferStore.getState().applyDelta({
      upserts: [item("c", 3)],
      removed: ["a"],
    })

    expect(useTransferStore.getState().order).toEqual(["c", "b"])
    expect(useTransferStore.getState().items.a).toBeUndefined()
  })

  it("keeps a single entry when a row is upserted twice in one batch", () => {
    useTransferStore.getState().applyDelta({
      upserts: [item("a", 1), { ...item("a", 1), transferred: 9 }],
      removed: [],
    })

    expect(useTransferStore.getState().order).toEqual(["a"])
    expect(useTransferStore.getState().items.a?.transferred).toBe(9)
  })
})
