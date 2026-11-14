import { describe, expect, it } from "vitest"
import { commonMode, hasPermission, setPermission } from "@/features/files/model/permissions"
import type { FsEntry } from "@/lib/ipc/bindings"

function entry(name: string, permissions: number | null): FsEntry {
  return {
    name,
    path: `/tmp/${name}`,
    kind: "file",
    size: 1,
    modifiedAt: 0,
    permissions,
    owner: null,
    group: null,
    linkTarget: null,
    hidden: false,
    metadataComplete: true,
  }
}

describe("permission helpers", () => {
  it("reads each class and bit", () => {
    expect(hasPermission(0o640, "owner", "read")).toBe(true)
    expect(hasPermission(0o640, "owner", "write")).toBe(true)
    expect(hasPermission(0o640, "owner", "execute")).toBe(false)
    expect(hasPermission(0o640, "group", "read")).toBe(true)
    expect(hasPermission(0o640, "group", "write")).toBe(false)
    expect(hasPermission(0o640, "other", "read")).toBe(false)
  })

  it("toggles a single bit and keeps the rest", () => {
    expect(setPermission(0o755, "owner", "execute", false)).toBe(0o655)
    expect(setPermission(0o644, "group", "write", true)).toBe(0o664)
    expect(setPermission(0o644, "other", "execute", true)).toBe(0o645)
  })

  it("preserves setuid, setgid and sticky bits when toggling", () => {
    expect(setPermission(0o4755, "other", "write", true)).toBe(0o4757)
    expect(setPermission(0o2750, "other", "write", true)).toBe(0o2752)
    expect(setPermission(0o1755, "owner", "read", false)).toBe(0o1355)
  })

  it("returns the shared mode only when every entry agrees", () => {
    expect(commonMode([entry("a", 0o644), entry("b", 0o644)])).toBe(0o644)
    expect(commonMode([entry("a", 0o644), entry("b", 0o600)])).toBeNull()
    expect(commonMode([entry("a", null), entry("b", null)])).toBeNull()
    expect(commonMode([])).toBeNull()
  })
})
