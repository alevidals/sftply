import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, renderHook, waitFor } from "@testing-library/react"
import type { ReactNode } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { TRANSFER_HISTORY_QUERY_KEY } from "@/features/transfers/api"
import { useTransferBridge } from "@/hooks/use-transfer-bridge"
import type { TransferDeltaEvent, TransferItem_Serialize } from "@/lib/ipc/bindings"

let deltaHandler: ((event: TransferDeltaEvent) => void) | null = null
const listMock = vi.fn()
const queuePausedMock = vi.fn()

vi.mock("@/features/transfers/api", () => ({
  TRANSFER_HISTORY_QUERY_KEY: ["transfer-history"],
  transfersApi: {
    list: () => listMock(),
    queuePaused: () => queuePausedMock(),
  },
}))

vi.mock("@/lib/ipc/events", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ipc/events")>()
  return {
    ...actual,
    onTransferDelta: (handler: (event: TransferDeltaEvent) => void) => {
      deltaHandler = handler
      return Promise.resolve(() => {
        deltaHandler = null
      })
    },
  }
})

function item(overrides: Partial<TransferItem_Serialize> = {}): TransferItem_Serialize {
  return {
    id: "t1",
    direction: "upload",
    status: "completed",
    sourcePath: "/local/a.txt",
    targetPath: "/remote/a.txt",
    sourceLabel: "Local",
    targetLabel: "Test server",
    name: "a.txt",
    size: 10,
    transferred: 10,
    bytesPerSec: 0,
    etaMs: null,
    error: null,
    startedAt: 1,
    finishedAt: 2,
    ...overrides,
  }
}

beforeEach(() => {
  deltaHandler = null
  listMock.mockReset().mockResolvedValue([])
  queuePausedMock.mockReset().mockResolvedValue(false)
})

describe("useTransferBridge", () => {
  it("refreshes file listings after a transfer reaches a terminal state", async () => {
    const queryClient = new QueryClient()
    const invalidate = vi.spyOn(queryClient, "invalidateQueries")
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    )

    renderHook(() => useTransferBridge(), { wrapper })
    await waitFor(() => expect(deltaHandler).not.toBeNull())

    act(() => {
      deltaHandler?.({ upserts: [item()], removed: [] })
    })

    await waitFor(() =>
      expect(invalidate).toHaveBeenCalledWith({
        queryKey: ["fs"],
      }),
    )
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: TRANSFER_HISTORY_QUERY_KEY,
    })
  })

  it("does not refresh while a transfer is still running", async () => {
    const queryClient = new QueryClient()
    const invalidate = vi.spyOn(queryClient, "invalidateQueries")
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    )

    renderHook(() => useTransferBridge(), { wrapper })
    await waitFor(() => expect(deltaHandler).not.toBeNull())

    act(() => {
      deltaHandler?.({ upserts: [item({ status: "running" })], removed: [] })
    })

    await new Promise((resolve) => setTimeout(resolve, 300))
    expect(invalidate).not.toHaveBeenCalled()
  })
})
