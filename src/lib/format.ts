import type { DateFormat, SizeFormat } from "@/lib/ipc/bindings"

const BYTE_UNITS = ["B", "KB", "MB", "GB", "TB", "PB"] as const

/** Format a byte count using the selected base and at most two decimals. */
export function formatBytes(bytes: number, format: SizeFormat = "binary"): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "—"
  const base = format === "decimal" ? 1000 : 1024
  if (bytes < base) return `${Math.round(bytes)} B`

  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(base)), BYTE_UNITS.length - 1)
  const value = bytes / base ** exponent
  const digits = value >= 100 ? 0 : value >= 10 ? 1 : 2
  const unit = BYTE_UNITS[exponent] ?? "B"

  return `${value.toFixed(digits)} ${unit}`
}

const countFormatter = new Intl.NumberFormat(undefined)

export function formatCount(value: number): string {
  if (!Number.isFinite(value)) return "—"
  return countFormatter.format(value)
}

const clockFormatter = new Intl.DateTimeFormat(undefined, {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
})

/** Format a Unix epoch millisecond timestamp as a local wall-clock time. */
export function formatClock(timestampMs: number): string {
  if (!Number.isFinite(timestampMs)) return "—"
  return clockFormatter.format(new Date(timestampMs))
}

export function formatPercent(value: number): string {
  if (!Number.isFinite(value)) return "—"
  return `${Math.round(value)}%`
}

/** Format a remaining-time estimate compactly. */
export function formatEta(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return "—"
  const seconds = Math.ceil(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}

const fileDateFormatter = new Intl.DateTimeFormat(undefined, {
  year: "numeric",
  month: "short",
  day: "numeric",
})

const fileDateTimeFormatter = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
})

/** Format a file modification timestamp compactly for a dense table. */
export function formatModified(
  timestampMs: number | null | undefined,
  format: DateFormat = "friendly",
): string {
  if (timestampMs == null || !Number.isFinite(timestampMs)) return "—"
  const date = new Date(timestampMs)
  if (format === "iso") {
    const pad = (value: number) => String(value).padStart(2, "0")
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
  }
  const now = new Date()
  return date.getFullYear() === now.getFullYear()
    ? fileDateTimeFormatter.format(date)
    : fileDateFormatter.format(date)
}

/** Format Unix permission bits as a four-digit octal string. */
export function formatMode(mode: number | null | undefined): string {
  if (mode == null || !Number.isFinite(mode)) return "—"
  return (mode & 0o7777).toString(8).padStart(4, "0")
}

const TYPE_BITS: Array<[number, string]> = [
  [0o4000, "s"],
  [0o2000, "s"],
  [0o1000, "t"],
]

/** Format Unix permissions symbolically, e.g. `drwxr-xr-x`. */
export function formatModeSymbolic(mode: number | null | undefined, isDirectory = false): string {
  if (mode == null || !Number.isFinite(mode)) return "—"
  const bits = mode & 0o7777
  const special = TYPE_BITS.map(([bit, letter]) => (bits & bit ? letter : ""))
  let result = isDirectory ? "d" : "-"

  for (let shift = 6; shift >= 0; shift -= 3) {
    const triplet = (bits >> shift) & 0o7
    result += triplet & 0o4 ? "r" : "-"
    result += triplet & 0o2 ? "w" : "-"
    const specialIndex = (6 - shift) / 3
    const specialLetter = special[specialIndex] ?? ""
    if (specialLetter && triplet & 0o1) {
      result += specialLetter
    } else if (specialLetter) {
      result += specialLetter === "s" ? "S" : "T"
    } else {
      result += triplet & 0o1 ? "x" : "-"
    }
  }

  return result
}
