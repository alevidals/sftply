import { cn } from "cn"
import { useId } from "react"

export function BrandMark({ className }: { className?: string }) {
  const id = useId().replace(/:/g, "")
  const gradientId = `${id}-bg`
  const sheenId = `${id}-sheen`

  return (
    <svg viewBox="88 88 848 848" role="img" aria-label="sftply" className={cn("size-6", className)}>
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
          <stop stopColor="#8B5CF6" />
          <stop offset="1" stopColor="#4F8CFF" />
        </linearGradient>
        <linearGradient id={sheenId} x1="0" y1="0" x2="0" y2="1">
          <stop stopColor="#FFFFFF" stopOpacity="0.22" />
          <stop offset="0.62" stopColor="#FFFFFF" stopOpacity="0" />
        </linearGradient>
      </defs>
      <rect x="88" y="88" width="848" height="848" rx="190" fill={`url(#${gradientId})`} />
      <rect x="88" y="88" width="848" height="848" rx="190" fill={`url(#${sheenId})`} />
      <g fill="none" stroke="#FFFFFF" strokeWidth="80" strokeLinecap="round" strokeLinejoin="round">
        <path d="M260 410h464" />
        <path d="M634 320l90 90-90 90" />
        <path d="M764 614H300" />
        <path d="M390 524l-90 90 90 90" />
      </g>
    </svg>
  )
}
