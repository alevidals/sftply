import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import {
  DeleteDialog,
  NewFolderDialog,
  PermissionsDialog,
} from "@/features/files/components/file-dialogs"
import { IpcError } from "@/lib/errors"
import type { FsEntry } from "@/lib/ipc/bindings"

const file: FsEntry = {
  name: "alpha.txt",
  path: "/tmp/alpha.txt",
  kind: "file",
  size: 128,
  modifiedAt: 0,
  permissions: 0o644,
  owner: null,
  group: null,
  linkTarget: null,
  hidden: false,
  metadataComplete: true,
}

const folder: FsEntry = {
  ...file,
  name: "reports",
  path: "/tmp/reports",
  kind: "directory",
  size: 0,
  permissions: 0o755,
}

function failure(message: string) {
  return new IpcError({ code: "PERMISSION_DENIED", message, detail: null, retryable: false })
}

describe("NewFolderDialog", () => {
  it("creates a folder and closes on success", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 })
    const onCreate = vi.fn().mockResolvedValue(undefined)
    const onOpenChange = vi.fn()
    render(
      <NewFolderDialog open parentPath="/tmp" onCreate={onCreate} onOpenChange={onOpenChange} />,
    )

    await user.type(screen.getByLabelText("Name"), "reports")
    await user.click(screen.getByRole("button", { name: "Create folder" }))

    await waitFor(() => expect(onCreate).toHaveBeenCalledWith("reports"))
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it("rejects an invalid name without calling the backend", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 })
    const onCreate = vi.fn()
    render(<NewFolderDialog open parentPath="/tmp" onCreate={onCreate} onOpenChange={vi.fn()} />)

    await user.type(screen.getByLabelText("Name"), "bad/name")
    await user.click(screen.getByRole("button", { name: "Create folder" }))

    expect(await screen.findByRole("alert")).toHaveTextContent("cannot contain path separators")
    expect(onCreate).not.toHaveBeenCalled()
  })

  it("shows a backend error and stays open", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 })
    const onCreate = vi.fn().mockRejectedValue(failure("Permission denied"))
    const onOpenChange = vi.fn()
    render(
      <NewFolderDialog open parentPath="/tmp" onCreate={onCreate} onOpenChange={onOpenChange} />,
    )

    await user.type(screen.getByLabelText("Name"), "reports")
    await user.click(screen.getByRole("button", { name: "Create folder" }))

    expect(await screen.findByRole("alert")).toHaveTextContent("Permission denied")
    expect(onOpenChange).not.toHaveBeenCalledWith(false)
  })
})

describe("DeleteDialog", () => {
  it("deletes a single file without recursion", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 })
    const onConfirm = vi.fn().mockResolvedValue(undefined)
    const onOpenChange = vi.fn()
    render(<DeleteDialog open entries={[file]} onConfirm={onConfirm} onOpenChange={onOpenChange} />)

    expect(screen.getByText("Delete “alpha.txt”?")).toBeInTheDocument()
    expect(screen.getByText("This cannot be undone.")).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "Delete" }))
    await waitFor(() => expect(onConfirm).toHaveBeenCalledWith(false))
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it("warns about folders and requests recursive deletion", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 })
    const onConfirm = vi.fn().mockResolvedValue(undefined)
    render(
      <DeleteDialog open entries={[file, folder]} onConfirm={onConfirm} onOpenChange={vi.fn()} />,
    )

    expect(screen.getByText("Delete 2 items?")).toBeInTheDocument()
    expect(screen.getByText(/everything inside them/)).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "Delete" }))
    await waitFor(() => expect(onConfirm).toHaveBeenCalledWith(true))
  })

  it("shows a backend error and stays open", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 })
    const onConfirm = vi.fn().mockRejectedValue(failure("Folder is not empty"))
    const onOpenChange = vi.fn()
    render(
      <DeleteDialog open entries={[folder]} onConfirm={onConfirm} onOpenChange={onOpenChange} />,
    )

    await user.click(screen.getByRole("button", { name: "Delete" }))
    expect(await screen.findByRole("alert")).toHaveTextContent("Folder is not empty")
    expect(onOpenChange).not.toHaveBeenCalledWith(false)
  })
})

describe("PermissionsDialog", () => {
  it("applies the octal mode as a number", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 })
    const onConfirm = vi.fn().mockResolvedValue(undefined)
    const onOpenChange = vi.fn()
    render(
      <PermissionsDialog open entry={folder} onConfirm={onConfirm} onOpenChange={onOpenChange} />,
    )

    const input = screen.getByLabelText("Mode")
    expect(input).toHaveValue("0755")

    fireEvent.change(input, { target: { value: "0700" } })
    await user.click(screen.getByRole("button", { name: "Apply" }))

    await waitFor(() => expect(onConfirm).toHaveBeenCalledWith(0o700))
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it("rejects an invalid mode", () => {
    const onConfirm = vi.fn()
    render(<PermissionsDialog open entry={file} onConfirm={onConfirm} onOpenChange={vi.fn()} />)

    const input = screen.getByLabelText("Mode")
    fireEvent.change(input, { target: { value: "0899" } })

    expect(screen.getByRole("button", { name: "Apply" })).toBeDisabled()
    expect(screen.getByText("Invalid mode")).toBeInTheDocument()
    expect(onConfirm).not.toHaveBeenCalled()
  })
})
