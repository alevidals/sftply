import { useCallback, useEffect, useRef } from "react"
import { toast } from "sonner"
import { useSettings } from "@/features/settings/settings-context"
import { errorMessage } from "@/lib/errors"
import type { AppSettings_Serialize } from "@/lib/ipc/bindings"

/** Persist layout changes after the user stops dragging. Patches made within
 * the debounce window are merged so no field is lost. */
export function usePersistedLayout() {
  const { updateSettings } = useSettings()
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pending = useRef<Partial<AppSettings_Serialize>>({})

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    [],
  )

  return useCallback(
    (patch: Partial<AppSettings_Serialize>) => {
      pending.current = { ...pending.current, ...patch }
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => {
        const merged = pending.current
        pending.current = {}
        timer.current = null
        updateSettings(merged).catch((error) => {
          toast.error("Could not save the layout", {
            description: errorMessage(error),
          })
        })
      }, 500)
    },
    [updateSettings],
  )
}
