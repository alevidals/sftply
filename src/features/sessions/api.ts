import type { SessionInfo } from "@/lib/ipc/bindings"
import { ipc } from "@/lib/ipc/client"

/** Session lifecycle API. Credentials stay in the Rust process. */
export const sessionsApi = {
  list(): Promise<SessionInfo[]> {
    return ipc.sessionsList()
  },

  connect(connectionId: string): Promise<SessionInfo> {
    return ipc.sessionConnect(connectionId)
  },

  disconnect(sessionId: string): Promise<void> {
    return ipc.sessionDisconnect(sessionId)
  },
}
