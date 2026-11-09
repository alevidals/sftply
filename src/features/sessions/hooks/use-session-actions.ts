import { useQueryClient } from "@tanstack/react-query"
import { useCallback } from "react"
import { toast } from "sonner"
import { connectionsQueryKey } from "@/features/connections/hooks/use-connections"
import { remoteScope, scopeKey } from "@/features/files/api"
import { sessionsApi } from "@/features/sessions/api"
import { normalizeError } from "@/lib/errors"
import type { ConnectionInput_Deserialize, SessionInfo } from "@/lib/ipc/bindings"
import { recordActivity } from "@/stores/activity-store"
import { useHostKeyStore } from "@/stores/host-key-store"
import { useSessionStore } from "@/stores/session-store"
import { useUiStore } from "@/stores/ui-store"

/** Connect/disconnect orchestration shared by the sidebar, tabs and dialogs. */
export function useSessionActions() {
  const queryClient = useQueryClient()
  const requestHostKey = useHostKeyStore((state) => state.request)

  const applySession = useCallback((session: SessionInfo) => {
    const current = useSessionStore.getState()
    current.upsertSession(session)
    current.setActiveSession(session.id)
    useUiStore.getState().setActivePane("remote")
    recordActivity("success", `Connected to “${session.name}” (${session.host})`)
    toast.success(`Connected to ${session.name}`, {
      description: `${session.host}:${session.port}`,
    })
  }, [])

  const runQuickConnect = useCallback(
    async (input: ConnectionInput_Deserialize, secret: string, save: boolean) => {
      const session = await sessionsApi.quickConnect(input, secret, save)
      applySession(session)
      if (save) {
        await queryClient.invalidateQueries({ queryKey: connectionsQueryKey })
      }
      return session
    },
    [applySession, queryClient],
  )

  /**
   * Connect with transient credentials. Host-key challenges keep the secret in
   * a one-shot retry closure; cancelling the dialog drops it.
   */
  const quickConnect = useCallback(
    async (
      input: ConnectionInput_Deserialize,
      secret: string,
      save: boolean,
    ): Promise<SessionInfo | null> => {
      const attempt = async (): Promise<SessionInfo | null> => {
        try {
          return await runQuickConnect(input, secret, save)
        } catch (cause) {
          const error = normalizeError(cause)
          if (error.hostKey) {
            // Re-challenges after a retry keep the same closure alive.
            requestHostKey(null, error.hostKey, async () => {
              await attempt()
            })
            recordActivity("warning", `Host key verification required for ${error.hostKey.host}`)
            return null
          }
          throw error
        }
      }
      return attempt()
    },
    [requestHostKey, runQuickConnect],
  )

  const connect = useCallback(
    async (connectionId: string) => {
      const store = useSessionStore.getState()
      if (store.connecting[connectionId]) return

      store.setConnecting(connectionId, true)
      try {
        const session = await sessionsApi.connect(connectionId)
        applySession(session)
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
    [applySession, requestHostKey],
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

  /**
   * Reconnect a session in place. The same session id is kept so tabs and
   * browser state survive; remote query caches are dropped so the new
   * connection never shows stale listings.
   */
  const reconnect = useCallback(
    async (sessionId: string) => {
      const attempt = async (): Promise<void> => {
        const store = useSessionStore.getState()
        if (store.reconnecting[sessionId]) return
        store.setReconnecting(sessionId, true)
        try {
          const session = await sessionsApi.reconnect(sessionId)
          const current = useSessionStore.getState()
          current.upsertSession(session)
          current.clearLost(sessionId)
          current.setActiveSession(session.id)
          useUiStore.getState().setActivePane("remote")
          await queryClient.removeQueries({
            queryKey: ["fs", scopeKey(remoteScope(sessionId))],
          })
          recordActivity("success", `Reconnected to “${session.name}”`)
          toast.success(`Reconnected to ${session.name}`)
        } catch (cause) {
          const error = normalizeError(cause)
          if (error.hostKey) {
            requestHostKey(null, error.hostKey, attempt)
            recordActivity("warning", `Host key verification required for ${error.hostKey.host}`)
            return
          }
          useSessionStore.getState().setLost(sessionId, error.message)
          toast.error("Could not reconnect", { description: error.message })
        } finally {
          useSessionStore.getState().setReconnecting(sessionId, false)
        }
      }
      await attempt()
    },
    [queryClient, requestHostKey],
  )

  /** Ask the backend to abort the operation currently using the session. */
  const cancel = useCallback(async (sessionId: string) => {
    try {
      const cancelled = await sessionsApi.cancel(sessionId)
      if (cancelled) recordActivity("info", "Cancelled the remote operation")
    } catch (cause) {
      const error = normalizeError(cause)
      toast.error("Could not cancel the operation", { description: error.message })
    }
  }, [])

  return { connect, quickConnect, disconnect, reconnect, cancel }
}
