import { CopyIcon, KeyRoundIcon, ShieldAlertIcon } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { useSessionActions } from "@/features/sessions/hooks/use-session-actions"
import { copyText } from "@/lib/clipboard"
import { normalizeError } from "@/lib/errors"
import { formatFingerprint } from "@/lib/format"
import { ipc } from "@/lib/ipc/client"
import { recordActivity } from "@/stores/activity-store"
import { useHostKeyStore } from "@/stores/host-key-store"

/**
 * Blocks SFTP connections whose server key is unknown or changed. Trusting a
 * changed key is explicit and replaces the stored fingerprint.
 */
export function HostKeyDialog() {
  const challenge = useHostKeyStore((state) => state.challenge)
  const connectionId = useHostKeyStore((state) => state.connectionId)
  const retry = useHostKeyStore((state) => state.retry)
  const clear = useHostKeyStore((state) => state.clear)
  const { connect } = useSessionActions()
  const [busy, setBusy] = useState(false)

  const changed = Boolean(challenge?.previousFingerprint)

  const trustAndConnect = async () => {
    if (!challenge) return
    setBusy(true)
    try {
      await ipc.knownHostTrust(
        challenge.host,
        challenge.port,
        challenge.keyType,
        challenge.fingerprint,
      )
      recordActivity(
        "success",
        `${changed ? "Replaced" : "Trusted"} host key for ${challenge.host}:${challenge.port}`,
      )
      const retryConnection = retry
      clear()
      if (retryConnection) {
        try {
          await retryConnection()
        } catch (cause) {
          const error = normalizeError(cause)
          toast.error("Could not connect", { description: error.message })
        }
      } else if (connectionId) {
        await connect(connectionId)
      }
    } catch (cause) {
      const error = normalizeError(cause)
      toast.error("Could not save the host key", { description: error.message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <AlertDialog
      open={Boolean(challenge)}
      onOpenChange={(open) => {
        if (!open && !busy) clear()
      }}
    >
      <AlertDialogContent className="sm:max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            {changed ? (
              <ShieldAlertIcon className="size-4 text-destructive" />
            ) : (
              <KeyRoundIcon className="size-4 text-warning" />
            )}
            {changed ? "Server key changed" : "New server key"}
          </AlertDialogTitle>
          <AlertDialogDescription className="text-pretty">
            {changed
              ? "The key presented by this server does not match the one you trusted before. This can indicate a server rebuild or a man-in-the-middle attack."
              : "This server has not been trusted yet. Verify the fingerprint with the server administrator before connecting."}
          </AlertDialogDescription>
        </AlertDialogHeader>

        {challenge ? (
          <div className="selectable space-y-2 rounded-lg border border-border/70 bg-muted/30 p-3 text-xs">
            <div className="flex items-center justify-between gap-3">
              <span className="text-muted-foreground">Server</span>
              <span className="font-mono text-foreground">
                {challenge.host}:{challenge.port}
              </span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-muted-foreground">Key type</span>
              <span className="font-mono text-foreground">{challenge.keyType}</span>
            </div>
            <div className="space-y-1">
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground">Fingerprint</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  aria-label="Copy fingerprint"
                  onClick={() =>
                    void copyText(challenge.fingerprint, "Fingerprint copied to the clipboard")
                  }
                >
                  <CopyIcon />
                </Button>
              </div>
              <p className="whitespace-pre-wrap font-mono text-2xs break-all text-foreground">
                {formatFingerprint(challenge.fingerprint)}
              </p>
            </div>
            {changed && challenge.previousFingerprint ? (
              <div className="space-y-1">
                <span className="text-muted-foreground">Previously trusted</span>
                <p className="whitespace-pre-wrap font-mono text-2xs break-all text-destructive">
                  {formatFingerprint(challenge.previousFingerprint)}
                </p>
              </div>
            ) : null}
          </div>
        ) : null}

        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant={changed ? "destructive" : "default"}
            disabled={busy}
            onClick={(event) => {
              event.preventDefault()
              void trustAndConnect()
            }}
          >
            {busy ? "Saving…" : changed ? "Replace key and connect" : "Trust and connect"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
