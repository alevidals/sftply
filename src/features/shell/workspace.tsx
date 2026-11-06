import { FolderOpenIcon, HardDriveIcon, ServerOffIcon } from "lucide-react"
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable"
import { FilePane } from "@/features/files/file-pane"
import { useSettings } from "@/features/settings/settings-context"
import { useHomeDirectory } from "@/hooks/use-home-directory"
import { usePersistedLayout } from "@/hooks/use-persisted-layout"

export function Workspace() {
  const { settings } = useSettings()
  const persistLayout = usePersistedLayout()
  const home = useHomeDirectory()

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
        <FilePane
          kind="local"
          title="Local"
          icon={HardDriveIcon}
          path={home.data ?? "Home"}
          status="local"
          emptyTitle="No folder loaded"
          emptyDescription="Local file browsing is not available in this build. It is the next milestone."
          emptyIcon={FolderOpenIcon}
        />
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
