import { useCallback, useEffect, useRef } from "react"
import { toast } from "sonner"
import { useSettings } from "@/features/settings/settings-context"
import { errorMessage } from "@/lib/errors"
import type { AppSettings_Serialize } from "@/lib/ipc/bindings"

/** Persist settings changes after a short pause. Patches made within the
 * debounce window are merged so no field is lost. */
export function useDebouncedSettingsPatch() {
  const { updateSettings } = useSettings()
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pending = useRef<Partial<AppSettings_Serialize>>({})

  // Flush instead of dropping: a pane that unmounts mid-debounce must not lose
  // the last path or layout change.
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
      timer.current = null
      const merged = pending.current
      pending.current = {}
      if (Object.keys(merged).length > 0) {
        updateSettings(merged).catch(() => undefined)
      }
    },
    [updateSettings],
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
          toast.error("Could not save your settings", {
            description: errorMessage(error),
          })
        })
      }, 500)
    },
    [updateSettings],
  )
}
