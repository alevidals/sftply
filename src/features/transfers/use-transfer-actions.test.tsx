import { renderHook, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { useTransferActions } from "@/features/transfers/use-transfer-actions"
import type { FsEntry, SessionInfo, TransferPlan_Serialize } from "@/lib/ipc/bindings"
import { useSessionStore } from "@/stores/session-store"
import { useUiStore } from "@/stores/ui-store"

const planMock = vi.fn()
const enqueueTreeMock = vi.fn()

vi.mock("@/features/transfers/api", () => ({
  transfersApi: {
    plan: (...args: unknown[]) => planMock(...args),
    enqueueTree: (...args: unknown[]) => enqueueTreeMock(...args),
  },
}))

vi.mock("@/features/settings/settings-context", () => ({
  useSettings: () => ({
    settings: { bottomPanelOpen: true },
    updateSettings: vi.fn(),
  }),
}))

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), info: vi.fn(), error: vi.fn() },
}))

const session: SessionInfo = {
  id: "s1",
  connectionId: "c1",
  name: "Test server",
  protocol: "ftp",
  host: "127.0.0.1",
  port: 2121,
  username: "sftply",
  initialPath: "/",
  capabilities: {
    list: true,
    mkdir: true,
    remove: true,
    rename: true,
    chmod: false,
    chown: false,
    symlinks: false,
    unixPermissions: false,
    detailedListing: false,
    resumeDownload: "supported",
    resumeUpload: "supported",
    serverSideMove: false,
    serverSideCopy: false,
    textRead: false,
    textWrite: false,
  },
  connectedAt: 0,
  latencyMs: 1,
  usable: true,
}

const file: FsEntry = {
  name: "report.pdf",
  path: "/report.pdf",
  kind: "file",
  size: 10,
  modifiedAt: 0,
  permissions: 0o644,
  owner: null,
  group: null,
  linkTarget: null,
  hidden: false,
  metadataComplete: true,
}

function plan(directory: string): TransferPlan_Serialize {
  return {
    entries: [
      {
        sourcePath: file.path,
        targetPath: `${directory}/${file.name}`,
        relativePath: file.name,
        kind: "file",
        size: file.size,
        conflict: null,
      },
    ],
    skipped: 0,
    totalBytes: file.size,
  }
}

beforeEach(() => {
  planMock.mockReset()
  enqueueTreeMock.mockReset()
  planMock.mockImplementation((_source, _paths, _target, directory) =>
    Promise.resolve(plan(directory as string)),
  )
  enqueueTreeMock.mockResolvedValue([])
  useSessionStore.setState({
    sessions: { s1: session },
    order: ["s1"],
    activeSessionId: "s1",
    connecting: {},
    lost: {},
    reconnecting: {},
    paths: {},
  })
  useUiStore.setState({
    localSummary: { path: "/local", items: 1, selected: 0 },
    remoteSummary: { path: "/remote", items: 1, selected: 0 },
  })
})

describe("useTransferActions drag destination", () => {
  it("drops a local item into the remote pane using the remote scope", async () => {
    const remote = { kind: "remote", sessionId: "s1" } as const
    const { result } = renderHook(() => useTransferActions("remote", remote))

    result.current.transferFrom({ kind: "local" }, [file])

    await waitFor(() => expect(planMock).toHaveBeenCalledTimes(1))
    expect(planMock).toHaveBeenCalledWith({ kind: "local" }, ["/report.pdf"], remote, "/remote")
    await waitFor(() => expect(enqueueTreeMock).toHaveBeenCalledTimes(1))
    expect(enqueueTreeMock.mock.calls[0]?.[0]).toEqual({ kind: "local" })
    expect(enqueueTreeMock.mock.calls[0]?.[1]).toEqual(remote)
  })

  it("drops a remote item into the local pane using the local scope", async () => {
    const remote = { kind: "remote", sessionId: "s1" } as const
    const { result } = renderHook(() => useTransferActions("local", { kind: "local" }))

    result.current.transferFrom(remote, [file])

    await waitFor(() => expect(planMock).toHaveBeenCalledTimes(1))
    expect(planMock).toHaveBeenCalledWith(remote, ["/report.pdf"], { kind: "local" }, "/local")
    await waitFor(() => expect(enqueueTreeMock).toHaveBeenCalledTimes(1))
    expect(enqueueTreeMock.mock.calls[0]?.[0]).toEqual(remote)
    expect(enqueueTreeMock.mock.calls[0]?.[1]).toEqual({ kind: "local" })
  })
})
