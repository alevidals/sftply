import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { CommandPalette } from "@/features/shell/command-palette"
import type { AppSettings_Serialize, TransferItem_Serialize } from "@/lib/ipc/bindings"
import { useSessionStore } from "@/stores/session-store"
import { useTransferStore } from "@/stores/transfer-store"
import { useUiStore } from "@/stores/ui-store"

const state = vi.hoisted(() => ({
  settings: {} as AppSettings_Serialize,
  updateSettings: vi.fn(),
  copyText: vi.fn(),
  clearFinished: vi.fn(),
  disconnect: vi.fn(),
  reconnect: vi.fn(),
  cancel: vi.fn(),
}))

vi.mock("@/features/settings/settings-context", () => ({
  useSettings: () => ({
    settings: state.settings,
    updateSettings: state.updateSettings,
    saving: false,
    effectiveTheme: "dark",
  }),
}))

vi.mock("@/hooks/use-app-info", () => ({
  useAppInfo: () => ({
    data: {
      version: "0.1.0",
      platform: "macos",
      arch: "aarch64",
      configDir: "/tmp/config",
      logDir: "/tmp/logs",
    },
  }),
}))

vi.mock("@/features/sessions/hooks/use-session-actions", () => ({
  useSessionActions: () => ({
    disconnect: state.disconnect,
    reconnect: state.reconnect,
    cancel: state.cancel,
  }),
}))

vi.mock("@/features/transfers/api", () => ({
  TRANSFER_HISTORY_QUERY_KEY: ["transfer-history"],
  transfersApi: {
    clearFinished: state.clearFinished,
  },
}))

vi.mock("@/lib/clipboard", () => ({
  copyText: state.copyText,
}))

const settings: AppSettings_Serialize = {
  schemaVersion: 1,
  theme: "dark",
  density: "compact",
  sizeFormat: "binary",
  dateFormat: "friendly",
  showHiddenFiles: false,
  confirmDelete: true,
  transferConcurrency: 3,
  bandwidthLimitKbps: null,
  connectTimeoutSeconds: 30,
  operationTimeoutSeconds: 45,
  sidebarWidth: 260,
  bottomPanelHeight: 200,
  bottomPanelOpen: false,
  paneSplit: 50,
  lastLocalPath: null,
}

function transfer(id: string, status: TransferItem_Serialize["status"]): TransferItem_Serialize {
  return {
    id,
    direction: "upload",
    status,
    sourcePath: `/tmp/${id}`,
    targetPath: `/home/ada/${id}`,
    sourceLabel: "This Mac",
    targetLabel: "Staging",
    name: id,
    size: 100,
    transferred: status === "completed" ? 100 : 0,
    bytesPerSec: 0,
    etaMs: null,
    error: null,
    startedAt: 0,
    finishedAt: null,
  }
}

beforeEach(() => {
  state.settings = { ...settings }
  state.updateSettings.mockReset()
  state.copyText.mockReset()
  state.clearFinished.mockReset().mockResolvedValue(0)
  state.disconnect.mockReset().mockResolvedValue(undefined)
  state.reconnect.mockReset().mockResolvedValue(undefined)
  state.cancel.mockReset().mockResolvedValue(undefined)

  useUiStore.setState({
    paletteOpen: true,
    localSummary: { path: "/tmp/local", items: 2, selected: 0 },
    remoteSummary: { path: "/home/ada", items: 3, selected: 0 },
  })
  useSessionStore.setState({ sessions: {}, order: [], activeSessionId: "session-1" })
  useTransferStore.setState({ items: {}, order: [], paused: false })
})

describe("CommandPalette", () => {
  it("disconnects the active session", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 })
    render(<CommandPalette />)

    await user.click(screen.getByText("Disconnect active session"))

    expect(state.disconnect).toHaveBeenCalledWith("session-1")
    expect(useUiStore.getState().paletteOpen).toBe(false)
  })

  it("copies the remote path", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 })
    render(<CommandPalette />)

    await user.click(screen.getByText("Copy remote path"))

    expect(state.copyText).toHaveBeenCalledWith("/home/ada", "Remote path copied")
  })

  it("clears finished transfers and drops their rows", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 })
    useTransferStore.setState({
      items: { done: transfer("done", "completed"), live: transfer("live", "running") },
      order: ["done", "live"],
      paused: false,
    })
    state.clearFinished.mockResolvedValue(1)
    render(<CommandPalette />)

    await user.click(screen.getByText("Clear finished transfers"))

    await waitFor(() => expect(state.clearFinished).toHaveBeenCalled())
    expect(useTransferStore.getState().order).toEqual(["live"])
  })

  it("disables clearing when no transfer has finished", () => {
    render(<CommandPalette />)

    expect(screen.getByText("Clear finished transfers").closest("[cmdk-item]")).toHaveAttribute(
      "aria-disabled",
      "true",
    )
  })
})
