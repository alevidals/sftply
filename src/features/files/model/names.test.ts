import { describe, expect, it } from "vitest"
import { entryNameError } from "@/features/files/model/names"

describe("entryNameError", () => {
  it("accepts normal names", () => {
    expect(entryNameError("report.pdf")).toBeNull()
    expect(entryNameError(".hidden")).toBeNull()
    expect(entryNameError("...")).toBeNull()
    expect(entryNameError("name with spaces.txt")).toBeNull()
  })

  it("rejects empty and whitespace-only names", () => {
    expect(entryNameError("")).not.toBeNull()
    expect(entryNameError("   ")).not.toBeNull()
  })

  it("rejects traversal names and separators", () => {
    expect(entryNameError(".")).not.toBeNull()
    expect(entryNameError("..")).not.toBeNull()
    expect(entryNameError("a/b")).not.toBeNull()
    expect(entryNameError("a\\b")).not.toBeNull()
    expect(entryNameError("a\0b")).not.toBeNull()
  })

  it("rejects names longer than 255 characters", () => {
    expect(entryNameError("x".repeat(255))).toBeNull()
    expect(entryNameError("x".repeat(256))).not.toBeNull()
  })
})
