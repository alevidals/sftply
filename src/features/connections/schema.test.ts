import { describe, expect, it } from "vitest"
import {
  connectionSchema,
  defaultPort,
  emptyConnectionValues,
  secretKindFor,
  toConnectionInput,
  valuesFromProfile,
} from "@/features/connections/schema"
import type { ConnectionProfile_Serialize } from "@/lib/ipc/bindings"

const valid = {
  ...emptyConnectionValues(),
  name: "Production",
  host: "ftp.example.com",
  username: "ada",
}

function profile(
  overrides: Partial<ConnectionProfile_Serialize> = {},
): ConnectionProfile_Serialize {
  return {
    id: "c1",
    name: "Production",
    protocol: "sftp",
    host: "example.com",
    port: 22,
    username: "ada",
    auth: { kind: "password" },
    initialPath: "/",
    favorite: false,
    group: null,
    createdAt: 0,
    lastUsedAt: null,
    ...overrides,
  }
}

describe("connectionSchema", () => {
  it("accepts a minimal valid connection", () => {
    expect(connectionSchema.safeParse(valid).success).toBe(true)
  })

  it("requires a name, host and username", () => {
    expect(connectionSchema.safeParse({ ...valid, name: "  " }).success).toBe(false)
    expect(connectionSchema.safeParse({ ...valid, host: "" }).success).toBe(false)
    expect(connectionSchema.safeParse({ ...valid, username: "" }).success).toBe(false)
  })

  it("validates the port range", () => {
    expect(connectionSchema.safeParse({ ...valid, port: "0" }).success).toBe(false)
    expect(connectionSchema.safeParse({ ...valid, port: "65536" }).success).toBe(false)
    expect(connectionSchema.safeParse({ ...valid, port: "abc" }).success).toBe(false)
    expect(connectionSchema.safeParse({ ...valid, port: "2222" }).success).toBe(true)
  })

  it("requires an absolute remote path", () => {
    expect(connectionSchema.safeParse({ ...valid, initialPath: "relative" }).success).toBe(false)
    expect(connectionSchema.safeParse({ ...valid, initialPath: "/var/www" }).success).toBe(true)
  })

  it("keeps SSH keys to SFTP and requires a path", () => {
    const base = { ...valid, authKind: "key" as const, keyPath: "/home/ada/.ssh/id_ed25519" }
    expect(connectionSchema.safeParse(base).success).toBe(true)
    expect(connectionSchema.safeParse({ ...base, keyPath: "" }).success).toBe(false)
    expect(connectionSchema.safeParse({ ...base, protocol: "ftp" as const }).success).toBe(false)
  })
})

describe("form conversion", () => {
  it("trims fields and normalizes empty groups", () => {
    const input = toConnectionInput({
      ...valid,
      name: "  Production  ",
      host: " example.com ",
      group: "   ",
    })
    expect(input.name).toBe("Production")
    expect(input.host).toBe("example.com")
    expect(input.group).toBeNull()
    expect(input.auth).toEqual({ kind: "password" })
  })

  it("round-trips a saved profile", () => {
    const values = valuesFromProfile(profile({ favorite: true, group: "Work" }))
    expect(values.name).toBe("Production")
    expect(values.port).toBe("22")
    expect(values.favorite).toBe(true)
    expect(values.group).toBe("Work")
    expect(values.secret).toBe("")
  })

  it("maps auth kinds to secret kinds", () => {
    expect(secretKindFor({ authKind: "password" })).toBe("password")
    expect(secretKindFor({ authKind: "key" })).toBe("passphrase")
  })

  it("uses the conventional default ports", () => {
    expect(defaultPort("ftp")).toBe(21)
    expect(defaultPort("ftpsExplicit")).toBe(21)
    expect(defaultPort("ftpsImplicit")).toBe(990)
    expect(defaultPort("sftp")).toBe(22)
  })
})
