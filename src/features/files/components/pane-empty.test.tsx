import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import { PaneEmpty } from "@/features/files/components/pane-empty"

describe("PaneEmpty", () => {
  it("offers a new folder only when the server allows it", async () => {
    const user = userEvent.setup()
    const onNewFolder = vi.fn()
    render(
      <PaneEmpty filtered={false} canCreate onNewFolder={onNewFolder} onClearFilter={vi.fn()} />,
    )

    expect(screen.getByText("This folder is empty")).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "New folder" }))
    expect(onNewFolder).toHaveBeenCalledOnce()
  })

  it("offers folders and files together when the pane can create both", async () => {
    const user = userEvent.setup()
    const onNewFolder = vi.fn()
    const onNewFile = vi.fn()
    render(
      <PaneEmpty
        filtered={false}
        canCreate
        canCreateFile
        onNewFolder={onNewFolder}
        onNewFile={onNewFile}
        onClearFilter={vi.fn()}
      />,
    )

    await user.click(screen.getByRole("button", { name: "New" }))
    expect(screen.getByRole("menuitem", { name: /New folder/ })).toBeInTheDocument()
    await user.click(screen.getByRole("menuitem", { name: /New file in sftply/ }))
    expect(onNewFile).toHaveBeenCalledWith("editor")
  })

  it("hides the new folder action when the server cannot create folders", () => {
    render(
      <PaneEmpty
        filtered={false}
        canCreate={false}
        onNewFolder={vi.fn()}
        onClearFilter={vi.fn()}
      />,
    )

    expect(screen.queryByRole("button", { name: "New folder" })).not.toBeInTheDocument()
    expect(screen.getByText(/Create a folder/)).toBeInTheDocument()
  })

  it("offers clearing the filter instead of creating folders", async () => {
    const user = userEvent.setup()
    const onClearFilter = vi.fn()
    render(<PaneEmpty filtered canCreate onNewFolder={vi.fn()} onClearFilter={onClearFilter} />)

    expect(screen.getByText("No matching items")).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Clear filter" }))
    expect(onClearFilter).toHaveBeenCalledOnce()
  })
})
