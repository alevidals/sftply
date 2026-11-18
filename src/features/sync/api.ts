import type {
  FsScope,
  SyncEntry_Serialize,
  SyncPlan_Serialize,
  SyncValidationIssue,
} from "@/lib/ipc/bindings"
import { ipc } from "@/lib/ipc/client"

/** Sync commands. Components never call `ipc` directly. */
export const syncApi = {
  compare(
    localPath: string,
    remote: FsScope,
    remotePath: string,
    include: string[],
    exclude: string[],
  ): Promise<SyncPlan_Serialize> {
    return ipc.syncCompare(localPath, remote, remotePath, include, exclude)
  },

  cancel(): Promise<boolean> {
    return ipc.syncCancel()
  },

  validate(remote: FsScope, entries: SyncEntry_Serialize[]): Promise<SyncValidationIssue[]> {
    return ipc.syncValidate(remote, entries)
  },
}
