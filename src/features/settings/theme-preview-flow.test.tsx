import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { SettingsDialog } from "@/features/settings/settings-dialog"
import type { AppSettings_Serialize } from "@/lib/ipc/bindings"
import { useUiStore } from "@/stores/ui-store"

const state = vi.hoisted(() => ({
  themes: [] as Array<{ id: string; name: string; dark: boolean; colors: Record<string, string> }>,
  save: vi.fn(),
  reload: vi.fn(),
}))

vi.mock("@/lib/ipc/client", () => ({
  ipc: {
    openLogs: vi.fn(),
    themeSave: state.save,
    themeOpenFile: vi.fn(),
  },
}))

vi.mock("@/features/settings/settings-context", () => ({
  useSettings: () => ({
    settings: settings,
    updateSettings: vi.fn(async (patch: Partial<AppSettings_Serialize>) => ({
      ...settings,
      ...patch,
    })),
    saving: false,
    themes: state.themes,
    themeWarnings: [],
    reloadThemes: state.reload,
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

const settings: AppSettings_Serialize = {
  schemaVersion: 1,
  theme: "dark",
  density: "compact",
  sizeFormat: "binary",
  dateFormat: "friendly",
  showHiddenFiles: false,
  confirmDelete: true,
  preservePermissions: false,
  transferConcurrency: 3,
  bandwidthLimitKbps: null,
  connectTimeoutSeconds: 30,
  operationTimeoutSeconds: 45,
  sidebarWidth: 260,
  bottomPanelHeight: 200,
  bottomPanelOpen: false,
  paneSplit: 50,
  lastLocalPath: null,
  remoteBookmarks: {},
  recentPaths: {},
}

const themeTwo = {
  id: "custom:two",
  name: "Theme two",
  dark: true,
  colors: { background: "#303030", foreground: "#f0f0f0", primary: "#ff8844" },
}

const saved = {
  id: "custom:new",
  name: "New theme",
  dark: true,
  colors: { background: "#202020", foreground: "#f0f0f0", primary: "#44ff88" },
}

beforeEach(() => {
  document.documentElement.classList.add("dark")
  document.documentElement.dataset.theme = "dark"
  window.matchMedia = vi.fn().mockReturnValue({
    matches: true,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }) as unknown as typeof window.matchMedia
  state.themes = [themeTwo]
  state.save.mockReset()
  state.save.mockResolvedValue(saved)
  state.reload.mockReset()
  state.reload.mockResolvedValue(undefined)
  useUiStore.setState({ settingsOpen: true, settingsTab: "appearance" })
})

describe("theme preview flow", () => {
  it("keeps the new theme applied after saving it from the editor", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 })
    render(<SettingsDialog />)

    await user.click(screen.getByText("Theme two"))
    await user.click(screen.getByRole("button", { name: "New" }))
    await user.clear(screen.getByLabelText("Name"))
    await user.type(screen.getByLabelText("Name"), "New theme")
    await user.click(screen.getByRole("button", { name: "Save theme" }))

    await waitFor(() => expect(state.save).toHaveBeenCalledTimes(1))
    await waitFor(() =>
      expect(document.documentElement.style.getPropertyValue("--background")).toBe("#202020"),
    )
    expect(document.documentElement.dataset.theme).toBe("custom")
  })
})
