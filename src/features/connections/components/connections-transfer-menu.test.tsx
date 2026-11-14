import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { ConnectionsTransferMenu } from "@/features/connections/components/connections-transfer-menu"

const openDialog = vi.fn()
const saveDialog = vi.fn()
const exportTo = vi.fn()
const importFrom = vi.fn()
const success = vi.fn()
const warning = vi.fn()
const error = vi.fn()
const recordActivity = vi.fn()

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: (...args: unknown[]) => openDialog(...args),
  save: (...args: unknown[]) => saveDialog(...args),
}))

vi.mock("@/features/connections/api", () => ({
  connectionsApi: {
    exportTo: (...args: unknown[]) => exportTo(...args),
    importFrom: (...args: unknown[]) => importFrom(...args),
  },
}))

vi.mock("sonner", () => ({
  toast: {
    success: (...args: unknown[]) => success(...args),
    warning: (...args: unknown[]) => warning(...args),
    error: (...args: unknown[]) => error(...args),
  },
}))

vi.mock("@/stores/activity-store", () => ({
  recordActivity: (...args: unknown[]) => recordActivity(...args),
}))

function renderMenu(connectionCount = 2, onChanged = vi.fn()) {
  render(<ConnectionsTransferMenu connectionCount={connectionCount} onChanged={onChanged} />)
  return { onChanged }
}

async function openMenu() {
  await userEvent.click(screen.getByRole("button", { name: "Connection import and export" }))
}

describe("ConnectionsTransferMenu", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("exports to the chosen path and reports the count", async () => {
    saveDialog.mockResolvedValue("/home/me/sftply-connections.json")
    exportTo.mockResolvedValue({ path: "/home/me/sftply-connections.json", count: 3 })

    renderMenu()
    await openMenu()
    await userEvent.click(screen.getByRole("menuitem", { name: "Export connections…" }))

    expect(exportTo).toHaveBeenCalledWith("/home/me/sftply-connections.json")
    expect(success).toHaveBeenCalledWith("Exported 3 connections", expect.anything())
  })

  it("does nothing when the save dialog is cancelled", async () => {
    saveDialog.mockResolvedValue(null)

    renderMenu()
    await openMenu()
    await userEvent.click(screen.getByRole("menuitem", { name: "Export connections…" }))

    expect(exportTo).not.toHaveBeenCalled()
    expect(success).not.toHaveBeenCalled()
  })

  it("disables export when there is nothing to export", async () => {
    renderMenu(0)
    await openMenu()

    expect(screen.getByRole("menuitem", { name: "Export connections…" })).toHaveAttribute(
      "data-disabled",
    )
  })

  it("imports the chosen file, refreshes and reports skips", async () => {
    openDialog.mockResolvedValue("/home/me/sftply-connections.json")
    importFrom.mockResolvedValue({
      imported: 2,
      skipped: 1,
      problems: ["“Staging” was skipped: it already exists as “Staging (old)”."],
    })

    const { onChanged } = renderMenu()
    await openMenu()
    await userEvent.click(screen.getByRole("menuitem", { name: "Import connections…" }))

    expect(importFrom).toHaveBeenCalledWith("/home/me/sftply-connections.json")
    expect(onChanged).toHaveBeenCalled()
    expect(warning).toHaveBeenCalledWith("Imported 2 connections", {
      description: "“Staging” was skipped: it already exists as “Staging (old)”.",
    })
  })

  it("reports an import failure without refreshing the list", async () => {
    openDialog.mockResolvedValue("/home/me/broken.json")
    importFrom.mockRejectedValue({
      code: "INVALID_INPUT",
      message: "That file is not a sftply connections export.",
      detail: null,
      retryable: false,
    })

    const { onChanged } = renderMenu()
    await openMenu()
    await userEvent.click(screen.getByRole("menuitem", { name: "Import connections…" }))

    expect(onChanged).not.toHaveBeenCalled()
    expect(error).toHaveBeenCalledWith(
      "Could not import those connections",
      expect.objectContaining({
        description: "That file is not a sftply connections export.",
      }),
    )
  })
})
