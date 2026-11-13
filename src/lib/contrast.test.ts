import { describe, expect, it } from "vitest"
import {
  composite,
  contrastOver,
  contrastRatio,
  parseColor,
  relativeLuminance,
} from "@/lib/contrast"

describe("parseColor", () => {
  it("parses hex colors with and without alpha", () => {
    expect(parseColor("#fff")).toEqual({ r: 1, g: 1, b: 1, a: 1 })
    expect(parseColor("#00000080").a).toBeCloseTo(0.5, 2)
    expect(parseColor("#ff0000")).toMatchObject({ r: 1, g: 0, b: 0 })
  })

  it("parses oklch lightness and alpha", () => {
    const white = parseColor("oklch(1 0 0)")
    expect(white.r).toBeCloseTo(1, 2)
    expect(white.g).toBeCloseTo(1, 2)
    expect(white.b).toBeCloseTo(1, 2)
    expect(parseColor("oklch(0.5 0 0 / 50%)").a).toBeCloseTo(0.5, 5)
  })

  it("rejects unsupported notation", () => {
    expect(() => parseColor("rgb(0 0 0)")).toThrow(/Unsupported color/)
    expect(() => parseColor("#12345")).toThrow(/Unsupported color/)
  })
})

describe("contrastRatio", () => {
  it("matches WCAG reference values", () => {
    expect(contrastRatio(parseColor("#000"), parseColor("#fff"))).toBeCloseTo(21, 5)
    expect(contrastRatio(parseColor("#fff"), parseColor("#fff"))).toBeCloseTo(1, 5)
    expect(contrastRatio(parseColor("#777"), parseColor("#fff"))).toBeCloseTo(4.48, 1)
  })

  it("orders the ratio consistently regardless of argument order", () => {
    const a = parseColor("#123456")
    const b = parseColor("#fedcba")
    expect(contrastRatio(a, b)).toBeCloseTo(contrastRatio(b, a), 10)
  })
})

describe("translucent surfaces", () => {
  it("composites alpha over an opaque backdrop", () => {
    const halfBlack = composite(parseColor("#00000080"), parseColor("#fff"))
    expect(halfBlack.r).toBeCloseTo(0.5, 2)
    expect(relativeLuminance(halfBlack)).toBeCloseTo(0.214, 2)
  })

  it("uses the composited color for contrast", () => {
    const translucentWhite = parseColor("oklch(1 0 0 / 50%)")
    const surface = parseColor("#000")
    expect(contrastOver(translucentWhite, surface)).toBeCloseTo(
      contrastRatio(parseColor("#808080"), surface),
      1,
    )
  })
})
