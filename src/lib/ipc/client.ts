import { normalizeError } from "@/lib/errors"
import {
  type AppInfo,
  type AppSettings_Serialize,
  commands,
  type FsEntry,
  type FsScope,
  type Listing,
  type StartupReport,
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
}
