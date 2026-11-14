import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import { BookmarksDialog } from "@/features/files/components/bookmarks-dialog"

function setup(overrides: Partial<React.ComponentProps<typeof BookmarksDialog>> = {}) {
  const props: React.ComponentProps<typeof BookmarksDialog> = {
    open: true,
    onOpenChange: vi.fn(),
    currentPath: "/home/ada",
    bookmarks: ["/var/log", "/etc"],
    recent: ["/tmp", "/opt"],
    isBookmarked: false,
    onToggleBookmark: vi.fn(),
    onRemoveBookmark: vi.fn(),
    onNavigate: vi.fn(),
    onClearRecent: vi.fn(),
    ...overrides,
  }
  render(<BookmarksDialog {...props} />)
  return props
}

describe("BookmarksDialog", () => {
  it("lists bookmarks and recent folders", () => {
    setup()

    expect(screen.getByText("/var/log")).toBeInTheDocument()
    expect(screen.getByText("/etc")).toBeInTheDocument()
    expect(screen.getAllByText("/home/ada").length).toBeGreaterThan(0)
    expect(screen.getByText("/tmp")).toBeInTheDocument()
    expect(screen.getByText("/opt")).toBeInTheDocument()
  })

  it("navigates to a bookmark and closes the dialog", async () => {
    const user = userEvent.setup()
    const props = setup()

    await user.click(screen.getByRole("button", { name: "/var/log" }))

    expect(props.onNavigate).toHaveBeenCalledWith("/var/log")
    expect(props.onOpenChange).toHaveBeenCalledWith(false)
  })

  it("toggles the current folder bookmark", async () => {
    const user = userEvent.setup()
    const props = setup()

    await user.click(screen.getByRole("button", { name: "Bookmark" }))
    expect(props.onToggleBookmark).toHaveBeenCalledOnce()
  })

  it("offers to remove the current folder when it is bookmarked", async () => {
    const user = userEvent.setup()
    const props = setup({ isBookmarked: true })

    await user.click(screen.getByRole("button", { name: "Remove bookmark" }))
    expect(props.onToggleBookmark).toHaveBeenCalledOnce()
  })

  it("removes a saved bookmark", async () => {
    const user = userEvent.setup()
    const props = setup()

    await user.click(screen.getByRole("button", { name: "Remove bookmark /var/log" }))
    expect(props.onRemoveBookmark).toHaveBeenCalledWith("/var/log")
  })

  it("clears recent folders", async () => {
    const user = userEvent.setup()
    const props = setup()

    await user.click(screen.getByRole("button", { name: "Clear" }))
    expect(props.onClearRecent).toHaveBeenCalledOnce()
  })

  it("shows empty states", () => {
    setup({ bookmarks: [], recent: [] })

    expect(screen.getByText(/No bookmarks yet/)).toBeInTheDocument()
    expect(screen.getByText("Folders you visit appear here.")).toBeInTheDocument()
  })
})
