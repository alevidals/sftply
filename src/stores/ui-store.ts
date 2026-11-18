import { create } from "zustand"

export type BottomTab = "transfers" | "activity" | "history"
export type PaneId = "local" | "remote"
export type SettingsTab =
  | "appearance"
  | "behavior"
  | "connections"
  | "transfers"
  | "shortcuts"
  | "about"

export interface PaneSummary {
  path: string | null
  items: number
  selected: number
}

interface UiState {
  paletteOpen: boolean
  settingsOpen: boolean
  settingsTab: SettingsTab
  quickConnectOpen: boolean
  syncCompareOpen: boolean
  activePane: PaneId
  bottomTab: BottomTab
  localSummary: PaneSummary
  remoteSummary: PaneSummary
  setPaletteOpen: (open: boolean) => void
  togglePalette: () => void
  setSettingsOpen: (open: boolean) => void
  setSettingsTab: (tab: SettingsTab) => void
  setQuickConnectOpen: (open: boolean) => void
  setSyncCompareOpen: (open: boolean) => void
  setActivePane: (pane: PaneId) => void
  setBottomTab: (tab: BottomTab) => void
  setLocalSummary: (summary: PaneSummary) => void
  setRemoteSummary: (summary: PaneSummary) => void
}

const EMPTY_SUMMARY: PaneSummary = { path: null, items: 0, selected: 0 }

export const useUiStore = create<UiState>((set) => ({
  paletteOpen: false,
  settingsOpen: false,
  settingsTab: "appearance",
  quickConnectOpen: false,
  syncCompareOpen: false,
  activePane: "local",
  bottomTab: "activity",
  localSummary: EMPTY_SUMMARY,
  remoteSummary: EMPTY_SUMMARY,
  setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
  togglePalette: () => set((state) => ({ paletteOpen: !state.paletteOpen })),
  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
  setSettingsTab: (settingsTab) => set({ settingsTab }),
  setQuickConnectOpen: (quickConnectOpen) => set({ quickConnectOpen }),
  setSyncCompareOpen: (syncCompareOpen) => set({ syncCompareOpen }),
  setActivePane: (activePane) => set({ activePane }),
  setBottomTab: (bottomTab) => set({ bottomTab }),
  setLocalSummary: (localSummary) => set({ localSummary }),
  setRemoteSummary: (remoteSummary) => set({ remoteSummary }),
}))
