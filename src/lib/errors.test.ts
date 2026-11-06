import { describe, expect, it } from "vitest"
import { errorMessage, IpcError, normalizeError } from "@/lib/errors"

describe("normalizeError", () => {
  it("returns IpcError instances unchanged", () => {
    const error = new IpcError({
      code: "TIMEOUT",
      message: "The server took too long to respond.",
      detail: null,
      retryable: true,
    })
    expect(normalizeError(error)).toBe(error)
  })

  it("normalizes serialized backend errors", () => {
    const error = normalizeError({
      code: "AUTH_FAILED",
      message: "The username or password was rejected.",
      detail: "server said no",
      retryable: false,
    })
    expect(error).toBeInstanceOf(IpcError)
    expect(error.code).toBe("AUTH_FAILED")
    expect(error.message).toBe("The username or password was rejected.")
    expect(error.detail).toBe("server said no")
  })

  it("hides unknown error internals behind a safe message", () => {
    const error = normalizeError(new Error("stack trace with paths"))
    expect(error.code).toBe("INTERNAL")
    expect(error.message).toBe("Something went wrong. Please try again.")
    expect(error.detail).toBe("stack trace with paths")
  })

  it("handles non-error values", () => {
    expect(errorMessage(null)).toBe("Something went wrong. Please try again.")
  })
})
