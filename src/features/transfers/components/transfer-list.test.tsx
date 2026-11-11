import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { TooltipProvider } from "@/components/ui/tooltip"
import { TransferList } from "@/features/transfers/components/transfer-list"
import type { TransferItem_Serialize } from "@/lib/ipc/bindings"
import { useTransferStore } from "@/stores/transfer-store"

const cancel = vi.fn().mockResolvedValue(true)
const clearFinished = vi.fn().mockResolvedValue(1)

vi.mock("@/features/transfers/api", () => ({
  transfersApi: {
    cancel: (...args: unknown[]) => cancel(...args),
    clearFinished: (...args: unknown[]) => clearFinished(...args),
  },
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
  clearFinished.mockClear()
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
})
