import { normalizeError } from "@/lib/errors"
import {
  type AppInfo,
  type AppSettings_Serialize,
  type ConflictPolicy,
  type ConnectionExportSummary,
  type ConnectionImportSummary,
  type ConnectionInput_Deserialize,
  type ConnectionProfile_Serialize,
  commands,
  type FsEntry,
  type FsScope,
  type KnownHost,
  type Listing,
  type SecretKind,
  type SecretStatus,
  type SessionInfo,
  type StartupReport,
  type TextFile,
  type TransferConflict,
  type TransferHistoryEntry_Serialize,
  type TransferItem,
  type TransferItem_Serialize,
  type TransferPlan_Serialize,
  type UpdateStatus,
} from "@/lib/ipc/bindings"

type CommandResult<T, E> = { status: "ok"; data: T } | { status: "error"; error: E }

async function invoke<T>(promise: Promise<T>): Promise<T> {
  try {
    return await promise
  } catch (error) {
    throw normalizeError(error)
  }
}

function unwrap<T, E>(result: CommandResult<T, E>): T {
  if (result.status === "error") throw normalizeError(result.error)
  return result.data
}

/** Typed, normalized access to the Rust command surface. */
export const ipc = {
  appInfo(): Promise<AppInfo> {
    return invoke(commands.appInfo())
  },

  checkUpdate(): Promise<UpdateStatus> {
    return invoke(commands.appCheckUpdate()).then((result) => unwrap(result))
  },

  startupReport(): Promise<StartupReport> {
    return invoke(commands.startupReport())
  },

  settingsGet(): Promise<AppSettings_Serialize> {
    return invoke(commands.settingsGet())
  },

  settingsUpdate(settings: AppSettings_Serialize): Promise<AppSettings_Serialize> {
    return invoke(commands.settingsUpdate(settings)).then((result) => unwrap(result))
  },

  fsList(scope: FsScope, path: string, showHidden: boolean): Promise<Listing> {
    return invoke(commands.fsList(scope, path, showHidden)).then((result) => unwrap(result))
  },

  fsStat(scope: FsScope, path: string): Promise<FsEntry> {
    return invoke(commands.fsStat(scope, path)).then((result) => unwrap(result))
  },

  fsMkdir(scope: FsScope, parent: string, name: string): Promise<FsEntry> {
    return invoke(commands.fsMkdir(scope, parent, name)).then((result) => unwrap(result))
  },

  fsRename(scope: FsScope, path: string, newName: string): Promise<FsEntry> {
    return invoke(commands.fsRename(scope, path, newName)).then((result) => unwrap(result))
  },

  fsDelete(scope: FsScope, path: string, recursive: boolean): Promise<void> {
    return invoke(commands.fsDelete(scope, path, recursive)).then((result) => {
      unwrap(result)
    })
  },

  fsChmod(scope: FsScope, path: string, mode: number): Promise<void> {
    return invoke(commands.fsChmod(scope, path, mode)).then((result) => {
      unwrap(result)
    })
  },

  fsReadText(scope: FsScope, path: string): Promise<TextFile> {
    return invoke(commands.fsReadText(scope, path)).then((result) => unwrap(result))
  },

  fsWriteText(
    scope: FsScope,
    path: string,
    content: string,
    expectedVersion: string | null,
    force: boolean,
  ): Promise<TextFile> {
    return invoke(commands.fsWriteText(scope, path, content, expectedVersion, force)).then(
      (result) => unwrap(result),
    )
  },

  localOpen(path: string): Promise<void> {
    return invoke(commands.localOpen(path)).then((result) => {
      unwrap(result)
    })
  },

  localReveal(path: string): Promise<void> {
    return invoke(commands.localReveal(path)).then((result) => {
      unwrap(result)
    })
  },

  connectionsList(): Promise<ConnectionProfile_Serialize[]> {
    return invoke(commands.connectionsList())
  },

  connectionCreate(input: ConnectionInput_Deserialize): Promise<ConnectionProfile_Serialize> {
    return invoke(commands.connectionCreate(input)).then((result) => unwrap(result))
  },

  connectionUpdate(
    id: string,
    input: ConnectionInput_Deserialize,
  ): Promise<ConnectionProfile_Serialize> {
    return invoke(commands.connectionUpdate(id, input)).then((result) => unwrap(result))
  },

  connectionDelete(id: string): Promise<void> {
    return invoke(commands.connectionDelete(id)).then((result) => {
      unwrap(result)
    })
  },

  connectionDuplicate(id: string): Promise<ConnectionProfile_Serialize> {
    return invoke(commands.connectionDuplicate(id)).then((result) => unwrap(result))
  },

  connectionSetFavorite(id: string, favorite: boolean): Promise<ConnectionProfile_Serialize> {
    return invoke(commands.connectionSetFavorite(id, favorite)).then((result) => unwrap(result))
  },

  connectionReorder(ids: string[]): Promise<ConnectionProfile_Serialize[]> {
    return invoke(commands.connectionReorder(ids)).then((result) => unwrap(result))
  },

  connectionSecretSet(id: string, kind: SecretKind, secret: string): Promise<void> {
    return invoke(commands.connectionSecretSet(id, kind, secret)).then((result) => {
      unwrap(result)
    })
  },

  connectionSecretDelete(id: string, kind: SecretKind): Promise<void> {
    return invoke(commands.connectionSecretDelete(id, kind)).then((result) => {
      unwrap(result)
    })
  },

  connectionSecretStatus(id: string): Promise<SecretStatus> {
    return invoke(commands.connectionSecretStatus(id)).then((result) => unwrap(result))
  },

  connectionsExport(path: string): Promise<ConnectionExportSummary> {
    return invoke(commands.connectionsExport(path)).then((result) => unwrap(result))
  },

  connectionsImport(path: string): Promise<ConnectionImportSummary> {
    return invoke(commands.connectionsImport(path)).then((result) => unwrap(result))
  },

  knownHostsList(): Promise<KnownHost[]> {
    return invoke(commands.knownHostsList())
  },

  knownHostTrust(
    host: string,
    port: number,
    keyType: string,
    fingerprint: string,
  ): Promise<KnownHost> {
    return invoke(commands.knownHostTrust(host, port, keyType, fingerprint)).then((result) =>
      unwrap(result),
    )
  },

  knownHostRemove(host: string, port: number): Promise<void> {
    return invoke(commands.knownHostRemove(host, port)).then((result) => {
      unwrap(result)
    })
  },

  sessionsList(): Promise<SessionInfo[]> {
    return invoke(commands.sessionsList())
  },

  sessionConnect(connectionId: string): Promise<SessionInfo> {
    return invoke(commands.sessionConnect(connectionId)).then((result) => unwrap(result))
  },

  sessionConnectQuick(
    input: ConnectionInput_Deserialize,
    secret: string,
    save: boolean,
  ): Promise<SessionInfo> {
    return invoke(commands.sessionConnectQuick(input, secret, save)).then((result) =>
      unwrap(result),
    )
  },

  sessionDisconnect(sessionId: string): Promise<void> {
    return invoke(commands.sessionDisconnect(sessionId)).then((result) => {
      unwrap(result)
    })
  },

  sessionReconnect(sessionId: string): Promise<SessionInfo> {
    return invoke(commands.sessionReconnect(sessionId)).then((result) => unwrap(result))
  },

  sessionCancel(sessionId: string): Promise<boolean> {
    return invoke(commands.sessionCancel(sessionId)).then((result) => unwrap(result))
  },

  transferPlan(
    source: FsScope,
    sourcePaths: string[],
    target: FsScope,
    targetPath: string,
  ): Promise<TransferPlan_Serialize> {
    return invoke(commands.transferPlan(source, sourcePaths, target, targetPath)).then((result) =>
      unwrap(result),
    )
  },

  transferPreflight(target: FsScope, targetPath: string): Promise<TransferConflict | null> {
    return invoke(commands.transferPreflight(target, targetPath)).then((result) => unwrap(result))
  },

  transferEnqueue(
    source: FsScope,
    sourcePath: string,
    target: FsScope,
    targetPath: string,
    policy: ConflictPolicy,
  ): Promise<TransferItem> {
    return invoke(commands.transferEnqueue(source, sourcePath, target, targetPath, policy)).then(
      (result) => unwrap(result),
    )
  },

  transferEnqueueTree(
    source: FsScope,
    target: FsScope,
    policy: ConflictPolicy,
    entries: Parameters<typeof commands.transferEnqueueTree>[3],
    skipTargets: string[],
  ): Promise<TransferItem_Serialize[]> {
    return invoke(commands.transferEnqueueTree(source, target, policy, entries, skipTargets)).then(
      (result) => unwrap(result),
    )
  },

  transfersList(): Promise<TransferItem[]> {
    return invoke(commands.transfersList())
  },

  transferCancel(id: string): Promise<boolean> {
    return invoke(commands.transferCancel(id))
  },

  transferRetry(id: string): Promise<TransferItem_Serialize> {
    return invoke(commands.transferRetry(id)).then((result) => unwrap(result))
  },

  transferClearFinished(): Promise<number> {
    return invoke(commands.transferClearFinished())
  },

  transferPauseQueue(): Promise<boolean> {
    return invoke(commands.transferPauseQueue())
  },

  transferResumeQueue(): Promise<boolean> {
    return invoke(commands.transferResumeQueue())
  },

  transferQueuePaused(): Promise<boolean> {
    return invoke(commands.transferQueuePaused())
  },

  transferHistory(): Promise<TransferHistoryEntry_Serialize[]> {
    return invoke(commands.transferHistory())
  },

  transferClearHistory(): Promise<number> {
    return invoke(commands.transferClearHistory())
  },
}
