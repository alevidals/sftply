import { cn } from "cn"
import type { ReactNode } from "react"

export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd
      className={cn(
        "inline-flex h-5 min-w-5 items-center justify-center rounded-[4px] border border-border/80 bg-muted/60 px-1 font-sans text-[10px] leading-none font-medium text-muted-foreground",
        className,
      )}
    >
      {children}
    </kbd>
  )
}
