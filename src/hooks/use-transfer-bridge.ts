import { useEffect } from "react"
import { transfersApi } from "@/features/transfers/api"
import { onTransferDelta } from "@/lib/ipc/events"
import { recordActivity } from "@/stores/activity-store"
import { useTransferStore } from "@/stores/transfer-store"

/** Bridge backend `transfer://delta` events into the transfer store. */
export function useTransferBridge(): void {
  useEffect(() => {
    let disposed = false
    let unlisten: (() => void) | undefined

    transfersApi
      .list()
      .then((items) => {
        if (!disposed) useTransferStore.getState().setAll(items)
      })
      .catch(() => {
        recordActivity("warning", "Could not read the transfer queue.")
      })

    onTransferDelta((event) => {
      useTransferStore.getState().applyDelta(event)
    })
      .then((stop) => {
        if (disposed) stop()
        else unlisten = stop
      })
      .catch(() => {
        recordActivity("warning", "Could not subscribe to transfer progress.")
      })

    return () => {
      disposed = true
      unlisten?.()
    }
  }, [])
}
