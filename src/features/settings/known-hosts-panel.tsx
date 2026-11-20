import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { CopyIcon, ShieldCheckIcon, Trash2Icon } from "lucide-react"
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
import { Spinner } from "@/components/ui/spinner"
import { useFormatPreferences } from "@/features/settings/settings-context"
import { copyText } from "@/lib/clipboard"
import { errorMessage } from "@/lib/errors"
import { formatModified } from "@/lib/format"
import type { KnownHost } from "@/lib/ipc/bindings"
import { ipc } from "@/lib/ipc/client"

export const KNOWN_HOSTS_QUERY_KEY = ["known-hosts"] as const

/** Trusted SFTP host keys. Removing one forces the next connection to review it again. */
export function KnownHostsPanel() {
  const { dateFormat } = useFormatPreferences()
  const queryClient = useQueryClient()
  const [removing, setRemoving] = useState<KnownHost | null>(null)
  const hosts = useQuery({
    queryKey: KNOWN_HOSTS_QUERY_KEY,
    queryFn: ipc.knownHostsList,
    retry: 1,
  })
  const remove = useMutation({
    mutationFn: (host: KnownHost) => ipc.knownHostRemove(host.host, host.port),
    onSuccess: async (_, host) => {
      await queryClient.invalidateQueries({ queryKey: KNOWN_HOSTS_QUERY_KEY })
      toast.success(`Removed the host key for ${host.host}:${host.port}`)
      setRemoving(null)
    },
    onError: (cause) => {
      toast.error("Could not remove the host key", { description: errorMessage(cause) })
    },
  })

  return (
    <div className="min-w-0 space-y-4">
      <div>
        <h3 className="text-sm font-medium">Known SSH hosts</h3>
        <p className="text-xs text-muted-foreground">
          SFTP servers whose host keys you have trusted. Removing one means the next connection must
          be reviewed again.
        </p>
      </div>

      {hosts.isPending ? (
        <div className="flex items-center gap-2 rounded-lg border border-border/70 bg-muted/20 p-3 text-xs text-muted-foreground">
          <Spinner />
          Loading known hosts…
        </div>
      ) : hosts.isError ? (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
          {errorMessage(hosts.error)}
        </div>
      ) : hosts.data.length === 0 ? (
        <div className="flex items-start gap-2 rounded-lg border border-border/70 bg-muted/20 p-3">
          <ShieldCheckIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <p className="text-xs text-muted-foreground">
            No SSH hosts are trusted yet. sftply asks the first time you connect to an SFTP server.
          </p>
        </div>
      ) : (
        <div className="min-w-0 divide-y divide-border/70 overflow-hidden rounded-lg border border-border/70">
          {hosts.data.map((host) => (
            <div key={`${host.host}:${host.port}`} className="min-w-0 space-y-2 p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-mono text-xs">
                    {host.host}:{host.port}
                  </p>
                  <p className="text-2xs text-muted-foreground">
                    {host.keyType} · trusted {formatModified(host.addedAt, dateFormat)}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label={`Remove the host key for ${host.host}:${host.port}`}
                  disabled={remove.isPending}
                  onClick={() => setRemoving(host)}
                >
                  <Trash2Icon />
                  Remove
                </Button>
              </div>
              <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-md border border-border/60 bg-muted/30 pr-1.5">
                <div className="min-w-0 overflow-x-auto overscroll-x-contain">
                  <code className="block w-max whitespace-nowrap px-3 py-2 font-mono text-2xs text-muted-foreground">
                    {host.fingerprint}
                  </code>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  className="shrink-0"
                  aria-label={`Copy the fingerprint for ${host.host}:${host.port}`}
                  onClick={() =>
                    void copyText(host.fingerprint, "Fingerprint copied to the clipboard")
                  }
                >
                  <CopyIcon />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <AlertDialog open={Boolean(removing)} onOpenChange={(open) => !open && setRemoving(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Remove the key for {removing?.host}:{removing?.port}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              The next SFTP connection to this server will ask you to verify its host key again.
              This does not affect the server or any saved password.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={remove.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={remove.isPending}
              onClick={(event) => {
                event.preventDefault()
                if (removing) remove.mutate(removing)
              }}
            >
              {remove.isPending ? "Removing…" : "Remove key"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
