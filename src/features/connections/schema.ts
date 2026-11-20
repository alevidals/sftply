import { z } from "zod"
import type {
  ConnectionInput_Deserialize,
  ConnectionProfile_Serialize,
  ConnectionProtocol,
  SecretKind,
} from "@/lib/ipc/bindings"

const protocolPorts: Record<ConnectionProtocol, number> = {
  ftp: 21,
  ftpsExplicit: 21,
  ftpsImplicit: 990,
  sftp: 22,
}

export const PROTOCOL_LABELS: Record<ConnectionProtocol, string> = {
  ftp: "FTP",
  ftpsExplicit: "FTPS (explicit)",
  ftpsImplicit: "FTPS (implicit)",
  sftp: "SFTP",
}

export function defaultPort(protocol: ConnectionProtocol): number {
  return protocolPorts[protocol]
}

export function protocolIsSecure(protocol: ConnectionProtocol): boolean {
  return protocol !== "ftp"
}

export function protocolIsFtps(protocol: ConnectionProtocol): boolean {
  return protocol === "ftpsExplicit" || protocol === "ftpsImplicit"
}

export function protocolUsesDataMode(protocol: ConnectionProtocol): boolean {
  return protocol !== "sftp"
}

const nameSchema = z
  .string()
  .trim()
  .min(1, "A connection name is required.")
  .max(100, "The name is too long.")

const optionalNameSchema = z.string().trim().max(100, "The name is too long.")

const hostSchema = z
  .string()
  .trim()
  .min(1, "A host is required.")
  .max(253, "The host name is too long.")
  .refine((value) => !/[\s/\\]/.test(value), "Enter a host name without spaces, slashes or a port.")

const portSchema = z
  .string()
  .trim()
  .regex(/^\d+$/, "Enter a port between 1 and 65535.")
  .refine((value) => {
    const port = Number(value)
    return Number.isInteger(port) && port >= 1 && port <= 65535
  }, "Enter a port between 1 and 65535.")

const usernameSchema = z.string().trim().max(128, "The username is too long.")

const authKindSchema = z.enum(["password", "key", "agent"])

const ftpDataModeSchema = z.enum(["passive", "extendedPassive", "active"])

const absolutePathSchema = z
  .string()
  .trim()
  .refine(
    (value) => value === "" || value.startsWith("/") || /^[A-Za-z]:[\\/]/.test(value),
    "Enter an absolute path.",
  )

const certificatePinSchema = z
  .string()
  .trim()
  .refine(
    (value) => value === "" || normalizeCertificatePin(value) !== null,
    "Enter a SHA-256 fingerprint (64 hex characters).",
  )

/** Canonical lowercase hex fingerprint, or null when the value is invalid. */
export function normalizeCertificatePin(value: string): string | null {
  const trimmed = value.trim()
  const body = trimmed.slice(0, 7).toLowerCase() === "sha256:" ? trimmed.slice(7) : trimmed
  const hex = body.replace(/[:\s]/g, "")
  return /^[0-9a-fA-F]{64}$/.test(hex) ? hex.toLowerCase() : null
}

interface SharedFields {
  protocol: ConnectionProtocol
  username: string
  authKind: "password" | "key" | "agent"
  keyPath: string
  initialPath: string
}

function refineSharedFields(values: SharedFields, ctx: z.RefinementCtx) {
  if (values.protocol === "sftp" && !values.username.trim()) {
    ctx.addIssue({
      code: "custom",
      path: ["username"],
      message: "SFTP requires a username.",
    })
  }
  if (values.authKind === "key") {
    if (!values.keyPath.trim()) {
      ctx.addIssue({
        code: "custom",
        path: ["keyPath"],
        message: "Choose a private key file.",
      })
    }
  }
  if (values.authKind !== "password" && values.protocol !== "sftp") {
    ctx.addIssue({
      code: "custom",
      path: ["authKind"],
      message:
        values.authKind === "agent"
          ? "The SSH agent can only be used with SFTP connections."
          : "SSH keys can only be used with SFTP connections.",
    })
  }
  if (values.initialPath.trim() && !values.initialPath.trim().startsWith("/")) {
    ctx.addIssue({
      code: "custom",
      path: ["initialPath"],
      message: "Remote paths must start with /.",
    })
  }
}

export const connectionSchema = z
  .object({
    name: nameSchema,
    protocol: z.enum(["ftp", "ftpsExplicit", "ftpsImplicit", "sftp"]),
    host: hostSchema,
    port: portSchema,
    username: usernameSchema,
    authKind: authKindSchema,
    keyPath: z.string(),
    passphraseProtected: z.boolean(),
    initialPath: z.string(),
    favorite: z.boolean(),
    group: z.string().max(64, "The group name is too long."),
    secret: z.string(),
    tlsCaFile: absolutePathSchema,
    tlsCertificatePin: certificatePinSchema,
    tlsAllowInvalid: z.boolean(),
    ftpDataMode: ftpDataModeSchema,
  })
  .superRefine(refineSharedFields)

export type ConnectionFormValues = z.infer<typeof connectionSchema>

export const quickConnectSchema = z
  .object({
    name: optionalNameSchema,
    protocol: z.enum(["ftp", "ftpsExplicit", "ftpsImplicit", "sftp"]),
    host: hostSchema,
    port: portSchema,
    username: usernameSchema,
    authKind: authKindSchema,
    keyPath: z.string(),
    passphraseProtected: z.boolean(),
    initialPath: z.string(),
    group: z.string().max(64, "The group name is too long."),
    secret: z.string(),
    save: z.boolean(),
    tlsCaFile: absolutePathSchema,
    tlsCertificatePin: certificatePinSchema,
    tlsAllowInvalid: z.boolean(),
    ftpDataMode: ftpDataModeSchema,
  })
  .superRefine((values, ctx) => {
    refineSharedFields(values, ctx)
    if (values.save && !values.name.trim()) {
      ctx.addIssue({
        code: "custom",
        path: ["name"],
        message: "A name is required to save the connection.",
      })
    }
    const anonymous = ["anonymous", "ftp"].includes(values.username.trim().toLowerCase())
    if (
      values.save &&
      values.authKind === "password" &&
      !values.secret &&
      (values.protocol === "sftp" || (values.username.trim() && !anonymous))
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["secret"],
        message: "Enter the password to save this connection.",
      })
    }
    if (values.save && values.authKind === "key" && values.passphraseProtected && !values.secret) {
      ctx.addIssue({
        code: "custom",
        path: ["secret"],
        message: "Enter the key passphrase to save this connection.",
      })
    }
  })

export type QuickConnectValues = z.infer<typeof quickConnectSchema>

export function emptyConnectionValues(): ConnectionFormValues {
  return {
    name: "",
    protocol: "sftp",
    host: "",
    port: "22",
    username: "",
    authKind: "password",
    keyPath: "",
    passphraseProtected: false,
    initialPath: "/",
    favorite: false,
    group: "",
    secret: "",
    tlsCaFile: "",
    tlsCertificatePin: "",
    tlsAllowInvalid: false,
    ftpDataMode: "passive",
  }
}

export function emptyQuickConnectValues(): QuickConnectValues {
  return {
    name: "",
    protocol: "sftp",
    host: "",
    port: "22",
    username: "",
    authKind: "password",
    keyPath: "",
    passphraseProtected: false,
    initialPath: "/",
    group: "",
    secret: "",
    save: false,
    tlsCaFile: "",
    tlsCertificatePin: "",
    tlsAllowInvalid: false,
    ftpDataMode: "passive",
  }
}

export function valuesFromProfile(profile: ConnectionProfile_Serialize): ConnectionFormValues {
  return {
    name: profile.name,
    protocol: profile.protocol,
    host: profile.host,
    port: String(profile.port),
    username: profile.username,
    authKind: profile.auth.kind,
    keyPath: profile.auth.kind === "key" ? profile.auth.keyPath : "",
    passphraseProtected: profile.auth.kind === "key" ? profile.auth.passphraseProtected : false,
    initialPath: profile.initialPath,
    favorite: profile.favorite,
    group: profile.group ?? "",
    secret: "",
    tlsCaFile: profile.tls.caFile ?? "",
    tlsCertificatePin: profile.tls.certificatePin ?? "",
    tlsAllowInvalid: profile.tls.allowInvalidCertificates,
    ftpDataMode: profile.ftpDataMode,
  }
}

function connectionAuth(
  values: Pick<ConnectionFormValues, "authKind" | "keyPath" | "passphraseProtected">,
): ConnectionInput_Deserialize["auth"] {
  if (values.authKind === "key") {
    return {
      kind: "key",
      keyPath: values.keyPath.trim(),
      passphraseProtected: values.passphraseProtected,
    }
  }
  return values.authKind === "agent" ? { kind: "agent" } : { kind: "password" }
}

export function toConnectionInput(values: ConnectionFormValues): ConnectionInput_Deserialize {
  return {
    name: values.name.trim(),
    protocol: values.protocol,
    host: values.host.trim(),
    port: Number(values.port),
    username: values.username.trim(),
    auth: connectionAuth(values),
    initialPath: values.initialPath.trim() || "/",
    favorite: values.favorite,
    group: values.group.trim() || null,
    tls: {
      caFile: values.tlsCaFile.trim() || null,
      certificatePin: values.tlsCertificatePin.trim() || null,
      allowInvalidCertificates: values.tlsAllowInvalid,
    },
    ftpDataMode: values.ftpDataMode,
  }
}

export function toQuickConnectInput(values: QuickConnectValues): ConnectionInput_Deserialize {
  const username = values.username.trim() || "anonymous"
  return {
    name: values.name.trim() || `${username}@${values.host.trim()}`,
    protocol: values.protocol,
    host: values.host.trim(),
    port: Number(values.port),
    username,
    auth: connectionAuth(values),
    initialPath: values.initialPath.trim() || "/",
    favorite: false,
    group: values.group.trim() || null,
    tls: {
      caFile: values.tlsCaFile.trim() || null,
      certificatePin: values.tlsCertificatePin.trim() || null,
      allowInvalidCertificates: values.tlsAllowInvalid,
    },
    ftpDataMode: values.ftpDataMode,
  }
}

export function secretKindFor(values: Pick<ConnectionFormValues, "authKind">): SecretKind | null {
  if (values.authKind === "key") return "passphrase"
  if (values.authKind === "password") return "password"
  return null
}
