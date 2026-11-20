import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { ThemeEditorDialog } from "@/features/settings/theme-editor-dialog"
import { IpcError } from "@/lib/errors"
import type { CustomTheme } from "@/lib/ipc/bindings"

const state = vi.hoisted(() => ({
  save: vi.fn(),
  openFile: vi.fn(),
}))

vi.mock("@/lib/ipc/client", () => ({
  ipc: {
    themeSave: state.save,
    themeOpenFile: state.openFile,
  },
}))

vi.mock("@/features/settings/settings-context", () => ({
  useSettings: () => ({
    settings: { theme: "dark" },
    themes: [],
  }),
}))

const saved: CustomTheme = {
  id: "custom:test",
  name: "Test",
  dark: true,
  colors: {},
}

beforeEach(() => {
  document.documentElement.classList.add("dark")
  window.matchMedia = vi.fn().mockReturnValue({
    matches: true,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }) as unknown as typeof window.matchMedia
  state.save.mockReset()
  state.openFile.mockReset()
  state.save.mockResolvedValue(saved)
})

describe("ThemeEditorDialog", () => {
  it("saves the explicit token map from the editor", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 })
    const onSaved = vi.fn()
    render(<ThemeEditorDialog open theme={null} onOpenChange={vi.fn()} onSaved={onSaved} />)

    expect(screen.getByLabelText("Variant")).toHaveAccessibleDescription(
      /Match it to the palette's overall lightness/i,
    )
    const name = screen.getByLabelText("Name")
    await user.clear(name)
    await user.type(name, "Test")
    await user.click(screen.getByRole("button", { name: "Save theme" }))

    await waitFor(() => expect(state.save).toHaveBeenCalledTimes(1))
    const [id, nameValue, dark, colors] = state.save.mock.calls[0] ?? []
    expect(id).toBeNull()
    expect(nameValue).toBe("Test")
    expect(dark).toBe(true)
    expect(Object.keys(colors)).toHaveLength(34)
    expect(onSaved).toHaveBeenCalledWith(saved)
  })

  it("shows save errors outside the scroll area, next to the actions", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 })
    state.save.mockRejectedValue(
      new IpcError({
        code: "ALREADY_EXISTS",
        message: "A theme with this name already exists.",
        retryable: false,
      }),
    )
    render(<ThemeEditorDialog open theme={null} onOpenChange={vi.fn()} onSaved={vi.fn()} />)

    await user.click(screen.getByRole("button", { name: "Save theme" }))

    const alert = await screen.findByRole("alert")
    expect(alert).toHaveTextContent("A theme with this name already exists.")
    expect(alert.closest('[data-slot="dialog-header"]')).toBeNull()
    expect(alert.closest(".overflow-y-auto")).toBeNull()
    expect(alert.nextElementSibling).toHaveAttribute("data-slot", "dialog-footer")
  })
})
