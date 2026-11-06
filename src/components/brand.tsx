import { cn } from "cn"
import { useId } from "react"

export function BrandMark({ className }: { className?: string }) {
  const gradientId = useId().replace(/:/g, "")

  return (
    <svg viewBox="0 0 32 32" role="img" aria-label="sftply" className={cn("size-6", className)}>
      <defs>
        <linearGradient
          id={gradientId}
          x1="0"
          y1="0"
          x2="32"
          y2="32"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#8b5cf6" />
          <stop offset="1" stopColor="#4f8cff" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="8.5" fill={`url(#${gradientId})`} />
      <path
        d="M9.4 20.6h9.1l-2.7-2.7M22.6 11.4h-9.1l2.7 2.7"
        fill="none"
        stroke="white"
        strokeWidth="2.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
