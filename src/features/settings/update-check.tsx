import { openUrl } from "@tauri-apps/plugin-opener"
import { CheckCircle2Icon, DownloadIcon, ExternalLinkIcon, RefreshCwIcon } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { errorMessage } from "@/lib/errors"
import type { UpdateStatus } from "@/lib/ipc/bindings"
import { ipc } from "@/lib/ipc/client"

type Phase = "idle" | "checking" | "done"

/**
 * Manual update check. One request to the GitHub releases API, no background
 * polling and no download: the user opens the release page in a browser.
 */
export function UpdateCheck() {
  const [phase, setPhase] = useState<Phase>("idle")
  const [result, setResult] = useState<UpdateStatus | null>(null)

  const check = async () => {
    setPhase("checking")
    try {
      const status = await ipc.checkUpdate()
      setResult(status)
      setPhase("done")
      if (status.updateAvailable) {
        toast.success(`sftply ${status.latestVersion} is available`)
      } else {
        toast.success(`sftply ${status.currentVersion} is up to date`)
      }
    } catch (cause) {
      setPhase("idle")
      toast.error("Could not check for updates", { description: errorMessage(cause) })
    }
  }

  return (
    <div className="space-y-3 rounded-lg border border-border/70 bg-muted/20 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium">Updates</p>
          <p className="mt-0.5 text-2xs leading-relaxed text-muted-foreground">
            Checks the public releases page once. Nothing is downloaded automatically.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void check()}
          disabled={phase === "checking"}
        >
          {phase === "checking" ? <Spinner /> : <RefreshCwIcon />}
          Check for updates
        </Button>
      </div>

      {phase === "done" && result ? (
        result.updateAvailable ? (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-primary/25 bg-primary/5 px-2.5 py-2">
            <p className="flex items-center gap-1.5 text-xs">
              <DownloadIcon className="size-3.5 text-primary" />
              sftply <span className="font-mono">{result.latestVersion}</span> is available.
            </p>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => void openUrl(result.releaseUrl)}
            >
              Release page
              <ExternalLinkIcon />
            </Button>
          </div>
        ) : (
          <p className="flex items-center gap-1.5 px-0.5 text-xs text-muted-foreground">
            <CheckCircle2Icon className="size-3.5 text-success" />
            You are on the latest version.
          </p>
        )
      ) : null}
    </div>
  )
}
