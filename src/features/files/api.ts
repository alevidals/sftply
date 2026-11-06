import type { FsEntry, FsScope, Listing } from "@/lib/ipc/bindings"
import { ipc } from "@/lib/ipc/client"

export const LOCAL_SCOPE: FsScope = { kind: "local" }

/** Local filesystem API. Components never call `ipc` directly. */
export const localFiles = {
  list(path: string, showHidden: boolean): Promise<Listing> {
    return ipc.fsList(LOCAL_SCOPE, path, showHidden)
  },

  stat(path: string): Promise<FsEntry> {
    return ipc.fsStat(LOCAL_SCOPE, path)
  },

  mkdir(parent: string, name: string): Promise<FsEntry> {
    return ipc.fsMkdir(LOCAL_SCOPE, parent, name)
  },

  rename(path: string, newName: string): Promise<FsEntry> {
    return ipc.fsRename(LOCAL_SCOPE, path, newName)
  },

  remove(path: string, recursive: boolean): Promise<void> {
    return ipc.fsDelete(LOCAL_SCOPE, path, recursive)
  },

  chmod(path: string, mode: number): Promise<void> {
    return ipc.fsChmod(LOCAL_SCOPE, path, mode)
  },

  open(path: string): Promise<void> {
    return ipc.localOpen(path)
  },

  reveal(path: string): Promise<void> {
    return ipc.localReveal(path)
  },
}
