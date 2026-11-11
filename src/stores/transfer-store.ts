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
  setAll: (items: TransferItem[]) => void
  applyDelta: (event: TransferDeltaEvent) => void
  remove: (ids: string[]) => void
  clear: () => void
}

const UNFINISHED: TransferStatus[] = ["queued", "running"]

/** Server-owned transfer rows mirrored into a store for fast rendering. */
export const useTransferStore = create<TransferState>((set) => ({
  items: {},
  order: [],

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
      for (const upsert of event.upserts) {
        const normalized = normalizeTransferItem(upsert)
        items[normalized.id] = normalized
      }
      for (const id of event.removed) {
        delete items[id]
      }
      return { items, order: sortIds(Object.values(items)) }
    }),

  remove: (ids) =>
    set((state) => {
      const items = { ...state.items }
      for (const id of ids) delete items[id]
      return { items, order: sortIds(Object.values(items)) }
    }),

  clear: () => set({ items: {}, order: [] }),
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
