import { describe, expect, it } from "vitest"
import { isEditableTextSize, MAX_TEXT_FILE_BYTES, textStats } from "@/features/files/model/text"

describe("text editor helpers", () => {
  it("accepts files up to the backend limit", () => {
    expect(isEditableTextSize(0)).toBe(true)
    expect(isEditableTextSize(MAX_TEXT_FILE_BYTES)).toBe(true)
    expect(isEditableTextSize(MAX_TEXT_FILE_BYTES + 1)).toBe(false)
    expect(isEditableTextSize(Number.NaN)).toBe(false)
    expect(isEditableTextSize(-1)).toBe(false)
  })

  it("counts lines and UTF-8 bytes", () => {
    expect(textStats("")).toEqual({ lines: 1, bytes: 0 })
    expect(textStats("one\ntwo")).toEqual({ lines: 2, bytes: 7 })
    expect(textStats("ñ")).toEqual({ lines: 1, bytes: 2 })
    expect(textStats("a\n")).toEqual({ lines: 2, bytes: 2 })
  })
})
