import { useEffect } from "react"
import { sessionsApi } from "@/features/sessions/api"
import { onSessionState } from "@/lib/ipc/events"
import { recordActivity } from "@/stores/activity-store"
import { useSessionStore } from "@/stores/session-store"

/**
 * Keep the session store in sync with backend lifecycle events. The connect
 * command returns full metadata; events cover disconnects, failures and
 * sessions that end outside the current UI action.
 */
export function useSessionBridge(): void {
  useEffect(() => {
    let disposed = false
    let unlisten: (() => void) | undefined

    sessionsApi
      .list()
      .then((sessions) => {
        if (!disposed) useSessionStore.getState().setSessions(sessions)
      })
      .catch(() => {
        recordActivity("warning", "Could not read the active sessions.")
      })

    onSessionState((event) => {
      const store = useSessionStore.getState()
      if (event.state === "connected") {
        sessionsApi
          .list()
          .then((sessions) => {
            if (!disposed) useSessionStore.getState().setSessions(sessions)
          })
          .catch(() => undefined)
        return
      }
      if (event.state === "disconnected" || event.state === "failed") {
        if (event.sessionId) store.removeSession(event.sessionId)
        if (event.state === "failed" && event.message) {
          recordActivity("error", event.message)
        }
      }
    })
      .then((stop) => {
        if (disposed) stop()
        else unlisten = stop
      })
      .catch(() => {
        recordActivity("warning", "Could not subscribe to session events.")
      })

    return () => {
      disposed = true
      unlisten?.()
    }
  }, [])
}
