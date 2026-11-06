import { create } from "zustand"
import type { ActivityEntry, ActivityLevel } from "@/lib/ipc/bindings"

const MAX_ENTRIES = 500

interface ActivityState {
  entries: ActivityEntry[]
  add: (entry: ActivityEntry) => void
  clear: () => void
}

export const useActivityStore = create<ActivityState>((set) => ({
  entries: [],
  add: (entry) =>
    set((state) => {
      if (state.entries.some((existing) => existing.id === entry.id)) return state
      return { entries: [entry, ...state.entries].slice(0, MAX_ENTRIES) }
    }),
  clear: () => set({ entries: [] }),
}))

/** Record a client-side event alongside backend activity. */
export function recordActivity(
  level: ActivityLevel,
  message: string,
  timestamp = Date.now(),
): void {
  useActivityStore.getState().add({
    id: randomId(),
    level,
    message,
    timestamp,
  })
}

function randomId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID()
  }
  return `local-${Date.now()}-${Math.random().toString(16).slice(2)}`
}
