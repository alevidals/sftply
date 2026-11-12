import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { ReactNode } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { TransferHistoryList } from "@/features/transfers/components/transfer-history"
import type { TransferHistoryEntry_Serialize } from "@/lib/ipc/bindings"

const historyMock = vi.fn()
const clearMock = vi.fn()

vi.mock("@/features/transfers/api", () => ({
  TRANSFER_HISTORY_QUERY_KEY: ["transfer-history"],
  transfersApi: {
    history: () => historyMock(),
    clearHistory: () => clearMock(),
  },
}))

function entry(
  overrides: Partial<TransferHistoryEntry_Serialize> = {},
): TransferHistoryEntry_Serialize {
  return {
    id: "h1",
    name: "report.pdf",
    direction: "upload",
    status: "completed",
    sourceLabel: "This Mac",
    targetLabel: "Test server",
    size: 2_048,
    transferred: 2_048,
    error: null,
    startedAt: 1,
    finishedAt: 2,
    ...overrides,
  }
}

function renderHistory() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
  return render(<TransferHistoryList />, { wrapper })
}

beforeEach(() => {
  historyMock.mockReset().mockResolvedValue([entry()])
  clearMock.mockReset().mockResolvedValue(1)
})

describe("TransferHistoryList", () => {
  it("lists finished transfers with their status", async () => {
    historyMock.mockResolvedValue([
      entry(),
      entry({ id: "h2", name: "broken.bin", status: "failed", error: "The server closed" }),
    ])
    renderHistory()

    expect(await screen.findByText("report.pdf")).toBeInTheDocument()
    expect(screen.getByText("broken.bin")).toBeInTheDocument()
    expect(screen.getByText("Completed")).toBeInTheDocument()
    expect(screen.getByText("Failed")).toBeInTheDocument()
    expect(screen.getByText("2 entries")).toBeInTheDocument()
  })

  it("clears the history and shows the empty state", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 })
    renderHistory()

    await screen.findByText("report.pdf")
    await user.click(screen.getByRole("button", { name: "Clear history" }))

    await waitFor(() => expect(clearMock).toHaveBeenCalledTimes(1))
    expect(await screen.findByText("No finished transfers")).toBeInTheDocument()
  })

  it("explains when there is nothing recorded yet", async () => {
    historyMock.mockResolvedValue([])
    renderHistory()

    expect(await screen.findByText("No finished transfers")).toBeInTheDocument()
  })
})
