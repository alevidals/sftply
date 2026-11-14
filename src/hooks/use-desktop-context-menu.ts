import { useEffect } from "react"

/**
 * Desktop webviews still offer the browser context menu ("Reload", "Back"),
 * which does not belong in an app window. Suppress it everywhere except in
 * editable fields, where users need cut/copy/paste.
 */
export function useDesktopContextMenu() {
  useEffect(() => {
    const onContextMenu = (event: MouseEvent) => {
      const target = event.target
      if (!(target instanceof Element)) return
      const editable = target.closest(
        "input, textarea, select, [contenteditable=''], [contenteditable='true']",
      )
      if (editable) return
      event.preventDefault()
    }

    document.addEventListener("contextmenu", onContextMenu)
    return () => document.removeEventListener("contextmenu", onContextMenu)
  }, [])
}
