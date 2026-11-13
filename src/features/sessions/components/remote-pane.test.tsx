import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { RemotePane } from "@/features/sessions/components/remote-pane"
import type { FsCapabilities, SessionInfo } from "@/lib/ipc/bindings"
import { useSessionStore } from "@/stores/session-store"

const actions = vi.hoisted(() => ({
  disconnect: vi.fn(),
  reconnect: vi.fn(),
  cancel: vi.fn(),
}))

vi.mock("@/features/sessions/hooks/use-session-actions", () => ({
  useSessionActions: () => actions,
}))

vi.mock("@/features/files/directory-browser", () => ({
  DirectoryBrowser: (props: { initialPath: string; onCancel?: () => void }) => (
    <div data-testid="browser" data-path={props.initialPath}>
      <button type="button" onClick={props.onCancel}>
        cancel-listing
      </button>
    </div>
  ),
}))

const capabilities: FsCapabilities = {
  list: true,
  mkdir: true,
  remove: true,
  rename: true,
  chmod: true,
  chown: false,
  symlinks: true,
  unixPermissions: true,
  detailedListing: true,
  resumeDownload: "supported",
  resumeUpload: "supported",
  serverSideMove: false,
  serverSideCopy: false,
  textRead: false,
  textWrite: false,
}

function session(id: string, name: string): SessionInfo {
  return {
    id,
    connectionId: `connection-${id}`,
    name,
    protocol: "sftp",
    host: `${id}.example.com`,
    port: 22,
    username: "ada",
    initialPath: "/home/ada",
    capabilities,
    connectedAt: 0,
    latencyMs: 12,
    usable: true,
  }
}

function resetStore() {
  useSessionStore.setState({
    sessions: {},
    order: [],
    activeSessionId: null,
    connecting: {},
    lost: {},
    reconnecting: {},
    paths: {},
  })
}

beforeEach(() => {
  resetStore()
  actions.disconnect.mockReset()
  actions.reconnect.mockReset()
  actions.cancel.mockReset()
})

describe("RemotePane", () => {
  it("shows the lost state and reconnects the active session", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 })
    const first = session("a", "Staging")
    const second = session("b", "Production")
    useSessionStore.setState({
      sessions: { a: first, b: second },
      order: ["a", "b"],
      activeSessionId: "b",
      lost: { b: "The server took too long to respond." },
    })

    render(<RemotePane />)

    expect(screen.getByRole("tab", { name: "Staging" })).toBeInTheDocument()
    expect(screen.getByRole("tab", { name: "Production" })).toBeInTheDocument()
    expect(screen.getByText("The connection was lost")).toBeInTheDocument()
    expect(screen.getByText("The server took too long to respond.")).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "Reconnect" }))
    expect(actions.reconnect).toHaveBeenCalledWith("b")

    await user.click(screen.getByRole("button", { name: "Disconnect" }))
    expect(actions.disconnect).toHaveBeenCalledWith("b")
  })

  it("switches tabs and restores the last visited folder", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 })
    const first = session("a", "Staging")
    const second = session("b", "Production")
    useSessionStore.setState({
      sessions: { a: first, b: second },
      order: ["a", "b"],
      activeSessionId: "b",
      paths: { a: "/var/log" },
    })

    render(<RemotePane />)

    await user.click(screen.getByRole("tab", { name: "Staging" }))
    expect(useSessionStore.getState().activeSessionId).toBe("a")
    expect(screen.getByTestId("browser")).toHaveAttribute("data-path", "/var/log")
  })

  it("cancels the active listing", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 })
    const first = session("a", "Staging")
    useSessionStore.setState({
      sessions: { a: first },
      order: ["a"],
      activeSessionId: "a",
    })

    render(<RemotePane />)
    await user.click(screen.getByRole("button", { name: "cancel-listing" }))
    expect(actions.cancel).toHaveBeenCalledWith("a")
  })

  it("copies connection details from a tab context menu", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 })
    const first = session("a", "Staging")
    const second = session("b", "Production")
    useSessionStore.setState({
      sessions: { a: first, b: second },
      order: ["a", "b"],
      activeSessionId: "b",
      paths: { a: "/var/log" },
    })

    render(<RemotePane />)

    await user.pointer({
      keys: "[MouseRight]",
      target: screen.getByRole("tab", { name: "Staging" }),
    })
    await user.click(await screen.findByRole("menuitem", { name: "Copy host" }))
    await expect(navigator.clipboard.readText()).resolves.toBe("a.example.com:22")

    await user.pointer({
      keys: "[MouseRight]",
      target: screen.getByRole("tab", { name: "Staging" }),
    })
    await user.click(await screen.findByRole("menuitem", { name: "Copy login" }))
    await expect(navigator.clipboard.readText()).resolves.toBe("ada@a.example.com:22")

    await user.pointer({
      keys: "[MouseRight]",
      target: screen.getByRole("tab", { name: "Staging" }),
    })
    await user.click(await screen.findByRole("menuitem", { name: "Copy current path" }))
    await expect(navigator.clipboard.readText()).resolves.toBe("/var/log")
  })

  it("only enables reconnect on a lost tab", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 })
    const first = session("a", "Staging")
    const second = session("b", "Production")
    useSessionStore.setState({
      sessions: { a: first, b: second },
      order: ["a", "b"],
      activeSessionId: "b",
      lost: { b: "The server took too long to respond." },
    })

    render(<RemotePane />)

    await user.pointer({
      keys: "[MouseRight]",
      target: screen.getByRole("tab", { name: "Staging" }),
    })
    expect(await screen.findByRole("menuitem", { name: "Reconnect" })).toHaveAttribute(
      "aria-disabled",
      "true",
    )
    await user.keyboard("{Escape}")

    await user.pointer({
      keys: "[MouseRight]",
      target: screen.getByRole("tab", { name: "Production" }),
    })
    const reconnect = await screen.findByRole("menuitem", { name: "Reconnect" })
    expect(reconnect).not.toHaveAttribute("aria-disabled")
    await user.click(reconnect)
    expect(actions.reconnect).toHaveBeenCalledWith("b")
  })
})
