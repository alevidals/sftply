import { act, render } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { useDebouncedSettingsPatch } from "@/hooks/use-debounced-settings"
import type { AppSettings_Serialize } from "@/lib/ipc/bindings"

const updateSettings = vi.fn()

vi.mock("@/features/settings/settings-context", () => ({
  useSettings: () => ({ updateSettings }),
}))

vi.mock("sonner", () => ({
  toast: { error: vi.fn() },
}))

type Patch = Partial<AppSettings_Serialize>

let persist: (patch: Patch) => void

function Harness() {
  persist = useDebouncedSettingsPatch()
  return null
}

describe("useDebouncedSettingsPatch", () => {
  beforeEach(() => {
    updateSettings.mockReset()
    updateSettings.mockResolvedValue({})
    vi.useRealTimers()
  })

  it("merges patches within the debounce window into one write", () => {
    vi.useFakeTimers()
    render(<Harness />)

    act(() => {
      persist({ lastLocalPath: "/tmp/a" })
      persist({ showHiddenFiles: true })
    })
    expect(updateSettings).not.toHaveBeenCalled()

    act(() => {
      vi.advanceTimersByTime(500)
    })
    expect(updateSettings).toHaveBeenCalledTimes(1)
    expect(updateSettings).toHaveBeenCalledWith({ lastLocalPath: "/tmp/a", showHiddenFiles: true })
  })

  it("flushes a pending patch when the component unmounts", () => {
    const { unmount } = render(<Harness />)

    act(() => {
      persist({ sidebarWidth: 300 })
    })
    unmount()

    expect(updateSettings).toHaveBeenCalledWith({ sidebarWidth: 300 })
  })
})
