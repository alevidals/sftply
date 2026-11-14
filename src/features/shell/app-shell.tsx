import { lazy, Suspense, useEffect, useRef } from "react"
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable"
import { QuickConnectDialog } from "@/features/connections/components/quick-connect-dialog"
import { HostKeyDialog } from "@/features/sessions/components/host-key-dialog"
import { useSessionBridge } from "@/features/sessions/hooks/use-session-bridge"
import { useSettings } from "@/features/settings/settings-context"
import { BottomPanel } from "@/features/shell/bottom-panel"
import { Sidebar } from "@/features/shell/sidebar"
import { StatusBar } from "@/features/shell/status-bar"
import { TitleBar } from "@/features/shell/title-bar"
import { Workspace } from "@/features/shell/workspace"
import { TransferDragOverlay } from "@/features/transfers/components/transfer-drag-overlay"
import { useActivityBridge } from "@/hooks/use-activity-bridge"
import { useAppInfo } from "@/hooks/use-app-info"
import { useDebouncedSettingsPatch } from "@/hooks/use-debounced-settings"
import { useDesktopContextMenu } from "@/hooks/use-desktop-context-menu"
import { useGlobalShortcuts } from "@/hooks/use-global-shortcuts"
import { useStartupReport } from "@/hooks/use-startup-report"
import { useTransferBridge } from "@/hooks/use-transfer-bridge"
import { recordActivity } from "@/stores/activity-store"
import { useUiStore } from "@/stores/ui-store"

// Overlays are only needed on demand, so keep their code out of the first load.
const CommandPalette = lazy(() =>
  import("@/features/shell/command-palette").then((module) => ({
    default: module.CommandPalette,
  })),
)
const SettingsDialog = lazy(() =>
  import("@/features/settings/settings-dialog").then((module) => ({
    default: module.SettingsDialog,
  })),
)

/** Keep the sidebar wide enough for a connection card's actions. */
const SIDEBAR_MIN_WIDTH = 240
const SIDEBAR_MAX_WIDTH = 420

export function AppShell() {
  const { settings } = useSettings()
  const paletteOpen = useUiStore((state) => state.paletteOpen)
  const settingsOpen = useUiStore((state) => state.settingsOpen)
  const persistLayout = useDebouncedSettingsPatch()
  const appInfo = useAppInfo()
  const startupReport = useStartupReport()
  const readyLogged = useRef(false)
  const warningsLogged = useRef(false)
  const reportErrorLogged = useRef(false)
  const sidebarWidth = Math.min(
    SIDEBAR_MAX_WIDTH,
    Math.max(SIDEBAR_MIN_WIDTH, settings.sidebarWidth),
  )

  useActivityBridge()
  useSessionBridge()
  useTransferBridge()
  useGlobalShortcuts()
  useDesktopContextMenu()

  useEffect(() => {
    if (!appInfo.data || readyLogged.current) return
    readyLogged.current = true
    recordActivity(
      "success",
      `Backend ready · sftply ${appInfo.data.version} · ${appInfo.data.platform}/${appInfo.data.arch}`,
    )
  }, [appInfo.data])

  useEffect(() => {
    if (!startupReport.data || warningsLogged.current) return
    warningsLogged.current = true
    for (const warning of startupReport.data.warnings) {
      recordActivity("warning", warning)
    }
  }, [startupReport.data])

  useEffect(() => {
    if (!startupReport.isError || reportErrorLogged.current) return
    reportErrorLogged.current = true
    recordActivity("warning", "Could not read the startup report.")
  }, [startupReport.isError])

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-background text-foreground">
      <TitleBar />

      <ResizablePanelGroup orientation="horizontal" className="min-h-0 flex-1">
        <ResizablePanel
          id="sidebar"
          defaultSize={sidebarWidth}
          minSize={SIDEBAR_MIN_WIDTH}
          maxSize={SIDEBAR_MAX_WIDTH}
          groupResizeBehavior="preserve-pixel-size"
          onResize={(size, _id, previous) => {
            if (!previous) return
            persistLayout({ sidebarWidth: Math.round(size.inPixels) })
          }}
        >
          <Sidebar />
        </ResizablePanel>

        <ResizableHandle />

        <ResizablePanel id="main" minSize={480}>
          <ResizablePanelGroup orientation="vertical" className="min-h-0">
            <ResizablePanel id="workspace" minSize={200}>
              <Workspace />
            </ResizablePanel>

            {settings.bottomPanelOpen ? (
              <>
                <ResizableHandle withHandle />
                <ResizablePanel
                  id="bottom-panel"
                  defaultSize={settings.bottomPanelHeight}
                  minSize={140}
                  maxSize={480}
                  onResize={(size, _id, previous) => {
                    if (!previous) return
                    persistLayout({ bottomPanelHeight: Math.round(size.inPixels) })
                  }}
                >
                  <BottomPanel />
                </ResizablePanel>
              </>
            ) : null}
          </ResizablePanelGroup>
        </ResizablePanel>
      </ResizablePanelGroup>

      <StatusBar />

      {paletteOpen ? (
        <Suspense fallback={null}>
          <CommandPalette />
        </Suspense>
      ) : null}
      {settingsOpen ? (
        <Suspense fallback={null}>
          <SettingsDialog />
        </Suspense>
      ) : null}
      <QuickConnectDialog />
      <HostKeyDialog />
      <TransferDragOverlay />
    </div>
  )
}
