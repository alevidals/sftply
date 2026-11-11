import { useQueryClient } from "@tanstack/react-query"
import { useEffect } from "react"
import { transfersApi } from "@/features/transfers/api"
import type { TransferStatus } from "@/lib/ipc/bindings"
import { onTransferDelta } from "@/lib/ipc/events"
import { recordActivity } from "@/stores/activity-store"
import { useTransferStore } from "@/stores/transfer-store"

const TERMINAL_STATUSES: readonly TransferStatus[] = ["completed", "failed", "cancelled"]

/** Bridge backend `transfer://delta` events into the transfer store. */
export function useTransferBridge(): void {
  const queryClient = useQueryClient()

  useEffect(() => {
    let disposed = false
    let unlisten: (() => void) | undefined
    let refreshTimer: ReturnType<typeof setTimeout> | null = null

    // A completed transfer changes the destination folder on disk. Coalesce
    // terminal events from a whole batch into one listing refresh instead of
    // refetching once per file.
    const scheduleListingRefresh = () => {
      if (refreshTimer) return
      refreshTimer = setTimeout(() => {
        refreshTimer = null
        if (!disposed) void queryClient.invalidateQueries({ queryKey: ["fs"] })
      }, 250)
    }

    transfersApi
      .list()
      .then((items) => {
        if (!disposed) useTransferStore.getState().setAll(items)
      })
      .catch(() => {
        recordActivity("warning", "Could not read the transfer queue.")
      })

    transfersApi
      .queuePaused()
      .then((paused) => {
        if (!disposed) useTransferStore.getState().setPaused(paused)
      })
      .catch(() => {
        recordActivity("warning", "Could not read the transfer queue state.")
      })

    onTransferDelta((event) => {
      useTransferStore.getState().applyDelta(event)
      if (event.upserts.some((item) => TERMINAL_STATUSES.includes(item.status))) {
        scheduleListingRefresh()
      }
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
      if (refreshTimer) clearTimeout(refreshTimer)
      unlisten?.()
    }
  }, [queryClient])
}
