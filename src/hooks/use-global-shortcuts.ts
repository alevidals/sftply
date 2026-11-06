import { useCallback, useEffect } from "react"
import { toast } from "sonner"
import { tinykeys } from "tinykeys"
import { useSettings } from "@/features/settings/settings-context"
import { errorMessage } from "@/lib/errors"
import { type PaneId, useUiStore } from "@/stores/ui-store"

export function useGlobalShortcuts() {
  const togglePalette = useUiStore((state) => state.togglePalette)
  const setSettingsOpen = useUiStore((state) => state.setSettingsOpen)
  const setActivePane = useUiStore((state) => state.setActivePane)
  const { settings, updateSettings } = useSettings()

  const focusPane = useCallback(
    (pane: PaneId) => {
      setActivePane(pane)
      document.getElementById(`pane-${pane}`)?.focus()
    },
    [setActivePane],
  )

  const toggleBottomPanel = useCallback(() => {
    updateSettings({ bottomPanelOpen: !settings.bottomPanelOpen }).catch((error) => {
      toast.error("Could not update the panel", { description: errorMessage(error) })
    })
  }, [settings.bottomPanelOpen, updateSettings])

  useEffect(
    () =>
      tinykeys(window, {
        "$mod+KeyK": (event) => {
          event.preventDefault()
          togglePalette()
        },
        "$mod+Comma": (event) => {
          event.preventDefault()
          setSettingsOpen(true)
        },
        "$mod+KeyJ": (event) => {
          event.preventDefault()
          toggleBottomPanel()
        },
        "$mod+Digit1": (event) => {
          event.preventDefault()
          focusPane("local")
        },
        "$mod+Digit2": (event) => {
          event.preventDefault()
          focusPane("remote")
        },
      }),
    [focusPane, setSettingsOpen, toggleBottomPanel, togglePalette],
  )
}
