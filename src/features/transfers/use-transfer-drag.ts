import { useSyncExternalStore } from "react"
import { getTransferDrag, subscribeTransferDrag } from "@/features/transfers/model"

/** The in-app transfer drag in progress, or null when nothing is dragged. */
export function useTransferDrag() {
  return useSyncExternalStore(subscribeTransferDrag, getTransferDrag, getTransferDrag)
}
