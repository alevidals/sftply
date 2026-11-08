import { useQueryClient } from "@tanstack/react-query"
import { cn } from "cn"
import {
  CopyIcon,
  LoaderCircleIcon,
  MoreHorizontalIcon,
  PencilIcon,
  PlayIcon,
  PlusIcon,
  PowerIcon,
  ServerIcon,
  StarIcon,
  StarOffIcon,
  Trash2Icon,
  ZapIcon,
} from "lucide-react"
import { useMemo, useState } from "react"
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
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { connectionsApi } from "@/features/connections/api"
import { ConnectionDialog } from "@/features/connections/components/connection-form-dialog"
import { connectionsQueryKey, useConnections } from "@/features/connections/hooks/use-connections"
import { PROTOCOL_LABELS, protocolIsSecure } from "@/features/connections/schema"
import { useSessionActions } from "@/features/sessions/hooks/use-session-actions"
import { errorMessage } from "@/lib/errors"
import type { ConnectionProfile_Serialize, SessionInfo } from "@/lib/ipc/bindings"
import { recordActivity } from "@/stores/activity-store"
import { sessionForConnection, useSessionStore } from "@/stores/session-store"
import { useUiStore } from "@/stores/ui-store"

export function ConnectionsPanel() {
  const { data: connections, isPending, isError, error, refetch } = useConnections()
  const queryClient = useQueryClient()
  const sessions = useSessionStore((state) => state.sessions)
  const connecting = useSessionStore((state) => state.connecting)
  const activeSessionId = useSessionStore((state) => state.activeSessionId)
  const setActiveSession = useSessionStore((state) => state.setActiveSession)
  const setActivePane = useUiStore((state) => state.setActivePane)
  const setQuickConnectOpen = useUiStore((state) => state.setQuickConnectOpen)
  const { connect, disconnect } = useSessionActions()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<ConnectionProfile_Serialize | null>(null)
  const [deleting, setDeleting] = useState<ConnectionProfile_Serialize | null>(null)

  const sorted = useMemo(() => {
    return [...(connections ?? [])].sort((a, b) => {
      if (a.favorite !== b.favorite) return a.favorite ? -1 : 1
      return a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
    })
  }, [connections])

  const openCreate = () => {
    setEditing(null)
    setDialogOpen(true)
  }

  const openEdit = (connection: ConnectionProfile_Serialize) => {
    setEditing(connection)
    setDialogOpen(true)
  }

  const refresh = () => queryClient.invalidateQueries({ queryKey: connectionsQueryKey })

  const report = (title: string, cause: unknown) => {
    toast.error(title, { description: errorMessage(cause) })
    recordActivity("error", `${title}: ${errorMessage(cause)}`)
  }

  const toggleFavorite = async (connection: ConnectionProfile_Serialize) => {
    try {
      await connectionsApi.setFavorite(connection.id, !connection.favorite)
      await refresh()
    } catch (cause) {
      report("Could not update the favorite", cause)
    }
  }

  const duplicate = async (connection: ConnectionProfile_Serialize) => {
    try {
      const copy = await connectionsApi.duplicate(connection.id)
      await refresh()
      recordActivity("success", `Duplicated connection “${connection.name}”`)
      toast.success(`Created “${copy.name}”`)
    } catch (cause) {
      report("Could not duplicate the connection", cause)
    }
  }

  const remove = async () => {
    if (!deleting) return
    try {
      await connectionsApi.remove(deleting.id)
      await refresh()
      recordActivity("success", `Deleted connection “${deleting.name}”`)
      toast.success(`Deleted “${deleting.name}”`)
      setDeleting(null)
    } catch (cause) {
      report("Could not delete the connection", cause)
    }
  }

  return (
    <>
      <div className="flex h-11 shrink-0 items-center justify-between border-b border-sidebar-border/70 px-3">
        <span className="text-2xs font-semibold tracking-[0.14em] text-muted-foreground uppercase">
          Connections
        </span>
        <div className="flex items-center gap-0.5">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label="Quick connect"
                onClick={() => setQuickConnectOpen(true)}
              >
                <ZapIcon />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" sideOffset={6}>
              Quick connect
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label="New connection"
                onClick={openCreate}
              >
                <PlusIcon />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" sideOffset={6}>
              New connection
            </TooltipContent>
          </Tooltip>
        </div>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-1 p-2">
          {isPending ? (
            <div className="space-y-1" aria-label="Loading connections" role="status">
              {[0, 1, 2].map((index) => (
                <div
                  key={index}
                  className="flex items-center gap-2 rounded-md px-2 py-2"
                  aria-hidden
                >
                  <span className="size-5 animate-pulse rounded bg-muted/60" />
                  <span className="h-3 flex-1 animate-pulse rounded bg-muted/50" />
                </div>
              ))}
            </div>
          ) : isError ? (
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-4 text-center">
              <p className="text-xs font-medium text-foreground">Could not load connections</p>
              <p className="mt-1 text-2xs text-muted-foreground">{errorMessage(error)}</p>
              <Button variant="outline" size="sm" className="mt-2" onClick={() => void refetch()}>
                Try again
              </Button>
            </div>
          ) : sorted.length === 0 ? (
            <div className="rounded-lg border border-dashed border-sidebar-border bg-background/30 px-3 py-5 text-center">
              <span className="mx-auto mb-3 flex size-9 items-center justify-center rounded-lg border border-sidebar-border bg-sidebar-accent/60 text-muted-foreground">
                <ServerIcon className="size-4" />
              </span>
              <p className="text-xs font-medium text-foreground">No connections yet</p>
              <p className="mx-auto mt-1 max-w-[180px] text-2xs leading-relaxed text-muted-foreground">
                Save FTP, FTPS or SFTP servers here. Credentials go to your keychain.
              </p>
              <Button variant="outline" size="sm" className="mt-3" onClick={openCreate}>
                <PlusIcon />
                Add connection
              </Button>
            </div>
          ) : (
            sorted.map((connection) => (
              <ConnectionRow
                key={connection.id}
                connection={connection}
                session={sessionForConnection(sessions, connection.id)}
                connecting={Boolean(connecting[connection.id])}
                active={
                  Boolean(sessions[activeSessionId ?? ""]) &&
                  sessions[activeSessionId ?? ""]?.connectionId === connection.id
                }
                onActivate={(sessionId) => {
                  setActiveSession(sessionId)
                  setActivePane("remote")
                }}
                onConnect={() => void connect(connection.id)}
                onDisconnect={(sessionId) => void disconnect(sessionId)}
                onEdit={() => openEdit(connection)}
                onDuplicate={() => void duplicate(connection)}
                onFavorite={() => void toggleFavorite(connection)}
                onDelete={() => setDeleting(connection)}
              />
            ))
          )}
        </div>
      </ScrollArea>

      <ConnectionDialog open={dialogOpen} connection={editing} onOpenChange={setDialogOpen} />

      <AlertDialog open={Boolean(deleting)} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{deleting?.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              The saved metadata and any keychain credentials for this connection will be removed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => void remove()}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

function ConnectionRow({
  connection,
  session,
  connecting,
  active,
  onActivate,
  onConnect,
  onDisconnect,
  onEdit,
  onDuplicate,
  onFavorite,
  onDelete,
}: {
  connection: ConnectionProfile_Serialize
  session: SessionInfo | null
  connecting: boolean
  active: boolean
  onActivate: (sessionId: string) => void
  onConnect: () => void
  onDisconnect: (sessionId: string) => void
  onEdit: () => void
  onDuplicate: () => void
  onFavorite: () => void
  onDelete: () => void
}) {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          className={cn(
            "group flex items-center gap-0.5 rounded-md transition-colors",
            active ? "bg-sidebar-accent" : "hover:bg-sidebar-accent/70",
          )}
        >
          <button
            type="button"
            onClick={() => (session ? onActivate(session.id) : onConnect())}
            className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:outline-none"
            aria-label={`${connection.name}, ${PROTOCOL_LABELS[connection.protocol]} ${connection.host}${session ? ", connected" : ""}`}
          >
            <span
              className={cn(
                "relative flex size-5 shrink-0 items-center justify-center rounded border",
                protocolIsSecure(connection.protocol)
                  ? "border-success/30 bg-success/10 text-success"
                  : "border-border bg-muted/50 text-muted-foreground",
              )}
            >
              <ServerIcon className="size-3" />
              {session ? (
                <span className="absolute -top-0.5 -right-0.5 size-1.5 rounded-full bg-success ring-2 ring-sidebar" />
              ) : null}
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1">
                <span className="truncate text-xs font-medium text-foreground">
                  {connection.name}
                </span>
                {connection.favorite ? (
                  <StarIcon className="size-2.5 shrink-0 fill-warning text-warning" />
                ) : null}
              </span>
              <span className="flex items-center gap-1 truncate text-2xs text-muted-foreground">
                <span>{PROTOCOL_LABELS[connection.protocol]}</span>
                <span className="text-muted-foreground/40">·</span>
                <span className="truncate font-mono">{connection.host}</span>
                {session ? (
                  <>
                    <span className="text-muted-foreground/40">·</span>
                    <span className="text-success">
                      {Math.max(1, Math.round(session.latencyMs))} ms
                    </span>
                  </>
                ) : connection.group ? (
                  <>
                    <span className="text-muted-foreground/40">·</span>
                    <span className="truncate">{connection.group}</span>
                  </>
                ) : null}
              </span>
            </span>
          </button>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label={
                  connecting
                    ? `Connecting to ${connection.name}`
                    : session
                      ? `Disconnect from ${connection.name}`
                      : `Connect to ${connection.name}`
                }
                disabled={connecting}
                onClick={() => (session ? onDisconnect(session.id) : onConnect())}
                className={cn(
                  "shrink-0 text-muted-foreground",
                  session && "text-success",
                  !session &&
                    !connecting &&
                    "opacity-0 group-hover:opacity-100 focus-visible:opacity-100",
                )}
              >
                {connecting ? (
                  <LoaderCircleIcon className="animate-spin" />
                ) : session ? (
                  <PowerIcon />
                ) : (
                  <PlayIcon />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right" sideOffset={6}>
              {connecting ? "Connecting…" : session ? "Disconnect" : "Connect"}
            </TooltipContent>
          </Tooltip>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label={`Actions for ${connection.name}`}
                className="mr-1 shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
              >
                <MoreHorizontalIcon />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              {session ? (
                <DropdownMenuItem onSelect={() => onDisconnect(session.id)}>
                  <PowerIcon />
                  Disconnect
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem disabled={connecting} onSelect={onConnect}>
                  <PlayIcon />
                  Connect
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={onEdit}>
                <PencilIcon />
                Edit
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={onFavorite}>
                {connection.favorite ? <StarOffIcon /> : <StarIcon />}
                {connection.favorite ? "Unpin" : "Pin to favorites"}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={onDuplicate}>
                <CopyIcon />
                Duplicate
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={onDelete}>
                <Trash2Icon />
                Delete…
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </ContextMenuTrigger>

      <ContextMenuContent className="w-48">
        {session ? (
          <ContextMenuItem onSelect={() => onDisconnect(session.id)}>
            <PowerIcon />
            Disconnect
          </ContextMenuItem>
        ) : (
          <ContextMenuItem disabled={connecting} onSelect={onConnect}>
            <PlayIcon />
            Connect
          </ContextMenuItem>
        )}
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={onEdit}>
          <PencilIcon />
          Edit
        </ContextMenuItem>
        <ContextMenuItem onSelect={onFavorite}>
          {connection.favorite ? <StarOffIcon /> : <StarIcon />}
          {connection.favorite ? "Unpin" : "Pin to favorites"}
        </ContextMenuItem>
        <ContextMenuItem onSelect={onDuplicate}>
          <CopyIcon />
          Duplicate
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem variant="destructive" onSelect={onDelete}>
          <Trash2Icon />
          Delete…
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}
