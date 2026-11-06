import { describe, expect, it } from "vitest"
import { parentPath, pathBreadcrumbs, pathLeaf } from "@/features/files/model/path"

describe("pathBreadcrumbs", () => {
  it("builds POSIX breadcrumbs", () => {
    expect(pathBreadcrumbs("/Users/ada/Documents")).toEqual([
      { label: "/", path: "/" },
      { label: "Users", path: "/Users" },
      { label: "ada", path: "/Users/ada" },
      { label: "Documents", path: "/Users/ada/Documents" },
    ])
  })

  it("handles the root", () => {
    expect(pathBreadcrumbs("/")).toEqual([{ label: "/", path: "/" }])
    expect(parentPath("/")).toBeNull()
    expect(pathLeaf("/")).toBe("/")
  })

  it("builds Windows breadcrumbs", () => {
    expect(pathBreadcrumbs("C:\\Users\\ada\\Docs")).toEqual([
      { label: "C:\\", path: "C:\\" },
      { label: "Users", path: "C:\\Users" },
      { label: "ada", path: "C:\\Users\\ada" },
      { label: "Docs", path: "C:\\Users\\ada\\Docs" },
    ])
  })

  it("handles UNC roots", () => {
    expect(pathBreadcrumbs("\\\\server\\share\\docs")).toEqual([
      { label: "\\\\server\\share", path: "\\\\server\\share" },
      { label: "docs", path: "\\\\server\\share\\docs" },
    ])
  })

  it("returns relative paths unchanged as a single crumb", () => {
    expect(pathBreadcrumbs("relative/path")).toEqual([
      { label: "relative/path", path: "relative/path" },
    ])
  })

  it("derives parents and leaves", () => {
    expect(parentPath("/Users/ada/Documents")).toBe("/Users/ada")
    expect(pathLeaf("/Users/ada/Documents")).toBe("Documents")
  })
})
