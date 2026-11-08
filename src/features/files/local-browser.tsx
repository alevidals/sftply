import { AlertTriangleIcon, HardDriveIcon, LoaderCircleIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { LOCAL_SCOPE } from "@/features/files/api"
import { DirectoryBrowser } from "@/features/files/directory-browser"
import { useSettings } from "@/features/settings/settings-context"
import { useDebouncedSettingsPatch } from "@/hooks/use-debounced-settings"
import { useHomeDirectory } from "@/hooks/use-home-directory"
import { normalizeError } from "@/lib/errors"

/** Local pane: resolves the starting folder, then mounts the shared browser. */
export function LocalBrowser() {
  const { settings } = useSettings()
  const persistSettings = useDebouncedSettingsPatch()
  const home = useHomeDirectory()

  const initialPath = settings.lastLocalPath ?? home.data ?? null

  if (!initialPath) {
    if (home.isError) {
      const normalized = normalizeError(home.error)
      return (
        <div className="flex h-full min-h-0 items-center justify-center p-6">
          <div className="flex max-w-[320px] flex-col items-center text-center">
            <span className="mb-3 flex size-11 items-center justify-center rounded-xl border border-destructive/30 bg-destructive/10 text-destructive">
              <AlertTriangleIcon className="size-5" />
            </span>
            <h2 className="text-sm font-medium text-foreground">Could not find your home folder</h2>
            <p className="mt-1 text-xs text-muted-foreground">{normalized.message}</p>
            <Button
              variant="outline"
              size="sm"
              className="mt-3"
              onClick={() => void home.refetch()}
            >
              Try again
            </Button>
          </div>
        </div>
      )
    }

    return (
      <div className="flex h-full min-h-0 flex-col items-center justify-center gap-3 text-center">
        <LoaderCircleIcon className="size-5 animate-spin text-muted-foreground" />
        <p className="text-xs text-muted-foreground">Finding your home folder…</p>
      </div>
    )
  }

  return (
    <DirectoryBrowser
      pane="local"
      title="Local"
      icon={HardDriveIcon}
      scope={LOCAL_SCOPE}
      initialPath={initialPath}
      allowOpenFile
      allowReveal
      homePath={home.data}
      statusLabel="Local filesystem"
      onPathChange={(path) => persistSettings({ lastLocalPath: path })}
    />
  )
}
