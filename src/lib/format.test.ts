import { describe, expect, it } from "vitest"
import {
  formatBytes,
  formatClock,
  formatCount,
  formatMode,
  formatModeSymbolic,
  formatModified,
  formatPercent,
} from "@/lib/format"

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

  it("keeps large values in the right unit", () => {
    // Values above 4 GiB must not wrap or fall back to a smaller unit.
    expect(formatBytes(5 * 1024 ** 3)).toBe("5.00 GB")
    expect(formatBytes(1024 ** 4)).toBe("1.00 TB")
    expect(formatBytes(Number.MAX_SAFE_INTEGER)).toBe("8.00 PB")
  })

  it("handles invalid values honestly", () => {
    expect(formatBytes(-1)).toBe("—")
    expect(formatBytes(Number.NaN)).toBe("—")
  })

  it("switches to decimal units when requested", () => {
    expect(formatBytes(999, "decimal")).toBe("999 B")
    expect(formatBytes(1000, "decimal")).toBe("1.00 KB")
    expect(formatBytes(1500, "decimal")).toBe("1.50 KB")
    expect(formatBytes(1024, "decimal")).toBe("1.02 KB")
    expect(formatBytes(1_000_000, "decimal")).toBe("1.00 MB")
    expect(formatBytes(5 * 1000 ** 3, "decimal")).toBe("5.00 GB")
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

describe("formatMode", () => {
  it("renders four-digit octal permissions", () => {
    expect(formatMode(0o644)).toBe("0644")
    expect(formatMode(0o7777)).toBe("7777")
    expect(formatMode(null)).toBe("—")
  })

  it("renders symbolic permissions including special bits", () => {
    expect(formatModeSymbolic(0o644)).toBe("-rw-r--r--")
    expect(formatModeSymbolic(0o755, true)).toBe("drwxr-xr-x")
    expect(formatModeSymbolic(0o4755)).toBe("-rwsr-xr-x")
    expect(formatModeSymbolic(0o4644)).toBe("-rwSr--r--")
    expect(formatModeSymbolic(0o1777, true)).toBe("drwxrwxrwt")
    expect(formatModeSymbolic(null)).toBe("—")
  })
})

describe("formatModified", () => {
  it("formats timestamps and hides missing values", () => {
    expect(formatModified(1_700_000_000_000)).toMatch(/\d/)
    expect(formatModified(null)).toBe("—")
    expect(formatModified(Number.NaN)).toBe("—")
  })

  it("renders an unambiguous ISO timestamp when requested", () => {
    const date = new Date(2026, 0, 5, 9, 7)
    expect(formatModified(date.getTime(), "iso")).toBe("2026-01-05 09:07")
    expect(formatModified(null, "iso")).toBe("—")
  })
})
