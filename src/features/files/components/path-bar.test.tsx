import { fireEvent, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { TooltipProvider } from "@/components/ui/tooltip"
import { PathBar } from "@/features/files/components/path-bar"
import { useUiStore } from "@/stores/ui-store"

function renderPathBar(pane: "local" | "remote", onHome?: () => void) {
  return render(
    <TooltipProvider>
      <PathBar
        pane={pane}
        path="/srv/app"
        canBack={false}
        canForward={false}
        canUp
        onBack={vi.fn()}
        onForward={vi.fn()}
        onUp={vi.fn()}
        onHome={onHome}
        onNavigate={vi.fn()}
        onSubmitPath={vi.fn()}
      />
    </TooltipProvider>,
  )
}

describe("PathBar", () => {
  beforeEach(() => {
    useUiStore.setState({ activePane: "local", paletteOpen: false, settingsOpen: false })
  })

  it("only opens the path editor of the active pane on mod+L", () => {
    renderPathBar("local")
    fireEvent.keyDown(window, { key: "l", code: "KeyL", ctrlKey: true })
    expect(screen.getByLabelText("Folder path")).toBeInTheDocument()
  })

  it("ignores mod+L in the pane that is not active", () => {
    useUiStore.setState({ activePane: "remote" })
    renderPathBar("local")
    fireEvent.keyDown(window, { key: "l", code: "KeyL", ctrlKey: true })
    expect(screen.queryByLabelText("Folder path")).not.toBeInTheDocument()
  })

  it("shows a home button only when the pane has one", async () => {
    const onHome = vi.fn()
    renderPathBar("local", onHome)

    await userEvent.click(screen.getByRole("button", { name: "Home folder" }))
    expect(onHome).toHaveBeenCalled()
  })

  it("hides the home button on the remote pane", () => {
    renderPathBar("remote")
    expect(screen.queryByRole("button", { name: "Home folder" })).not.toBeInTheDocument()
  })

  it("offers folder completions and navigates to the chosen one", async () => {
    const onSubmitPath = vi.fn()
    const suggestPath = vi.fn().mockResolvedValue(["/srv/app/api", "/srv/app/assets"])

    render(
      <TooltipProvider>
        <PathBar
          pane="remote"
          path="/srv/app"
          canBack={false}
          canForward={false}
          canUp
          onBack={vi.fn()}
          onForward={vi.fn()}
          onUp={vi.fn()}
          onNavigate={vi.fn()}
          onSubmitPath={onSubmitPath}
          suggestPath={suggestPath}
        />
      </TooltipProvider>,
    )

    await userEvent.click(screen.getByRole("button", { name: "Edit folder path" }))
    const input = screen.getByLabelText("Folder path")
    await userEvent.type(input, "/a")

    const first = await screen.findByRole("option", { name: "/srv/app/api" })
    expect(screen.getByRole("option", { name: "/srv/app/assets" })).toBeInTheDocument()
    expect(suggestPath).toHaveBeenLastCalledWith("/srv/app/a")

    await userEvent.click(first)
    expect(onSubmitPath).toHaveBeenCalledWith("/srv/app/api")
  })
})
