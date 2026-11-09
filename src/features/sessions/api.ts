import type { ConnectionInput_Deserialize, SessionInfo } from "@/lib/ipc/bindings"
import { ipc } from "@/lib/ipc/client"

/** Session lifecycle API. Credentials stay in the Rust process. */
export const sessionsApi = {
  list(): Promise<SessionInfo[]> {
    return ipc.sessionsList()
  },

  connect(connectionId: string): Promise<SessionInfo> {
    return ipc.sessionConnect(connectionId)
  },

  quickConnect(
    input: ConnectionInput_Deserialize,
    secret: string,
    save: boolean,
  ): Promise<SessionInfo> {
    return ipc.sessionConnectQuick(input, secret, save)
  },

  disconnect(sessionId: string): Promise<void> {
    return ipc.sessionDisconnect(sessionId)
  },

  reconnect(sessionId: string): Promise<SessionInfo> {
    return ipc.sessionReconnect(sessionId)
  },

  cancel(sessionId: string): Promise<boolean> {
    return ipc.sessionCancel(sessionId)
  },
}
