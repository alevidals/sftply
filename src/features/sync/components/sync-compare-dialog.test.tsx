import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { SyncCompareDialog } from "@/features/sync/components/sync-compare-dialog"
import type { SessionInfo, SyncEntry_Serialize, SyncPlan_Serialize } from "@/lib/ipc/bindings"
import { useSessionStore } from "@/stores/session-store"
import { useUiStore } from "@/stores/ui-store"

const state = vi.hoisted(() => ({
  compare: vi.fn(),
  enqueueTree: vi.fn(),
  invalidateQueries: vi.fn(),
  updateSettings: vi.fn(),
}))

vi.mock("@/features/sync/api", () => ({
  syncApi: { compare: state.compare },
}))

vi.mock("@/features/transfers/api", () => ({
  transfersApi: { enqueueTree: state.enqueueTree },
}))

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: state.invalidateQueries }),
}))

vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getTotalSize: () => count * 38,
    getVirtualItems: () =>
      Array.from({ length: count }, (_, index) => ({
        index,
        start: index * 38,
        size: 38,
        key: index,
      })),
  }),
}))

vi.mock("@/features/settings/settings-context", () => ({
  useSettings: () => ({
    settings: { bottomPanelOpen: true },
    updateSettings: state.updateSettings,
  }),
  useFormatPreferences: () => ({ sizeFormat: "binary", dateFormat: "friendly" }),
}))

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), info: vi.fn(), error: vi.fn() },
}))

function entry(
  relativePath: string,
  action: SyncEntry_Serialize["action"],
  overrides: Partial<SyncEntry_Serialize> = {},
): SyncEntry_Serialize {
  return {
    relativePath,
    name: relativePath.split("/").pop() ?? relativePath,
    localPath: `/local/${relativePath}`,
    remotePath: null,
    remoteTargetPath: `/remote/${relativePath}`,
    localKind: "file",
    remoteKind: null,
    localSize: 10,
    remoteSize: null,
    localModifiedAt: 1_000,
    remoteModifiedAt: null,
    status: "localOnly",
    action,
    ...overrides,
  }
}

const plan: SyncPlan_Serialize = {
  localRoot: "/local",
  remoteRoot: "/remote",
  entries: [
    entry("a.txt", "upload"),
    entry("photos", "createDirectory", { localKind: "directory", localSize: 0 }),
    entry("same.txt", "skip", { status: "equal" }),
    entry("draft.txt", "review", {
      status: "dateDiffers",
      remotePath: "/remote/draft.txt",
      remoteSize: 10,
      remoteModifiedAt: 2_000,
    }),
  ],
  uploadFiles: 1,
  uploadBytes: 10,
  createDirectories: 1,
  changed: 0,
  dateDiffers: 1,
  equal: 1,
  equalContent: 0,
  remoteOnly: 0,
  unknown: 0,
  conflicts: 0,
  skipped: 0,
  truncated: false,
  warnings: [],
}

beforeEach(() => {
  state.compare.mockReset().mockResolvedValue(plan)
  state.enqueueTree.mockReset().mockResolvedValue([{ id: "transfer-1" }])
  state.invalidateQueries.mockReset()
  state.updateSettings.mockReset().mockResolvedValue(undefined)

  useUiStore.setState({
    syncCompareOpen: true,
    localSummary: { path: "/local", items: 2, selected: 0 },
    remoteSummary: { path: "/remote", items: 2, selected: 0 },
  })
  useSessionStore.setState({
    sessions: {
      "session-1": { id: "session-1", name: "Server" } as unknown as SessionInfo,
    },
    order: ["session-1"],
    activeSessionId: "session-1",
  })
})

describe("SyncCompareDialog", () => {
  it("shows the dry-run and queues the selected uploads", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 })
    render(<SyncCompareDialog />)

    await waitFor(() =>
      expect(state.compare).toHaveBeenCalledWith(
        "/local",
        { kind: "remote", sessionId: "session-1" },
        "/remote",
      ),
    )
    expect(await screen.findByText("a.txt")).toBeInTheDocument()

    const dateOnly = screen.getByLabelText("Select draft.txt")
    expect(dateOnly).toHaveAttribute("aria-checked", "false")
    await user.click(dateOnly)

    await user.click(screen.getByRole("button", { name: "Sync 2 files" }))

    await waitFor(() => expect(state.enqueueTree).toHaveBeenCalled())
    expect(state.enqueueTree).toHaveBeenCalledWith(
      { kind: "local" },
      { kind: "remote", sessionId: "session-1" },
      "overwrite",
      [
        expect.objectContaining({ relativePath: "a.txt" }),
        expect.objectContaining({ relativePath: "photos", kind: "directory" }),
        expect.objectContaining({ relativePath: "draft.txt" }),
      ],
      [],
    )
    expect(useUiStore.getState().syncCompareOpen).toBe(false)
  })
})
