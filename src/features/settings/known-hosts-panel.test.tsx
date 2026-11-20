import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { KnownHostsPanel } from "@/features/settings/known-hosts-panel"
import type { KnownHost } from "@/lib/ipc/bindings"

const state = vi.hoisted(() => ({
  list: vi.fn(),
  remove: vi.fn(),
}))

vi.mock("@/lib/ipc/client", () => ({
  ipc: {
    knownHostsList: state.list,
    knownHostRemove: state.remove,
  },
}))

vi.mock("@/features/settings/settings-context", () => ({
  useFormatPreferences: () => ({ dateFormat: "iso", sizeFormat: "binary" }),
}))

const host: KnownHost = {
  host: "sftp.example.com",
  port: 22,
  keyType: "ssh-ed25519",
  fingerprint: "SHA256:abc123",
  addedAt: 1_700_000_000_000,
}

beforeEach(() => {
  state.list.mockReset()
  state.remove.mockReset()
  state.list.mockResolvedValue([host])
  state.remove.mockResolvedValue(undefined)
})

function renderPanel() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <KnownHostsPanel />
    </QueryClientProvider>,
  )
}

describe("KnownHostsPanel", () => {
  it("lists trusted hosts and removes one after confirmation", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 })
    renderPanel()

    expect(await screen.findByText("sftp.example.com:22")).toBeInTheDocument()
    expect(screen.getByText(/ssh-ed25519/)).toBeInTheDocument()
    expect(screen.getByText("SHA256:abc123")).toBeInTheDocument()

    await user.click(
      screen.getByRole("button", { name: "Remove the host key for sftp.example.com:22" }),
    )
    await user.click(await screen.findByRole("button", { name: "Remove key" }))

    await waitFor(() => expect(state.remove).toHaveBeenCalledWith("sftp.example.com", 22))
  })

  it("shows an empty state when no hosts are trusted", async () => {
    state.list.mockResolvedValue([])
    renderPanel()

    expect(await screen.findByText(/No SSH hosts are trusted yet/i)).toBeInTheDocument()
  })
})
