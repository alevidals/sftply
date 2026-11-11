import type { ConflictPolicy, FsScope, TransferConflict, TransferItem } from "@/lib/ipc/bindings"
import { ipc } from "@/lib/ipc/client"

/** Transfer commands. Components never call `ipc` directly. */
export const transfersApi = {
  list(): Promise<TransferItem[]> {
    return ipc.transfersList()
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

  cancel(id: string): Promise<boolean> {
    return ipc.transferCancel(id)
  },

  clearFinished(): Promise<number> {
    return ipc.transferClearFinished()
  },
}
