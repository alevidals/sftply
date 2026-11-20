import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { QuickConnectDialog } from "@/features/connections/components/quick-connect-dialog"
import { IpcError } from "@/lib/errors"
import { useHostKeyStore } from "@/stores/host-key-store"
import { useUiStore } from "@/stores/ui-store"

const actions = vi.hoisted(() => ({
  quickConnect: vi.fn(),
}))

const api = vi.hoisted(() => ({
  test: vi.fn(),
}))

vi.mock("@/features/sessions/hooks/use-session-actions", () => ({
  useSessionActions: () => actions,
}))

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
}))

vi.mock("@/features/connections/api", () => ({
  connectionsApi: api,
}))

beforeEach(() => {
  actions.quickConnect.mockReset()
  api.test.mockReset()
  actions.quickConnect.mockResolvedValue(undefined)
  useHostKeyStore.getState().clear()
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

  it("tests the connection without saving or opening a session", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 })
    api.test.mockResolvedValue({ latencyMs: 42, entryCount: 7, path: "/" })
    renderDialog()

    await user.type(screen.getByLabelText("Host"), "ftp.example.com")
    await user.type(screen.getByLabelText("Username"), "ada")
    await user.type(screen.getByLabelText("Password"), "s3cret")
    await user.click(screen.getByRole("button", { name: "Test connection" }))

    await waitFor(() => expect(api.test).toHaveBeenCalledTimes(1))
    expect(api.test).toHaveBeenCalledWith(
      expect.objectContaining({ host: "ftp.example.com", username: "ada" }),
      null,
      "s3cret",
    )
    expect(actions.quickConnect).not.toHaveBeenCalled()
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

  it("hides the passphrase field for unprotected keys", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 })
    renderDialog()

    await user.type(screen.getByLabelText("Host"), "sftp.example.com")
    await user.type(screen.getByLabelText("Username"), "ada")
    await user.click(screen.getByRole("combobox", { name: "Authentication" }))
    await user.click(await screen.findByRole("option", { name: "SSH key" }))
    await user.type(screen.getByLabelText("Private key"), "/home/ada/.ssh/id_ed25519")

    expect(screen.queryByLabelText("Passphrase")).not.toBeInTheDocument()
    await user.click(screen.getByRole("switch", { name: "Key needs a passphrase" }))
    expect(screen.getByLabelText("Passphrase")).toBeInTheDocument()
  })

  it("uses the SSH agent without asking for a secret", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 })
    renderDialog()

    await user.type(screen.getByLabelText("Host"), "sftp.example.com")
    await user.type(screen.getByLabelText("Username"), "ada")
    await user.click(screen.getByRole("combobox", { name: "Authentication" }))
    await user.click(await screen.findByRole("option", { name: "SSH agent" }))

    expect(screen.queryByLabelText("Password")).not.toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Connect" }))

    await waitFor(() => expect(actions.quickConnect).toHaveBeenCalledTimes(1))
    expect(actions.quickConnect).toHaveBeenCalledWith(
      expect.objectContaining({
        host: "sftp.example.com",
        username: "ada",
        auth: { kind: "agent" },
      }),
      "",
      false,
    )
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

  it("opens the host key review when the test reaches an unknown key", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 })
    api.test.mockRejectedValue(
      new IpcError({
        code: "HOST_KEY_UNKNOWN",
        message: "This server's host key is not trusted yet.",
        detail: null,
        retryable: false,
        hostKey: {
          host: "sftp.example.com",
          port: 22,
          keyType: "ssh-ed25519",
          fingerprint: "SHA256:abc123",
          previousFingerprint: null,
        },
      }),
    )
    renderDialog()

    await user.type(screen.getByLabelText("Host"), "sftp.example.com")
    await user.type(screen.getByLabelText("Username"), "ada")
    await user.click(screen.getByRole("button", { name: "Test connection" }))

    await waitFor(() =>
      expect(useHostKeyStore.getState().challenge).toMatchObject({
        host: "sftp.example.com",
        port: 22,
      }),
    )
    expect(await screen.findByText(/host key is not trusted yet/i)).toBeInTheDocument()
    expect(api.test).toHaveBeenCalledTimes(1)
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
