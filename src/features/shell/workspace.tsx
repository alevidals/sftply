import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable"
import { LocalBrowser } from "@/features/files/local-browser"
import { RemotePane } from "@/features/sessions/components/remote-pane"
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
        <RemotePane />
      </ResizablePanel>
    </ResizablePanelGroup>
  )
}
