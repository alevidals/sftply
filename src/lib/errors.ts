import type { AppError, ErrorCode, HostKeyChallenge } from "@/lib/ipc/bindings"

/** Error class used at the IPC boundary. `message` is always user-safe. */
export class IpcError extends Error {
  readonly code: ErrorCode
  readonly detail: string | null
  readonly retryable: boolean
  readonly hostKey: HostKeyChallenge | null

  constructor(error: AppError) {
    super(error.message)
    this.name = "IpcError"
    this.code = error.code
    this.detail = error.detail ?? null
    this.retryable = error.retryable
    this.hostKey = error.hostKey ?? null
  }
}

export function isAppError(value: unknown): value is AppError {
  if (typeof value !== "object" || value === null) return false
  const candidate = value as Record<string, unknown>
  return (
    typeof candidate.code === "string" &&
    typeof candidate.message === "string" &&
    typeof candidate.retryable === "boolean"
  )
}

/**
 * Normalize anything thrown across the IPC boundary into an `IpcError`.
 * Unknown failures deliberately hide their internals from the UI.
 */
export function normalizeError(
  value: unknown,
  fallbackMessage = "Something went wrong. Please try again.",
): IpcError {
  if (value instanceof IpcError) return value
  if (isAppError(value)) return new IpcError(value)
  if (value instanceof Error && value.message) {
    return new IpcError({
      code: "INTERNAL",
      message: fallbackMessage,
      detail: value.message,
      retryable: false,
    })
  }
  return new IpcError({
    code: "INTERNAL",
    message: fallbackMessage,
    detail: null,
    retryable: false,
  })
}

export function errorMessage(value: unknown): string {
  return normalizeError(value).message
}
