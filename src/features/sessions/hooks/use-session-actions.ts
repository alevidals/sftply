import { useCallback } from "react"
import { toast } from "sonner"
import { sessionsApi } from "@/features/sessions/api"
import { normalizeError } from "@/lib/errors"
import { recordActivity } from "@/stores/activity-store"
import { useHostKeyStore } from "@/stores/host-key-store"
import { useSessionStore } from "@/stores/session-store"
import { useUiStore } from "@/stores/ui-store"

/** Connect/disconnect orchestration shared by the sidebar, tabs and dialogs. */
export function useSessionActions() {
  const requestHostKey = useHostKeyStore((state) => state.request)

  const connect = useCallback(
    async (connectionId: string) => {
      const store = useSessionStore.getState()
      if (store.connecting[connectionId]) return

      store.setConnecting(connectionId, true)
      try {
        const session = await sessionsApi.connect(connectionId)
        const current = useSessionStore.getState()
        current.upsertSession(session)
        current.setActiveSession(session.id)
        useUiStore.getState().setActivePane("remote")
        recordActivity("success", `Connected to “${session.name}” (${session.host})`)
        toast.success(`Connected to ${session.name}`, {
          description: `${session.host}:${session.port}`,
        })
      } catch (cause) {
        const error = normalizeError(cause)
        if (error.hostKey) {
          requestHostKey(connectionId, error.hostKey)
          recordActivity("warning", `Host key verification required for ${error.hostKey.host}`)
          return
        }
        recordActivity("error", `Could not connect: ${error.message}`)
        toast.error("Could not connect", { description: error.message })
      } finally {
        useSessionStore.getState().setConnecting(connectionId, false)
      }
    },
    [requestHostKey],
  )

  const disconnect = useCallback(async (sessionId: string) => {
    const session = useSessionStore.getState().sessions[sessionId]
    try {
      await sessionsApi.disconnect(sessionId)
    } catch (cause) {
      const error = normalizeError(cause)
      toast.error("Could not disconnect cleanly", { description: error.message })
    } finally {
      useSessionStore.getState().removeSession(sessionId)
      if (session) recordActivity("info", `Disconnected from “${session.name}”`)
    }
  }, [])

  return { connect, disconnect }
}
