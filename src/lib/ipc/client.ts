import { normalizeError } from "@/lib/errors"
import {
  type AppInfo,
  type AppSettings_Serialize,
  commands,
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
}
