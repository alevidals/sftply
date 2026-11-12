import type {
  ConflictPolicy,
  FsScope,
  TransferConflict,
  TransferHistoryEntry_Serialize,
  TransferItem,
  TransferItem_Serialize,
  TransferPlan_Serialize,
  TransferPlanEntry_Deserialize,
} from "@/lib/ipc/bindings"
import { ipc } from "@/lib/ipc/client"

export const TRANSFER_HISTORY_QUERY_KEY = ["transfer-history"] as const

/** Transfer commands. Components never call `ipc` directly. */
export const transfersApi = {
  list(): Promise<TransferItem[]> {
    return ipc.transfersList()
  },

  plan(
    source: FsScope,
    sourcePaths: string[],
    target: FsScope,
    targetPath: string,
  ): Promise<TransferPlan_Serialize> {
    return ipc.transferPlan(source, sourcePaths, target, targetPath)
  },

  preflight(target: FsScope, targetPath: string): Promise<TransferConflict | null> {
    return ipc.transferPreflight(target, targetPath)
  },

  enqueue(
    source: FsScope,
    sourcePath: string,
    target: FsScope,
    targetPath: string,
    policy: ConflictPolicy,
  ): Promise<TransferItem> {
    return ipc.transferEnqueue(source, sourcePath, target, targetPath, policy)
  },

  enqueueTree(
    source: FsScope,
    target: FsScope,
    policy: ConflictPolicy,
    entries: TransferPlanEntry_Deserialize[],
    skipTargets: string[],
  ): Promise<TransferItem_Serialize[]> {
    return ipc.transferEnqueueTree(source, target, policy, entries, skipTargets)
  },

  cancel(id: string): Promise<boolean> {
    return ipc.transferCancel(id)
  },

  retry(id: string): Promise<TransferItem_Serialize> {
    return ipc.transferRetry(id)
  },

  clearFinished(): Promise<number> {
    return ipc.transferClearFinished()
  },

  pauseQueue(): Promise<boolean> {
    return ipc.transferPauseQueue()
  },

  resumeQueue(): Promise<boolean> {
    return ipc.transferResumeQueue()
  },

  queuePaused(): Promise<boolean> {
    return ipc.transferQueuePaused()
  },

  history(): Promise<TransferHistoryEntry_Serialize[]> {
    return ipc.transferHistory()
  },

  clearHistory(): Promise<number> {
    return ipc.transferClearHistory()
  },
}
