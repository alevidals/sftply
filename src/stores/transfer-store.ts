import { create } from "zustand"
import type {
  TransferDeltaEvent,
  TransferItem,
  TransferItem_Serialize,
  TransferStatus,
} from "@/lib/ipc/bindings"
import { normalizeTransferItem } from "@/lib/ipc/events"

interface TransferState {
  items: Record<string, TransferItem_Serialize>
  /** Transfer ids, newest first. */
  order: string[]
  /** True while the backend queue refuses to start new transfers. */
  paused: boolean
  setAll: (items: TransferItem[]) => void
  applyDelta: (event: TransferDeltaEvent) => void
  remove: (ids: string[]) => void
  setPaused: (paused: boolean) => void
  clear: () => void
}

const UNFINISHED: TransferStatus[] = ["queued", "running"]

/** Server-owned transfer rows mirrored into a store for fast rendering. */
export const useTransferStore = create<TransferState>((set) => ({
  items: {},
  order: [],
  paused: false,

  setAll: (items) =>
    set(() => {
      const normalized = items.map(normalizeTransferItem)
      return {
        items: Object.fromEntries(normalized.map((item) => [item.id, item])),
        order: sortIds(normalized),
      }
    }),

  applyDelta: (event) =>
    set((state) => {
      const items = { ...state.items }
      const added: string[] = []
      for (const upsert of event.upserts) {
        const normalized = normalizeTransferItem(upsert)
        if (!items[normalized.id]) added.push(normalized.id)
        items[normalized.id] = normalized
      }
      const removed = new Set(event.removed)
      for (const id of removed) delete items[id]

      // Progress deltas never change `startedAt`, so the order only needs to
      // change when rows appear or disappear. Re-sorting every delta made the
      // queue quadratic with thousands of files.
      if (added.length === 0 && removed.size === 0) return { items }

      added.sort((left, right) => (items[right]?.startedAt ?? 0) - (items[left]?.startedAt ?? 0))
      const kept = state.order.filter((id) => !removed.has(id) && !added.includes(id))
      return { items, order: [...added, ...kept] }
    }),

  remove: (ids) =>
    set((state) => {
      const items = { ...state.items }
      for (const id of ids) delete items[id]
      return { items, order: sortIds(Object.values(items)) }
    }),

  setPaused: (paused) => set({ paused }),

  clear: () => set({ items: {}, order: [], paused: false }),
}))

function sortIds(items: TransferItem_Serialize[]): string[] {
  return [...items].sort((left, right) => right.startedAt - left.startedAt).map((item) => item.id)
}

/** Number of transfers that are queued or running. */
export function selectActiveTransferCount(state: TransferState): number {
  return state.order.filter((id) => {
    const item = state.items[id]
    return item ? UNFINISHED.includes(item.status) : false
  }).length
}

/** Combined throughput of running transfers, in bytes per second. */
export function selectTransferSpeed(state: TransferState): number {
  return state.order.reduce((total, id) => {
    const item = state.items[id]
    return item?.status === "running" ? total + item.bytesPerSec : total
  }, 0)
}
