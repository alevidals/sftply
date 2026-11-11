import { beforeEach, describe, expect, it } from "vitest"
import type { TransferItem_Deserialize, TransferItem_Serialize } from "@/lib/ipc/bindings"
import {
  selectActiveTransferCount,
  selectTransferSpeed,
  useTransferStore,
} from "@/stores/transfer-store"

function item(overrides: Partial<TransferItem_Serialize> = {}): TransferItem_Serialize {
  return {
    id: "t1",
    direction: "download",
    status: "running",
    sourcePath: "/remote/a",
    targetPath: "/local/a",
    sourceLabel: "Remote",
    targetLabel: "Local",
    name: "a",
    size: 100,
    transferred: 40,
    bytesPerSec: 10,
    etaMs: 6000,
    error: null,
    startedAt: 1,
    finishedAt: null,
    ...overrides,
  }
}

beforeEach(() => {
  useTransferStore.getState().clear()
})

describe("transfer store", () => {
  it("orders transfers newest first and fills optional fields", () => {
    const withoutOptionals: TransferItem_Deserialize = {
      id: "old",
      direction: "download",
      status: "running",
      sourcePath: "/remote/old",
      targetPath: "/local/old",
      sourceLabel: "Remote",
      targetLabel: "Local",
      name: "old",
      size: 10,
      transferred: 1,
      bytesPerSec: 1,
      startedAt: 1,
    }
    useTransferStore.getState().setAll([withoutOptionals, item({ id: "new", startedAt: 5 })])

    const state = useTransferStore.getState()
    expect(state.order).toEqual(["new", "old"])
    expect(state.items.old?.etaMs).toBeNull()
    expect(state.items.old?.error).toBeNull()
    expect(state.items.old?.finishedAt).toBeNull()
  })

  it("applies upserts and removals from a delta", () => {
    useTransferStore.getState().setAll([item({ id: "a" })])
    useTransferStore.getState().applyDelta({
      upserts: [item({ id: "b", startedAt: 2 }), item({ id: "a", status: "completed" })],
      removed: [],
    })

    expect(useTransferStore.getState().items.a?.status).toBe("completed")
    expect(useTransferStore.getState().order).toEqual(["b", "a"])

    useTransferStore.getState().applyDelta({ upserts: [], removed: ["b"] })
    expect(useTransferStore.getState().order).toEqual(["a"])
  })

  it("counts active transfers and sums only running throughput", () => {
    useTransferStore
      .getState()
      .setAll([
        item({ id: "a", status: "running", bytesPerSec: 100 }),
        item({ id: "b", status: "queued", bytesPerSec: 50 }),
        item({ id: "c", status: "completed", bytesPerSec: 999 }),
      ])

    const state = useTransferStore.getState()
    expect(selectActiveTransferCount(state)).toBe(2)
    expect(selectTransferSpeed(state)).toBe(100)
  })
})
