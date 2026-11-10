import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import { TooltipProvider } from "@/components/ui/tooltip"
import { ConnectionRow } from "@/features/connections/components/connections-panel"
import type { ConnectionProfile_Serialize, FsCapabilities, SessionInfo } from "@/lib/ipc/bindings"

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

const connection: ConnectionProfile_Serialize = {
  id: "connection-1",
  name: "Production",
  protocol: "sftp",
  host: "example.com",
  port: 22,
  username: "ada",
  auth: { kind: "password" },
  initialPath: "/",
  favorite: false,
  group: null,
  tls: { caFile: null, certificatePin: null, allowInvalidCertificates: false },
  ftpDataMode: "passive",
  createdAt: 0,
  lastUsedAt: null,
}

const session: SessionInfo = {
  id: "session-1",
  connectionId: "connection-1",
  name: "Production",
  protocol: "sftp",
  host: "example.com",
  port: 22,
  username: "ada",
  initialPath: "/",
  capabilities,
  connectedAt: 0,
  latencyMs: 24,
  usable: true,
}

function renderRow(
  overrides: {
    session?: SessionInfo | null
    lost?: boolean
    connecting?: boolean
    active?: boolean
  } = {},
) {
  const handlers = {
    onActivate: vi.fn(),
    onConnect: vi.fn(),
    onDisconnect: vi.fn(),
    onReconnect: vi.fn(),
    onEdit: vi.fn(),
    onDuplicate: vi.fn(),
    onFavorite: vi.fn(),
    onDelete: vi.fn(),
  }
  render(
    <TooltipProvider>
      <ConnectionRow
        connection={connection}
        session={overrides.session ?? null}
        lost={overrides.lost ?? false}
        connecting={overrides.connecting ?? false}
        active={overrides.active ?? false}
        {...handlers}
      />
    </TooltipProvider>,
  )
  return handlers
}

describe("ConnectionRow", () => {
  it("connects when no session is open", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 })
    const handlers = renderRow()

    await user.click(screen.getByRole("button", { name: /Production, SFTP example.com/ }))
    expect(handlers.onConnect).toHaveBeenCalledTimes(1)
  })

  it("activates an open session and shows its latency", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 })
    const handlers = renderRow({ session })

    expect(screen.getByText("24 ms")).toBeInTheDocument()
    await user.click(
      screen.getByRole("button", { name: /Production, SFTP example.com, connected/ }),
    )
    expect(handlers.onActivate).toHaveBeenCalledWith("session-1")
  })

  it("shows a lost connection and offers reconnect", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 })
    const handlers = renderRow({ session, lost: true })

    expect(screen.getByText("Connection lost")).toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: /Production, SFTP example.com, connection lost/ }),
    ).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "Actions for Production" }))
    await user.click(screen.getByRole("menuitem", { name: "Reconnect" }))
    expect(handlers.onReconnect).toHaveBeenCalledWith("session-1")
  })

  it("disconnects from the row action", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 })
    const handlers = renderRow({ session })

    await user.click(screen.getByRole("button", { name: "Disconnect from Production" }))
    expect(handlers.onDisconnect).toHaveBeenCalledWith("session-1")
  })
})
