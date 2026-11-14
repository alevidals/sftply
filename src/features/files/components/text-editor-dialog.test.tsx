import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { TextEditorDialog } from "@/features/files/components/text-editor-dialog"
import { IpcError } from "@/lib/errors"
import type { FsEntry, TextFile } from "@/lib/ipc/bindings"

const mocks = vi.hoisted(() => ({ readText: vi.fn(), writeText: vi.fn() }))

vi.mock("@/features/files/api", () => ({
  filesApi: () => ({ readText: mocks.readText, writeText: mocks.writeText }),
}))

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), info: vi.fn(), error: vi.fn() },
}))

const entry: FsEntry = {
  name: "notes.txt",
  path: "/tmp/notes.txt",
  kind: "file",
  size: 11,
  modifiedAt: 1_700_000_000_000,
  permissions: 0o644,
  owner: null,
  group: null,
  linkTarget: null,
  hidden: false,
  metadataComplete: true,
}

const loaded: TextFile = {
  path: "/tmp/notes.txt",
  content: "first line\n",
  size: 11,
  modifiedAt: 1_700_000_000_000,
  version: "11:1700000000000",
}

function conflict() {
  return new IpcError({
    code: "CONFLICT",
    message: "The file changed on disk since it was opened.",
    detail: null,
    retryable: false,
  })
}

function footerCloseButton(): HTMLElement {
  const [button] = screen.getAllByRole("button", { name: "Close" })
  if (!button) throw new Error("Expected a footer Close button")
  return button
}

function renderEditor(overrides: { canWrite?: boolean } = {}) {
  const onOpenChange = vi.fn()
  const onSaved = vi.fn()
  render(
    <TextEditorDialog
      open
      entry={entry}
      scope={{ kind: "remote", sessionId: "s1" }}
      canWrite={overrides.canWrite ?? true}
      onOpenChange={onOpenChange}
      onSaved={onSaved}
    />,
  )
  return { onOpenChange, onSaved }
}

beforeEach(() => {
  mocks.readText.mockReset()
  mocks.writeText.mockReset()
})

describe("TextEditorDialog", () => {
  it("loads a file and saves edits with the version observed at load", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 })
    mocks.readText.mockResolvedValue(loaded)
    mocks.writeText.mockResolvedValue({
      ...loaded,
      content: "second line\n",
      size: 12,
      version: "12:1700000001000",
    })
    const { onSaved } = renderEditor()

    const textarea = await screen.findByLabelText("File contents")
    await waitFor(() => expect(textarea).toHaveValue("first line\n"))

    await user.clear(textarea)
    await user.type(textarea, "second line")
    await user.click(screen.getByRole("button", { name: "Save" }))

    await waitFor(() =>
      expect(mocks.writeText).toHaveBeenCalledWith(
        "/tmp/notes.txt",
        "second line",
        "11:1700000000000",
        false,
      ),
    )
    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ content: "second line\n" }))
  })

  it("reports a conflict and offers reload or overwrite", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 })
    mocks.readText.mockResolvedValue(loaded)
    mocks.writeText.mockRejectedValueOnce(conflict()).mockResolvedValueOnce({
      ...loaded,
      content: "forced\n",
      size: 7,
      version: "7:1700000002000",
    })
    renderEditor()

    const textarea = await screen.findByLabelText("File contents")
    await waitFor(() => expect(textarea).toHaveValue("first line\n"))
    await user.type(textarea, "forced")
    await user.click(screen.getByRole("button", { name: "Save" }))

    expect(await screen.findByText(/The file changed since you opened it/)).toBeTruthy()
    await user.click(screen.getByRole("button", { name: "Overwrite" }))

    await waitFor(() =>
      expect(mocks.writeText).toHaveBeenLastCalledWith(
        "/tmp/notes.txt",
        expect.any(String),
        null,
        true,
      ),
    )
  })

  it("is read-only when the pane cannot write text", async () => {
    mocks.readText.mockResolvedValue(loaded)
    renderEditor({ canWrite: false })

    const textarea = await screen.findByLabelText("File contents")
    await waitFor(() => expect(textarea).toHaveValue("first line\n"))

    expect(textarea).toHaveAttribute("readonly")
    expect(screen.getByText(/cannot save text files/i)).toBeTruthy()
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled()
  })

  it("asks before discarding unsaved changes", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 })
    mocks.readText.mockResolvedValue(loaded)
    const { onOpenChange } = renderEditor()

    const textarea = await screen.findByLabelText("File contents")
    await waitFor(() => expect(textarea).toHaveValue("first line\n"))
    fireEvent.change(textarea, { target: { value: "changed" } })

    // The header also renders an icon-only "Close" button; the footer one is
    // first in DOM order and is the button this test exercises.
    await user.click(footerCloseButton())
    expect(screen.getByText("Discard your changes?")).toBeTruthy()
    expect(onOpenChange).not.toHaveBeenCalled()

    await user.click(screen.getByRole("button", { name: "Keep editing" }))
    expect(screen.queryByText("Discard your changes?")).toBeNull()

    await user.click(footerCloseButton())
    await user.click(screen.getByRole("button", { name: "Discard" }))
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it("shows a load error and retries", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 })
    mocks.readText
      .mockRejectedValueOnce(
        new IpcError({
          code: "UNSUPPORTED",
          message: "This looks like a binary file.",
          detail: null,
          retryable: false,
        }),
      )
      .mockResolvedValueOnce(loaded)
    renderEditor()

    expect(await screen.findByText("This looks like a binary file.")).toBeTruthy()
    await user.click(screen.getByRole("button", { name: "Try again" }))
    await waitFor(() => expect(screen.getByLabelText("File contents")).toHaveValue("first line\n"))
  })
})
