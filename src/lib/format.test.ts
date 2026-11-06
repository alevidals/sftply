import { describe, expect, it } from "vitest"
import { formatBytes, formatClock, formatCount, formatPercent } from "@/lib/format"

describe("formatBytes", () => {
  it("formats raw bytes without a decimal", () => {
    expect(formatBytes(0)).toBe("0 B")
    expect(formatBytes(512)).toBe("512 B")
  })

  it("uses binary units with sensible precision", () => {
    expect(formatBytes(1024)).toBe("1.00 KB")
    expect(formatBytes(1536)).toBe("1.50 KB")
    expect(formatBytes(1024 * 1024)).toBe("1.00 MB")
    expect(formatBytes(10 * 1024 * 1024)).toBe("10.0 MB")
    expect(formatBytes(100 * 1024 * 1024)).toBe("100 MB")
  })

  it("handles invalid values honestly", () => {
    expect(formatBytes(-1)).toBe("—")
    expect(formatBytes(Number.NaN)).toBe("—")
  })
})

describe("formatCount", () => {
  it("uses the runtime locale", () => {
    expect(formatCount(1234)).toBe(new Intl.NumberFormat().format(1234))
    expect(formatCount(Number.POSITIVE_INFINITY)).toBe("—")
  })
})

describe("formatClock", () => {
  it("renders a local wall-clock time", () => {
    expect(formatClock(1_700_000_000_000)).toMatch(/\d{1,2}:\d{2}/)
    expect(formatClock(Number.NaN)).toBe("—")
  })
})

describe("formatPercent", () => {
  it("rounds and clamps display formatting", () => {
    expect(formatPercent(49.6)).toBe("50%")
    expect(formatPercent(Number.NaN)).toBe("—")
  })
})
