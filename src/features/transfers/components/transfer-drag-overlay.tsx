import { FilesIcon } from "lucide-react"
import { useEffect, useState } from "react"
import { createPortal } from "react-dom"
import { useTransferDrag } from "@/features/transfers/use-transfer-drag"

/**
 * A small badge that follows the pointer while files are dragged between
 * panes, so the drag is visible even before it reaches a drop target. It is
 * purely decorative: `pointer-events-none` keeps the cursor on the element
 * underneath.
 */
export function TransferDragOverlay() {
  const drag = useTransferDrag()
  const [pointer, setPointer] = useState<{ x: number; y: number } | null>(null)

  useEffect(() => {
    if (!drag) {
      setPointer(null)
      return
    }
    const track = (event: DragEvent) => {
      setPointer({ x: event.clientX, y: event.clientY })
    }
    window.addEventListener("dragover", track, true)
    return () => window.removeEventListener("dragover", track, true)
  }, [drag])

  if (!drag || !pointer) return null

  const count = drag.entries.length
  const first = drag.entries[0]?.name ?? "item"

  return createPortal(
    <div
      aria-hidden="true"
      data-testid="transfer-drag-overlay"
      className="pointer-events-none fixed z-50 flex max-w-64 items-center gap-2 rounded-md border border-primary/40 bg-popover/95 px-2.5 py-1.5 text-xs font-medium text-foreground shadow-lg ring-1 ring-primary/20 backdrop-blur-sm"
      style={{ left: pointer.x + 14, top: pointer.y + 14 }}
    >
      <FilesIcon className="size-3.5 shrink-0 text-primary" />
      <span className="truncate">{count === 1 ? first : `${count} items`}</span>
    </div>,
    document.body,
  )
}
