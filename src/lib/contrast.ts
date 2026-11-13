/**
 * Minimal color utilities for design-token checks. Supports the two notations
 * used by `globals.css`: hex colors and `oklch(L C H / A)`.
 */

export interface Rgba {
  r: number
  g: number
  b: number
  /** 0–1, defaults to 1. */
  a: number
}

const HEX_PATTERN = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i
const OKLCH_PATTERN =
  /^oklch\(\s*([\d.]+%?)\s+([\d.]+%?)\s+([\d.]+)(?:deg)?\s*(?:\/\s*([\d.]+%?))?\s*\)$/i

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}

function parseChannel(value: string, scale: number): number {
  return value.endsWith("%") ? (Number.parseFloat(value) / 100) * scale : Number.parseFloat(value)
}

function gammaEncode(value: number): number {
  return value <= 0.0031308 ? 12.92 * value : 1.055 * value ** (1 / 2.4) - 0.055
}

function gammaDecode(value: number): number {
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
}

/** Parse a hex color (#rgb, #rgba, #rrggbb, #rrggbbaa) into sRGB channels. */
function parseHex(value: string): Rgba {
  const hex = value.slice(1)
  const expand = (part: string) => (part.length === 1 ? part + part : part)
  const channels =
    hex.length <= 4
      ? [expand(hex[0] ?? ""), expand(hex[1] ?? ""), expand(hex[2] ?? ""), expand(hex[3] ?? "f")]
      : [
          hex.slice(0, 2),
          hex.slice(2, 4),
          hex.slice(4, 6),
          hex.length === 8 ? hex.slice(6, 8) : "ff",
        ]
  const [r, g, b, a] = channels.map((part) => Number.parseInt(part, 16) / 255)
  return { r: r ?? 0, g: g ?? 0, b: b ?? 0, a: a ?? 1 }
}

/** Parse an `oklch()` color into sRGB channels. */
function parseOklch(match: RegExpMatchArray): Rgba {
  const lightness = parseChannel(match[1] ?? "0", 1)
  const chroma = parseChannel(match[2] ?? "0", 0.4)
  const hue = (Number.parseFloat(match[3] ?? "0") * Math.PI) / 180
  const alpha = match[4] ? parseChannel(match[4], 1) : 1

  const a = chroma * Math.cos(hue)
  const b = chroma * Math.sin(hue)

  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3

  const linear = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ]

  return {
    r: clamp01(gammaEncode(linear[0] ?? 0)),
    g: clamp01(gammaEncode(linear[1] ?? 0)),
    b: clamp01(gammaEncode(linear[2] ?? 0)),
    a: clamp01(alpha),
  }
}

/** Parse a CSS color in hex or `oklch()` notation. Throws on anything else. */
export function parseColor(value: string): Rgba {
  const trimmed = value.trim()
  const hex = HEX_PATTERN.exec(trimmed)
  if (hex) return parseHex(trimmed)
  const oklch = OKLCH_PATTERN.exec(trimmed)
  if (oklch) return parseOklch(oklch)
  throw new Error(`Unsupported color: ${value}`)
}

/** Composite a possibly translucent foreground over an opaque backdrop. */
export function composite(foreground: Rgba, backdrop: Rgba): Rgba {
  return {
    r: foreground.a * foreground.r + (1 - foreground.a) * backdrop.r,
    g: foreground.a * foreground.g + (1 - foreground.a) * backdrop.g,
    b: foreground.a * foreground.b + (1 - foreground.a) * backdrop.b,
    a: 1,
  }
}

/** WCAG relative luminance. */
export function relativeLuminance(color: Rgba): number {
  const [r, g, b] = [color.r, color.g, color.b].map(gammaDecode) as [number, number, number]
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** WCAG contrast ratio between two opaque colors, from 1 to 21. */
export function contrastRatio(left: Rgba, right: Rgba): number {
  const a = relativeLuminance(left)
  const b = relativeLuminance(right)
  const lighter = Math.max(a, b)
  const darker = Math.min(a, b)
  return (lighter + 0.05) / (darker + 0.05)
}

/** Contrast of a (possibly translucent) foreground over an opaque backdrop. */
export function contrastOver(foreground: Rgba, backdrop: Rgba): number {
  return contrastRatio(composite(foreground, backdrop), backdrop)
}
