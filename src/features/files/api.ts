import type { FsEntry, FsScope, Listing, TextFile } from "@/lib/ipc/bindings"
import { ipc } from "@/lib/ipc/client"

export const LOCAL_SCOPE: FsScope = { kind: "local" }

export function remoteScope(sessionId: string): FsScope {
  return { kind: "remote", sessionId }
}

/** Stable query-key segment for a filesystem scope. */
export function scopeKey(scope: FsScope): string {
  return scope.kind === "local" ? "local" : `remote:${scope.sessionId}`
}

/** Filesystem operations for a scope. Components never call `ipc` directly. */
export function filesApi(scope: FsScope) {
  return {
    list(path: string, showHidden: boolean): Promise<Listing> {
      return ipc.fsList(scope, path, showHidden)
    },

    stat(path: string): Promise<FsEntry> {
      return ipc.fsStat(scope, path)
    },

    mkdir(parent: string, name: string): Promise<FsEntry> {
      return ipc.fsMkdir(scope, parent, name)
    },

    rename(path: string, newName: string): Promise<FsEntry> {
      return ipc.fsRename(scope, path, newName)
    },

    remove(path: string, recursive: boolean): Promise<void> {
      return ipc.fsDelete(scope, path, recursive)
    },

    chmod(path: string, mode: number): Promise<void> {
      return ipc.fsChmod(scope, path, mode)
    },

    readText(path: string): Promise<TextFile> {
      return ipc.fsReadText(scope, path)
    },

    writeText(
      path: string,
      content: string,
      expectedVersion: string | null,
      force: boolean,
    ): Promise<TextFile> {
      return ipc.fsWriteText(scope, path, content, expectedVersion, force)
    },
  }
}

/** Local filesystem API, including operations that only make sense locally. */
export const localFiles = {
  ...filesApi(LOCAL_SCOPE),

  createFile(parent: string, name: string): Promise<FsEntry> {
    return ipc.localCreateFile(parent, name)
  },

  open(path: string): Promise<void> {
    return ipc.localOpen(path)
  },

  openEditor(path: string): Promise<void> {
    return ipc.localOpenEditor(path)
  },

  reveal(path: string): Promise<void> {
    return ipc.localReveal(path)
  },
}
