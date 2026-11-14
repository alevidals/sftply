import { useEffect } from "react"
import { useConnections } from "@/features/connections/hooks/use-connections"
import { useSessionStore } from "@/stores/session-store"

/**
 * Keep open session labels in sync with the saved connection. The backend
 * snapshots the name when the session opens, so renaming a connection would
 * otherwise leave the tab, status bar and toasts with the old label.
 */
export function useSessionNames(): void {
  const { data: connections } = useConnections()

  useEffect(() => {
    if (!connections) return
    useSessionStore.getState().syncConnectionNames(connections)
  }, [connections])
}
