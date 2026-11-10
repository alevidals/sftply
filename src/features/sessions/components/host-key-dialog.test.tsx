import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { HostKeyDialog } from "@/features/sessions/components/host-key-dialog"
import type { HostKeyChallenge, KnownHost } from "@/lib/ipc/bindings"
import { ipc } from "@/lib/ipc/client"
import { useHostKeyStore } from "@/stores/host-key-store"

const actions = vi.hoisted(() => ({
  connect: vi.fn(),
}))

vi.mock("@/features/sessions/hooks/use-session-actions", () => ({
  useSessionActions: () => actions,
}))

vi.mock("@/lib/ipc/client", () => ({
  ipc: {
    knownHostTrust: vi.fn(),
  },
}))

const knownHost: KnownHost = {
  host: "sftp.example.com",
  port: 22,
  keyType: "ssh-ed25519",
  fingerprint: "SHA256:abc123",
  addedAt: 0,
}

const challenge: HostKeyChallenge = {
  host: "sftp.example.com",
  port: 22,
  keyType: "ssh-ed25519",
  fingerprint: "SHA256:abc123",
  previousFingerprint: null,
}

function resetStore() {
  useHostKeyStore.setState({ challenge: null, connectionId: null, retry: null })
}

beforeEach(() => {
  resetStore()
  actions.connect.mockReset()
  vi.mocked(ipc.knownHostTrust).mockReset()
})

describe("HostKeyDialog", () => {
  it("trusts an unknown key and retries the connection", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 })
    const retry = vi.fn().mockResolvedValue(undefined)
    vi.mocked(ipc.knownHostTrust).mockResolvedValue(knownHost)
    useHostKeyStore.getState().request("connection-1", challenge, retry)

    render(<HostKeyDialog />)

    expect(screen.getByText("New server key")).toBeInTheDocument()
    expect(screen.getByText("SHA256:abc123")).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "Trust and connect" }))

    await waitFor(() => expect(retry).toHaveBeenCalledTimes(1))
    expect(ipc.knownHostTrust).toHaveBeenCalledWith(
      "sftp.example.com",
      22,
      "ssh-ed25519",
      "SHA256:abc123",
    )
    expect(useHostKeyStore.getState().challenge).toBeNull()
    expect(actions.connect).not.toHaveBeenCalled()
  })

  it("falls back to reconnecting a saved connection without a retry closure", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 })
    vi.mocked(ipc.knownHostTrust).mockResolvedValue(knownHost)
    useHostKeyStore.getState().request("connection-1", challenge)

    render(<HostKeyDialog />)
    await user.click(screen.getByRole("button", { name: "Trust and connect" }))

    await waitFor(() => expect(actions.connect).toHaveBeenCalledWith("connection-1"))
  })

  it("warns about a changed key and shows the previous fingerprint", async () => {
    vi.mocked(ipc.knownHostTrust).mockResolvedValue(knownHost)
    useHostKeyStore.getState().request("connection-1", {
      ...challenge,
      previousFingerprint: "SHA256:old456",
    })

    render(<HostKeyDialog />)

    expect(screen.getByText("Server key changed")).toBeInTheDocument()
    expect(screen.getByText("SHA256:old456")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Replace key and connect" })).toBeInTheDocument()
  })

  it("clears the challenge when cancelled", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 })
    useHostKeyStore.getState().request("connection-1", challenge)

    render(<HostKeyDialog />)
    await user.click(screen.getByRole("button", { name: "Cancel" }))

    await waitFor(() => expect(useHostKeyStore.getState().challenge).toBeNull())
    expect(ipc.knownHostTrust).not.toHaveBeenCalled()
  })
})
