import { describe, expect, it } from "vitest"
import {
  connectionSchema,
  defaultPort,
  emptyConnectionValues,
  emptyQuickConnectValues,
  normalizeCertificatePin,
  quickConnectSchema,
  secretKindFor,
  toConnectionInput,
  toQuickConnectInput,
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
    tls: {
      caFile: null,
      certificatePin: null,
      allowInvalidCertificates: false,
    },
    ftpDataMode: "passive",
    createdAt: 0,
    lastUsedAt: null,
    ...overrides,
  }
}

describe("connectionSchema", () => {
  it("accepts a minimal valid connection", () => {
    expect(connectionSchema.safeParse(valid).success).toBe(true)
  })

  it("requires a name, host and username for SFTP", () => {
    expect(connectionSchema.safeParse({ ...valid, name: "  " }).success).toBe(false)
    expect(connectionSchema.safeParse({ ...valid, host: "" }).success).toBe(false)
    expect(connectionSchema.safeParse({ ...valid, username: "" }).success).toBe(false)
  })

  it("allows an empty username for anonymous FTP", () => {
    const anonymous = { ...valid, protocol: "ftp" as const, username: "" }
    expect(connectionSchema.safeParse(anonymous).success).toBe(true)
    expect(toConnectionInput(anonymous).username).toBe("")
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

describe("quickConnectSchema", () => {
  const quick = {
    ...emptyQuickConnectValues(),
    host: "ftp.example.com",
    username: "ada",
    secret: "hunter2",
  }

  it("allows a transient connection without a name", () => {
    expect(quickConnectSchema.safeParse(quick).success).toBe(true)
  })

  it("requires a name and secret when saving", () => {
    expect(quickConnectSchema.safeParse({ ...quick, save: true }).success).toBe(false)
    expect(quickConnectSchema.safeParse({ ...quick, save: true, name: "Saved" }).success).toBe(true)
    expect(
      quickConnectSchema.safeParse({ ...quick, save: true, name: "Saved", secret: "" }).success,
    ).toBe(false)
  })

  it("allows saving anonymous FTP without a secret", () => {
    const anonymous = {
      ...quick,
      protocol: "ftp" as const,
      username: "",
      secret: "",
      save: true,
      name: "Public mirror",
    }
    expect(quickConnectSchema.safeParse(anonymous).success).toBe(true)
  })

  it("only requires a passphrase for protected keys", () => {
    const key = {
      ...quick,
      protocol: "sftp" as const,
      authKind: "key" as const,
      keyPath: "/home/ada/.ssh/id_ed25519",
      save: true,
      name: "Saved",
      secret: "",
    }
    expect(quickConnectSchema.safeParse(key).success).toBe(true)
    expect(quickConnectSchema.safeParse({ ...key, passphraseProtected: true }).success).toBe(false)
  })

  it("falls back to user@host for transient names", () => {
    const input = toQuickConnectInput({
      ...quick,
      name: "   ",
      host: " example.com ",
      username: " ada ",
    })
    expect(input.name).toBe("ada@example.com")
    expect(input.host).toBe("example.com")
    expect(input.username).toBe("ada")
    expect(input.favorite).toBe(false)
  })

  it("uses the anonymous account for a blank FTP username", () => {
    const input = toQuickConnectInput({
      ...quick,
      protocol: "ftp",
      name: "   ",
      host: "example.com",
      username: " ",
    })
    expect(input.username).toBe("anonymous")
    expect(input.name).toBe("anonymous@example.com")
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

  it("normalizes certificate pins and rejects malformed ones", () => {
    expect(
      normalizeCertificatePin(
        "SHA256:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99",
      ),
    ).toBe("aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899")
    expect(normalizeCertificatePin("not-a-pin")).toBeNull()
    expect(normalizeCertificatePin("00".repeat(31))).toBeNull()
  })

  it("maps TLS and FTP data-mode fields", () => {
    const input = toConnectionInput({
      ...valid,
      protocol: "ftpsExplicit",
      tlsCaFile: " /etc/ssl/private/ca.pem ",
      tlsCertificatePin: "00".repeat(32),
      tlsAllowInvalid: true,
      ftpDataMode: "active",
    })
    expect(input.tls).toEqual({
      caFile: "/etc/ssl/private/ca.pem",
      certificatePin: "00".repeat(32),
      allowInvalidCertificates: true,
    })
    expect(input.ftpDataMode).toBe("active")
  })

  it("rejects relative CA paths", () => {
    expect(connectionSchema.safeParse({ ...valid, tlsCaFile: "certs/ca.pem" }).success).toBe(false)
  })
})
