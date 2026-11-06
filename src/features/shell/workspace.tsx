import { ServerOffIcon } from "lucide-react"
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable"
import { FilePane } from "@/features/files/file-pane"
import { LocalBrowser } from "@/features/files/local-browser"
import { useSettings } from "@/features/settings/settings-context"
import { useDebouncedSettingsPatch } from "@/hooks/use-debounced-settings"

export function Workspace() {
  const { settings } = useSettings()
  const persistLayout = useDebouncedSettingsPatch()

  return (
    <ResizablePanelGroup orientation="horizontal" className="min-h-0">
      <ResizablePanel
        id="local-pane"
        defaultSize={`${settings.paneSplit}%`}
        minSize="25%"
        maxSize="75%"
        onResize={(size, _id, previous) => {
          if (!previous) return
          persistLayout({ paneSplit: Math.round(size.asPercentage) })
        }}
      >
        <LocalBrowser />
      </ResizablePanel>

      <ResizableHandle />

      <ResizablePanel id="remote-pane" minSize="25%">
        <FilePane
          kind="remote"
          title="Remote"
          icon={ServerOffIcon}
          path="—"
          status="disconnected"
          emptyTitle="No active connection"
          emptyDescription="Saved servers will appear in the sidebar. Connecting to a remote host is not available in this build."
          emptyIcon={ServerOffIcon}
        />
      </ResizablePanel>
    </ResizablePanelGroup>
  )
}
