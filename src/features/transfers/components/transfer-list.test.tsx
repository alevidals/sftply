import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { TooltipProvider } from "@/components/ui/tooltip"
import { TransferList } from "@/features/transfers/components/transfer-list"
import type { TransferItem_Serialize } from "@/lib/ipc/bindings"
import { useTransferStore } from "@/stores/transfer-store"

const cancel = vi.fn().mockResolvedValue(true)
const retry = vi.fn().mockResolvedValue(undefined)
const clearFinished = vi.fn().mockResolvedValue(1)
const pauseQueue = vi.fn().mockResolvedValue(true)
const resumeQueue = vi.fn().mockResolvedValue(false)

vi.mock("@/features/transfers/api", () => ({
  transfersApi: {
    cancel: (...args: unknown[]) => cancel(...args),
    retry: (...args: unknown[]) => retry(...args),
    clearFinished: (...args: unknown[]) => clearFinished(...args),
    pauseQueue: (...args: unknown[]) => pauseQueue(...args),
    resumeQueue: (...args: unknown[]) => resumeQueue(...args),
  },
}))

vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getTotalSize: () => count * 64,
    getVirtualItems: () =>
      Array.from({ length: Math.min(count, 12) }, (_, index) => ({
        index,
        key: index,
        start: index * 64,
        size: 64,
      })),
    measureElement: vi.fn(),
  }),
}))

function item(overrides: Partial<TransferItem_Serialize> = {}): TransferItem_Serialize {
  return {
    id: "t1",
    direction: "download",
    status: "running",
    sourcePath: "/remote/report.pdf",
    targetPath: "/local/report.pdf",
    sourceLabel: "Prod",
    targetLabel: "Local",
    name: "report.pdf",
    size: 1000,
    transferred: 500,
    bytesPerSec: 100,
    etaMs: 5000,
    error: null,
    startedAt: 1,
    finishedAt: null,
    ...overrides,
  }
}

function renderList() {
  return render(
    <TooltipProvider>
      <TransferList />
    </TooltipProvider>,
  )
}

beforeEach(() => {
  useTransferStore.getState().clear()
  cancel.mockClear()
  retry.mockClear()
  clearFinished.mockClear()
  pauseQueue.mockClear()
  resumeQueue.mockClear()
})

describe("TransferList", () => {
  it("renders progress, throughput and destination labels", () => {
    useTransferStore.getState().setAll([item()])
    renderList()

    expect(screen.getByText("report.pdf")).toBeInTheDocument()
    expect(screen.getByText("Transferring")).toBeInTheDocument()
    expect(screen.getByText("Prod → Local")).toBeInTheDocument()
    expect(screen.getByText("1 active · 100 B/s")).toBeInTheDocument()
    expect(screen.getByText("50%")).toBeInTheDocument()
  })

  it("cancels a running transfer", async () => {
    useTransferStore.getState().setAll([item()])
    renderList()

    await userEvent.click(screen.getByRole("button", { name: "Cancel report.pdf" }))
    expect(cancel).toHaveBeenCalledWith("t1")
  })

  it("clears finished rows without removing active ones", async () => {
    useTransferStore.getState().setAll([
      item({ id: "active", name: "active.bin", startedAt: 2 }),
      item({
        id: "done",
        name: "done.bin",
        status: "completed",
        transferred: 1000,
        startedAt: 1,
      }),
    ])
    renderList()

    await userEvent.click(screen.getByRole("button", { name: "Clear finished" }))

    expect(clearFinished).toHaveBeenCalled()
    const state = useTransferStore.getState()
    expect(state.order).toEqual(["active"])
  })

  it("shows a failed transfer's user-safe error", () => {
    useTransferStore
      .getState()
      .setAll([item({ status: "failed", error: "The server refused the file." })])
    renderList()

    expect(screen.getByText("The server refused the file.")).toBeInTheDocument()
    expect(screen.getByText("Failed")).toBeInTheDocument()
  })

  it("retries a failed transfer", async () => {
    useTransferStore.getState().setAll([item({ status: "failed", error: "No route" })])
    renderList()

    await userEvent.click(screen.getByRole("button", { name: "Retry report.pdf" }))
    expect(retry).toHaveBeenCalledWith("t1")
  })

  it("virtualizes a large queue", () => {
    const many = Array.from({ length: 1_000 }, (_, index) =>
      item({ id: `t${index}`, name: `file-${index}.bin`, startedAt: index }),
    )
    useTransferStore.getState().setAll(many)
    renderList()

    expect(screen.getByText("file-999.bin")).toBeInTheDocument()
    expect(screen.queryByText("file-0.bin")).not.toBeInTheDocument()
  })

  it("pauses and resumes the queue", async () => {
    useTransferStore.getState().setAll([item()])
    renderList()

    await userEvent.click(screen.getByRole("button", { name: "Pause queue" }))
    expect(pauseQueue).toHaveBeenCalled()
    expect(useTransferStore.getState().paused).toBe(true)
    expect(screen.getByText("Queue paused")).toBeInTheDocument()

    await userEvent.click(screen.getByRole("button", { name: "Resume queue" }))
    expect(resumeQueue).toHaveBeenCalled()
    expect(useTransferStore.getState().paused).toBe(false)
  })

  it("cancels a running transfer from its context menu", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 })
    useTransferStore.getState().setAll([item()])
    renderList()

    await user.pointer({ keys: "[MouseRight]", target: screen.getByText("report.pdf") })
    await user.click(await screen.findByRole("menuitem", { name: "Cancel transfer" }))

    expect(cancel).toHaveBeenCalledWith("t1")
  })

  it("disables menu actions that do not apply to the current status", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 })
    useTransferStore
      .getState()
      .setAll([item({ status: "completed", transferred: 1000, bytesPerSec: 0 })])
    renderList()

    await user.pointer({ keys: "[MouseRight]", target: screen.getByText("report.pdf") })

    expect(await screen.findByRole("menuitem", { name: "Cancel transfer" })).toHaveAttribute(
      "aria-disabled",
      "true",
    )
    expect(screen.getByRole("menuitem", { name: "Retry transfer" })).toHaveAttribute(
      "aria-disabled",
      "true",
    )
    expect(screen.getByRole("menuitem", { name: "Clear finished transfers" })).not.toHaveAttribute(
      "aria-disabled",
    )
  })

  it("copies both transfer paths from the context menu", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 })
    useTransferStore.getState().setAll([item()])
    renderList()

    await user.pointer({ keys: "[MouseRight]", target: screen.getByText("report.pdf") })
    await user.click(await screen.findByRole("menuitem", { name: "Copy both paths" }))

    await expect(navigator.clipboard.readText()).resolves.toBe(
      "/remote/report.pdf\n/local/report.pdf",
    )
  })

  it("clears finished rows from a row context menu", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 })
    useTransferStore.getState().setAll([
      item(),
      item({
        id: "done",
        name: "done.bin",
        status: "completed",
        transferred: 1000,
        startedAt: 1,
      }),
    ])
    renderList()

    await user.pointer({ keys: "[MouseRight]", target: screen.getByText("report.pdf") })
    await user.click(await screen.findByRole("menuitem", { name: "Clear finished transfers" }))

    expect(clearFinished).toHaveBeenCalled()
  })
})
