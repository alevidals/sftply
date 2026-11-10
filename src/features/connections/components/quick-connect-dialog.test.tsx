import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { QuickConnectDialog } from "@/features/connections/components/quick-connect-dialog"
import { IpcError } from "@/lib/errors"
import { useUiStore } from "@/stores/ui-store"

const actions = vi.hoisted(() => ({
  quickConnect: vi.fn(),
}))

vi.mock("@/features/sessions/hooks/use-session-actions", () => ({
  useSessionActions: () => actions,
}))

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
}))

beforeEach(() => {
  actions.quickConnect.mockReset()
  actions.quickConnect.mockResolvedValue(undefined)
  useUiStore.setState({ quickConnectOpen: true })
})

function renderDialog() {
  return render(<QuickConnectDialog />)
}

describe("QuickConnectDialog", () => {
  it("connects with the entered credentials without saving", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 })
    renderDialog()

    await user.type(screen.getByLabelText("Host"), "ftp.example.com")
    await user.type(screen.getByLabelText("Username"), "ada")
    await user.type(screen.getByLabelText("Password"), "s3cret")
    await user.click(screen.getByRole("button", { name: "Connect" }))

    await waitFor(() => expect(actions.quickConnect).toHaveBeenCalledTimes(1))
    expect(actions.quickConnect).toHaveBeenCalledWith(
      expect.objectContaining({ host: "ftp.example.com", username: "ada", protocol: "sftp" }),
      "s3cret",
      false,
    )
    expect(useUiStore.getState().quickConnectOpen).toBe(false)
  })

  it("requires a name before saving a connection", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 })
    renderDialog()

    await user.type(screen.getByLabelText("Host"), "ftp.example.com")
    await user.type(screen.getByLabelText("Username"), "ada")
    await user.type(screen.getByLabelText("Password"), "s3cret")
    await user.click(screen.getByRole("switch", { name: "Save this connection" }))
    await user.click(screen.getByRole("button", { name: "Connect" }))

    expect(
      await screen.findByText("A name is required to save the connection."),
    ).toBeInTheDocument()
    expect(actions.quickConnect).not.toHaveBeenCalled()
  })

  it("shows TLS and data-channel options for FTPS", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 })
    renderDialog()

    await user.click(screen.getByRole("combobox", { name: "Protocol" }))
    await user.click(await screen.findByRole("option", { name: "FTPS (explicit)" }))

    expect(screen.getByLabelText("Custom CA file (optional)")).toBeInTheDocument()
    expect(screen.getByLabelText("Certificate pin (optional)")).toBeInTheDocument()
    expect(screen.getByLabelText("Data channel")).toBeInTheDocument()
    expect(screen.getByLabelText("Port")).toHaveValue("21")
  })

  it("surfaces a connection error without closing the dialog", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 })
    actions.quickConnect.mockRejectedValue(
      new IpcError({
        code: "AUTH_FAILED",
        message: "Authentication failed",
        detail: null,
        retryable: false,
      }),
    )
    renderDialog()

    await user.type(screen.getByLabelText("Host"), "ftp.example.com")
    await user.type(screen.getByLabelText("Username"), "ada")
    await user.type(screen.getByLabelText("Password"), "wrong")
    await user.click(screen.getByRole("button", { name: "Connect" }))

    expect(await screen.findByRole("alert")).toHaveTextContent("Authentication failed")
    expect(useUiStore.getState().quickConnectOpen).toBe(true)
  })
})
