import { create } from "zustand"

export type BottomTab = "transfers" | "activity"
export type PaneId = "local" | "remote"

interface UiState {
  paletteOpen: boolean
  settingsOpen: boolean
  activePane: PaneId
  bottomTab: BottomTab
  setPaletteOpen: (open: boolean) => void
  togglePalette: () => void
  setSettingsOpen: (open: boolean) => void
  setActivePane: (pane: PaneId) => void
  setBottomTab: (tab: BottomTab) => void
}

export const useUiStore = create<UiState>((set) => ({
  paletteOpen: false,
  settingsOpen: false,
  activePane: "local",
  bottomTab: "activity",
  setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
  togglePalette: () => set((state) => ({ paletteOpen: !state.paletteOpen })),
  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
  setActivePane: (activePane) => set({ activePane }),
  setBottomTab: (bottomTab) => set({ bottomTab }),
}))
