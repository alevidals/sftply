import { create } from "zustand"
import type { HostKeyChallenge } from "@/lib/ipc/bindings"

interface HostKeyState {
  /** The key the server presented, when a connection was blocked. */
  challenge: HostKeyChallenge | null
  /** Saved connection that should retry once the key is trusted. */
  connectionId: string | null
  /**
   * One-shot retry used by transient connections (Quick Connect), which have
   * no saved profile id to reconnect. The closure is cleared on trust/cancel.
   */
  retry: (() => Promise<void>) | null
  request: (
    connectionId: string | null,
    challenge: HostKeyChallenge,
    retry?: () => Promise<void>,
  ) => void
  clear: () => void
}

export const useHostKeyStore = create<HostKeyState>((set) => ({
  challenge: null,
  connectionId: null,
  retry: null,
  request: (connectionId, challenge, retry) =>
    set({ connectionId, challenge, retry: retry ?? null }),
  clear: () => set({ challenge: null, connectionId: null, retry: null }),
}))
