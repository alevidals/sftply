import { create } from "zustand"

export type BottomTab = "transfers" | "activity" | "history"
export type PaneId = "local" | "remote"

export interface PaneSummary {
  path: string | null
  items: number
  selected: number
}

interface UiState {
  paletteOpen: boolean
  settingsOpen: boolean
  quickConnectOpen: boolean
  activePane: PaneId
  bottomTab: BottomTab
  localSummary: PaneSummary
  remoteSummary: PaneSummary
  setPaletteOpen: (open: boolean) => void
  togglePalette: () => void
  setSettingsOpen: (open: boolean) => void
  setQuickConnectOpen: (open: boolean) => void
  setActivePane: (pane: PaneId) => void
  setBottomTab: (tab: BottomTab) => void
  setLocalSummary: (summary: PaneSummary) => void
  setRemoteSummary: (summary: PaneSummary) => void
}

const EMPTY_SUMMARY: PaneSummary = { path: null, items: 0, selected: 0 }

export const useUiStore = create<UiState>((set) => ({
  paletteOpen: false,
  settingsOpen: false,
  quickConnectOpen: false,
  activePane: "local",
  bottomTab: "activity",
  localSummary: EMPTY_SUMMARY,
  remoteSummary: EMPTY_SUMMARY,
  setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
  togglePalette: () => set((state) => ({ paletteOpen: !state.paletteOpen })),
  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
  setQuickConnectOpen: (quickConnectOpen) => set({ quickConnectOpen }),
  setActivePane: (activePane) => set({ activePane }),
  setBottomTab: (bottomTab) => set({ bottomTab }),
  setLocalSummary: (localSummary) => set({ localSummary }),
  setRemoteSummary: (remoteSummary) => set({ remoteSummary }),
}))
