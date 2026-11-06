const BYTE_UNITS = ["B", "KB", "MB", "GB", "TB", "PB"] as const

/** Format a byte count using binary units and at most two decimals. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "—"
  if (bytes < 1024) return `${Math.round(bytes)} B`

  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), BYTE_UNITS.length - 1)
  const value = bytes / 1024 ** exponent
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
