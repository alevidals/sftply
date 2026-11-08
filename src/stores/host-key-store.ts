import { create } from "zustand"
import type { HostKeyChallenge } from "@/lib/ipc/bindings"

interface HostKeyState {
  /** The key the server presented, when a connection was blocked. */
  challenge: HostKeyChallenge | null
  /** Connection that should retry once the key is trusted. */
  connectionId: string | null
  request: (connectionId: string, challenge: HostKeyChallenge) => void
  clear: () => void
}

export const useHostKeyStore = create<HostKeyState>((set) => ({
  challenge: null,
  connectionId: null,
  request: (connectionId, challenge) => set({ connectionId, challenge }),
  clear: () => set({ challenge: null, connectionId: null }),
}))
