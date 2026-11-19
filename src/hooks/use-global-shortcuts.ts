import { useCallback, useEffect } from "react"
import { toast } from "sonner"
import { tinykeys } from "tinykeys"
import { useSettings } from "@/features/settings/settings-context"
import { errorMessage } from "@/lib/errors"
import { useSessionStore } from "@/stores/session-store"
import { type PaneId, useUiStore } from "@/stores/ui-store"

export function useGlobalShortcuts() {
  const togglePalette = useUiStore((state) => state.togglePalette)
  const setSettingsOpen = useUiStore((state) => state.setSettingsOpen)
  const setSettingsTab = useUiStore((state) => state.setSettingsTab)
  const setActivePane = useUiStore((state) => state.setActivePane)
  const setSyncCompareOpen = useUiStore((state) => state.setSyncCompareOpen)
  const localPath = useUiStore((state) => state.localSummary.path)
  const remotePath = useUiStore((state) => state.remoteSummary.path)
  const activeSessionId = useSessionStore((state) => state.activeSessionId)
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
        "Shift+Slash": (event) => {
          if (useUiStore.getState().paletteOpen) return
          event.preventDefault()
          setSettingsTab("shortcuts")
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
        "$mod+Shift+KeyC": (event) => {
          const state = useUiStore.getState()
          if (state.paletteOpen || state.settingsOpen || state.syncCompareOpen) return
          event.preventDefault()
          if (!localPath || !remotePath || !activeSessionId) {
            toast.info("Open a local folder and connect a remote session first.")
            return
          }
          setSyncCompareOpen(true)
        },
      }),
    [
      activeSessionId,
      focusPane,
      localPath,
      remotePath,
      setSettingsOpen,
      setSettingsTab,
      setSyncCompareOpen,
      toggleBottomPanel,
      togglePalette,
    ],
  )
}
