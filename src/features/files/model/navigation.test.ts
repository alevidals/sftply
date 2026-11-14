import { describe, expect, it } from "vitest"
import {
  addBookmark,
  addRecentPath,
  MAX_RECENT_PATHS,
  MAX_REMOTE_BOOKMARKS,
  removeBookmark,
} from "@/features/files/model/navigation"

describe("remote navigation helpers", () => {
  it("adds bookmarks without duplicating them", () => {
    expect(addBookmark([], "/var/log")).toEqual(["/var/log"])
    expect(addBookmark(["/var/log"], "/var/log")).toEqual(["/var/log"])
    expect(addBookmark(["/var/log"], "/etc")).toEqual(["/var/log", "/etc"])
  })

  it("caps the bookmark list", () => {
    const paths = Array.from({ length: MAX_REMOTE_BOOKMARKS }, (_, index) => `/p${index}`)
    expect(addBookmark(paths, "/new")).toHaveLength(MAX_REMOTE_BOOKMARKS)
    expect(addBookmark(paths, "/new").at(-1)).toBe("/new")
    expect(addBookmark(paths, "/new")[0]).toBe("/p1")
  })

  it("removes bookmarks by exact path", () => {
    expect(removeBookmark(["/a", "/b", "/a"], "/a")).toEqual(["/b"])
  })

  it("moves a revisited path to the front of recents", () => {
    expect(addRecentPath(["/a", "/b", "/c"], "/b")).toEqual(["/b", "/a", "/c"])
    expect(addRecentPath(["/a"], "/new")).toEqual(["/new", "/a"])
  })

  it("caps the recent list", () => {
    const paths = Array.from({ length: MAX_RECENT_PATHS }, (_, index) => `/p${index}`)
    expect(addRecentPath(paths, "/new")).toHaveLength(MAX_RECENT_PATHS)
    expect(addRecentPath(paths, "/new")[0]).toBe("/new")
  })

  it("ignores empty paths", () => {
    expect(addBookmark([], "")).toEqual([])
    expect(addRecentPath(["/a"], "")).toEqual(["/a"])
  })
})
