import { useEffect } from "react"
import { onActivityEntry } from "@/lib/ipc/events"
import { recordActivity, useActivityStore } from "@/stores/activity-store"

/** Bridge backend `activity://entry` events into the activity store. */
export function useActivityBridge(): void {
  useEffect(() => {
    let disposed = false
    let unlisten: (() => void) | undefined

    onActivityEntry((entry) => {
      useActivityStore.getState().add(entry)
    })
      .then((stop) => {
        if (disposed) stop()
        else unlisten = stop
      })
      .catch(() => {
        recordActivity("warning", "Could not subscribe to backend activity events.")
      })

    return () => {
      disposed = true
      unlisten?.()
    }
  }, [])
}
