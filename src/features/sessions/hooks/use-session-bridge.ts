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
        if (event.sessionId) store.clearLost(event.sessionId)
        sessionsApi
          .list()
          .then((sessions) => {
            if (!disposed) useSessionStore.getState().setSessions(sessions)
          })
          .catch(() => undefined)
        return
      }
      if (event.state === "failed") {
        // A failed connect attempt has no tab yet; the action that started it
        // already reports the error. An established session keeps its tab so
        // the user can reconnect without losing their place.
        if (event.sessionId && store.sessions[event.sessionId]) {
          store.setLost(
            event.sessionId,
            event.message ?? "The connection was lost. Reconnect to continue.",
          )
          if (event.message) recordActivity("error", event.message)
        }
        return
      }
      if (event.state === "disconnected") {
        if (event.sessionId) store.removeSession(event.sessionId)
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
