import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { UpdateCheck } from "@/features/settings/update-check"

const checkUpdate = vi.fn()
const openUrl = vi.fn()
const success = vi.fn()
const error = vi.fn()

vi.mock("@/lib/ipc/client", () => ({
  ipc: {
    checkUpdate: () => checkUpdate(),
  },
}))

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: (...args: unknown[]) => openUrl(...args),
}))

vi.mock("sonner", () => ({
  toast: {
    success: (...args: unknown[]) => success(...args),
    error: (...args: unknown[]) => error(...args),
  },
}))

describe("UpdateCheck", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("announces a newer version and opens its release page", async () => {
    checkUpdate.mockResolvedValue({
      currentVersion: "0.1.0",
      latestVersion: "0.2.0",
      updateAvailable: true,
      releaseUrl: "https://github.com/alevidals/sftply/releases/tag/v0.2.0",
    })

    render(<UpdateCheck />)
    await userEvent.click(screen.getByRole("button", { name: "Check for updates" }))

    expect(await screen.findByText("0.2.0")).toBeInTheDocument()
    expect(success).toHaveBeenCalledWith("sftply 0.2.0 is available")

    await userEvent.click(screen.getByRole("button", { name: "Release page" }))
    expect(openUrl).toHaveBeenCalledWith("https://github.com/alevidals/sftply/releases/tag/v0.2.0")
  })

  it("reports when the running version is current", async () => {
    checkUpdate.mockResolvedValue({
      currentVersion: "0.2.0",
      latestVersion: "0.2.0",
      updateAvailable: false,
      releaseUrl: "https://github.com/alevidals/sftply/releases",
    })

    render(<UpdateCheck />)
    await userEvent.click(screen.getByRole("button", { name: "Check for updates" }))

    expect(await screen.findByText("You are on the latest version.")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Release page" })).not.toBeInTheDocument()
  })

  it("surfaces a network failure without leaving the button disabled", async () => {
    checkUpdate.mockRejectedValue({
      code: "NETWORK",
      message: "Could not reach the release server. Check your connection and try again.",
      detail: null,
      retryable: true,
    })

    render(<UpdateCheck />)
    await userEvent.click(screen.getByRole("button", { name: "Check for updates" }))

    expect(error).toHaveBeenCalledWith(
      "Could not check for updates",
      expect.objectContaining({
        description: "Could not reach the release server. Check your connection and try again.",
      }),
    )
    expect(screen.getByRole("button", { name: "Check for updates" })).toBeEnabled()
  })
})
