import type { FsScope, SyncPlan_Serialize } from "@/lib/ipc/bindings"
import { ipc } from "@/lib/ipc/client"

/** Sync commands. Components never call `ipc` directly. */
export const syncApi = {
  compare(localPath: string, remote: FsScope, remotePath: string): Promise<SyncPlan_Serialize> {
    return ipc.syncCompare(localPath, remote, remotePath)
  },
}
