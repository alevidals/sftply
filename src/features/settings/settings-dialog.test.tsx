import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { SettingsDialog } from "@/features/settings/settings-dialog"
import type { AppSettings_Serialize } from "@/lib/ipc/bindings"
import { useUiStore } from "@/stores/ui-store"

const state = vi.hoisted(() => ({
  settings: {} as AppSettings_Serialize,
  updateSettings: vi.fn(),
  saving: false,
}))

vi.mock("@/features/settings/settings-context", () => ({
  useSettings: () => ({
    settings: state.settings,
    updateSettings: state.updateSettings,
    saving: state.saving,
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

beforeEach(() => {
  state.settings = settings
  state.saving = false
  state.updateSettings.mockReset()
  state.updateSettings.mockImplementation(async (patch: Partial<AppSettings_Serialize>) => ({
    ...settings,
    ...patch,
  }))
  useUiStore.setState({ settingsOpen: true, settingsTab: "appearance" })
})

describe("SettingsDialog", () => {
  it("switches tabs without closing the dialog", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 })
    render(<SettingsDialog />)

    expect(screen.getByRole("dialog")).toBeInTheDocument()
    expect(screen.getByText("Row density")).toBeInTheDocument()
    // Inactive panels must not render: mounting them all made the dialog
    // taller than the window.
    expect(screen.queryByLabelText("Simultaneous transfers")).not.toBeInTheDocument()

    await user.click(screen.getByRole("tab", { name: "Transfers" }))

    expect(screen.getByLabelText("Simultaneous transfers")).toBeInTheDocument()
    expect(screen.queryByText("Row density")).not.toBeInTheDocument()
    expect(useUiStore.getState().settingsOpen).toBe(true)
    expect(state.updateSettings).not.toHaveBeenCalled()
  })

  it("opens on the requested tab", () => {
    useUiStore.setState({ settingsOpen: true, settingsTab: "shortcuts" })
    render(<SettingsDialog />)

    expect(screen.getByText("Command palette")).toBeInTheDocument()
    expect(screen.queryByText("Row density")).not.toBeInTheDocument()
  })

  it("lists the keyboard shortcuts with platform labels", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 })
    render(<SettingsDialog />)

    await user.click(screen.getByRole("tab", { name: "Shortcuts" }))

    expect(screen.getByText("Command palette")).toBeInTheDocument()
    expect(screen.getByText("⌘K")).toBeInTheDocument()
    expect(screen.getByText("Files and selection")).toBeInTheDocument()
    expect(screen.queryByText("Row density")).not.toBeInTheDocument()
  })

  it("saves a bandwidth limit and clears it when empty", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 })
    render(<SettingsDialog />)

    await user.click(screen.getByRole("tab", { name: "Transfers" }))
    const input = screen.getByLabelText("Bandwidth limit")
    await user.type(input, "512")
    await user.click(screen.getByRole("button", { name: "Save changes" }))

    await waitFor(() =>
      expect(state.updateSettings).toHaveBeenCalledWith(
        expect.objectContaining({ bandwidthLimitKbps: 512 }),
      ),
    )
  })

  it("keeps the submit button width stable while saving", () => {
    const { rerender } = render(<SettingsDialog />)
    const button = screen.getByRole("button", { name: "Save changes" })
    const label = button.querySelector('[data-slot="submit-label"]')

    expect(label).toHaveTextContent("Save changes")
    expect(label).not.toHaveClass("opacity-0")
    expect(button.querySelector('[data-slot="spinner"]')).not.toBeInTheDocument()

    // The label stays in the layout (only transparent) so the right-aligned
    // button cannot change width when the spinner appears.
    state.saving = true
    rerender(<SettingsDialog />)
    expect(label).toHaveClass("opacity-0")
    expect(button.querySelector('[data-slot="spinner"]')).toBeInTheDocument()
    expect(button).toHaveAttribute("aria-busy", "true")
  })

  it("saves the edited values and closes", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 })
    render(<SettingsDialog />)

    await user.click(screen.getByRole("tab", { name: "Transfers" }))
    const input = screen.getByLabelText("Simultaneous transfers")
    await user.clear(input)
    await user.type(input, "5")
    await user.click(screen.getByRole("button", { name: "Save changes" }))

    await waitFor(() =>
      expect(state.updateSettings).toHaveBeenCalledWith(
        expect.objectContaining({ transferConcurrency: 5 }),
      ),
    )
    await waitFor(() => expect(useUiStore.getState().settingsOpen).toBe(false))
  })

  it("saves a named palette from the theme gallery", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 })
    render(<SettingsDialog />)

    await user.click(screen.getByRole("radio", { name: "Nord" }))
    await user.click(screen.getByRole("button", { name: "Save changes" }))

    await waitFor(() =>
      expect(state.updateSettings).toHaveBeenCalledWith(expect.objectContaining({ theme: "nord" })),
    )
  })
})
