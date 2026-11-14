import { useQueryClient } from "@tanstack/react-query"
import { useEffect } from "react"
import { TRANSFER_HISTORY_QUERY_KEY, transfersApi } from "@/features/transfers/api"
import type { TransferDeltaEvent, TransferStatus } from "@/lib/ipc/bindings"
import { onTransferDelta } from "@/lib/ipc/events"
import { recordActivity } from "@/stores/activity-store"
import { useTransferStore } from "@/stores/transfer-store"

const TERMINAL_STATUSES: readonly TransferStatus[] = ["completed", "failed", "cancelled"]

/** Batch window for progress deltas. Eight concurrent transfers emit up to ~80
 * events per second; applying each one re-renders the queue and the status bar,
 * so they are merged into one store update per window. */
const DELTA_FLUSH_MS = 100

/** Bridge backend `transfer://delta` events into the transfer store. */
export function useTransferBridge(): void {
  const queryClient = useQueryClient()

  useEffect(() => {
    let disposed = false
    let unlisten: (() => void) | undefined
    let refreshTimer: ReturnType<typeof setTimeout> | null = null
    let flushTimer: ReturnType<typeof setTimeout> | null = null
    let pendingUpserts = new Map<string, TransferDeltaEvent["upserts"][number]>()
    let pendingRemoved = new Set<string>()

    const flushDeltas = () => {
      flushTimer = null
      if (disposed || (pendingUpserts.size === 0 && pendingRemoved.size === 0)) return
      const upserts = [...pendingUpserts.values()]
      const removed = [...pendingRemoved]
      pendingUpserts = new Map()
      pendingRemoved = new Set()
      useTransferStore.getState().applyDelta({ upserts, removed })
    }

    // A completed transfer changes the destination folder on disk and appends a
    // history entry. Coalesce terminal events from a whole batch into one
    // refresh instead of refetching once per file.
    const scheduleListingRefresh = () => {
      if (refreshTimer) return
      refreshTimer = setTimeout(() => {
        refreshTimer = null
        if (disposed) return
        void queryClient.invalidateQueries({ queryKey: ["fs"] })
        void queryClient.invalidateQueries({ queryKey: TRANSFER_HISTORY_QUERY_KEY })
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
      for (const upsert of event.upserts) {
        pendingUpserts.set(upsert.id, upsert)
        pendingRemoved.delete(upsert.id)
      }
      for (const id of event.removed) {
        pendingUpserts.delete(id)
        pendingRemoved.add(id)
      }
      if (event.upserts.some((item) => TERMINAL_STATUSES.includes(item.status))) {
        scheduleListingRefresh()
      }
      if (!flushTimer) flushTimer = setTimeout(flushDeltas, DELTA_FLUSH_MS)
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
      if (flushTimer) clearTimeout(flushTimer)
      unlisten?.()
    }
  }, [queryClient])
}
