import { cn } from "cn"
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  CopyIcon,
  LoaderCircleIcon,
  PowerIcon,
  RefreshCwIcon,
  ServerIcon,
  WifiOffIcon,
  XIcon,
} from "lucide-react"
import { useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
import { PROTOCOL_LABELS, protocolIsSecure } from "@/features/connections/schema"
import { remoteScope } from "@/features/files/api"
import { DirectoryBrowser } from "@/features/files/directory-browser"
import { FilePane } from "@/features/files/file-pane"
import { useSessionActions } from "@/features/sessions/hooks/use-session-actions"
import { copyText } from "@/lib/clipboard"
import type { SessionInfo } from "@/lib/ipc/bindings"
import { useSessionStore } from "@/stores/session-store"

/** Private MIME type so tab drags never look like file-transfer drags. */
const SESSION_DRAG_TYPE = "application/x-sftply-session"

/** Remote pane: one tab per live session, each with an isolated browser. */
export function RemotePane() {
  const sessions = useSessionStore((state) => state.sessions)
  const order = useSessionStore((state) => state.order)
  const activeSessionId = useSessionStore((state) => state.activeSessionId)
  const lost = useSessionStore((state) => state.lost)
  const reconnecting = useSessionStore((state) => state.reconnecting)
  const paths = useSessionStore((state) => state.paths)
  const setActiveSession = useSessionStore((state) => state.setActiveSession)
  const setPath = useSessionStore((state) => state.setPath)
  const moveSession = useSessionStore((state) => state.moveSession)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<{ id: string; after: boolean } | null>(null)
  const { disconnect, reconnect, cancel } = useSessionActions()

  const active = activeSessionId ? (sessions[activeSessionId] ?? null) : null

  if (!active) {
    return (
      <FilePane
        kind="remote"
        title="Remote"
        icon={ServerIcon}
        path="—"
        status="disconnected"
        emptyTitle="No active connection"
        emptyDescription="Connect a saved server from the sidebar to browse its files."
        emptyIcon={ServerIcon}
      />
    )
  }

  const lostMessage = lost[active.id]

  return (
    <div className="flex h-full min-h-0 flex-col">
      {order.length > 1 ? (
        <div
          role="tablist"
          aria-label="Remote sessions"
          className="flex h-8 shrink-0 items-center gap-1 overflow-x-auto border-b border-border/70 bg-chrome px-1.5"
        >
          {order.map((id) => {
            const session = sessions[id]
            if (!session) return null
            const selected = session.id === active.id
            const sessionLost = Boolean(lost[session.id])
            const dragging = draggingId === session.id
            const target = dropTarget?.id === session.id
            const index = order.indexOf(session.id)
            return (
              <ContextMenu key={session.id}>
                <ContextMenuTrigger asChild>
                  {/* biome-ignore lint/a11y/noStaticElementInteractions: the inner button handles activation and the context menu offers keyboard reordering; this wrapper only adds drag-and-drop. */}
                  <div
                    draggable
                    onDragStart={(event) => {
                      event.dataTransfer.effectAllowed = "move"
                      event.dataTransfer.setData(SESSION_DRAG_TYPE, session.id)
                      setDraggingId(session.id)
                    }}
                    onDragEnd={() => {
                      setDraggingId(null)
                      setDropTarget(null)
                    }}
                    onDragOver={(event) => {
                      if (!draggingId || draggingId === session.id) return
                      event.preventDefault()
                      event.dataTransfer.dropEffect = "move"
                      const rect = event.currentTarget.getBoundingClientRect()
                      setDropTarget({
                        id: session.id,
                        after: event.clientX > rect.left + rect.width / 2,
                      })
                    }}
                    onDragLeave={(event) => {
                      const related = event.relatedTarget
                      if (related instanceof Node && event.currentTarget.contains(related)) return
                      setDropTarget((current) => (current?.id === session.id ? null : current))
                    }}
                    onDrop={(event) => {
                      if (!draggingId || draggingId === session.id) return
                      event.preventDefault()
                      const from = order.indexOf(draggingId)
                      const targetIndex = order.indexOf(session.id)
                      const after = dropTarget?.id === session.id ? dropTarget.after : false
                      let to = targetIndex + (after ? 1 : 0)
                      if (from < to) to -= 1
                      moveSession(draggingId, to)
                      setDraggingId(null)
                      setDropTarget(null)
                    }}
                    className={cn(
                      "flex h-6 shrink-0 items-center rounded-md border text-2xs transition-colors",
                      selected
                        ? "border-border bg-background text-foreground"
                        : "border-transparent text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                      dragging && "opacity-50",
                      target && "ring-1 ring-primary/60",
                    )}
                  >
                    <button
                      type="button"
                      role="tab"
                      aria-selected={selected}
                      onClick={() => setActiveSession(session.id)}
                      className="flex h-full max-w-44 items-center gap-1.5 rounded-l-md px-2 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
                    >
                      {sessionLost ? (
                        <WifiOffIcon className="size-3 shrink-0 text-warning" />
                      ) : (
                        <ServerIcon className="size-3 shrink-0" />
                      )}
                      <span className="truncate">{session.name}</span>
                    </button>
                    <button
                      type="button"
                      aria-label={`Disconnect ${session.name}`}
                      onClick={() => void disconnect(session.id)}
                      className="mr-0.5 flex size-5 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
                    >
                      <XIcon className="size-3" />
                    </button>
                  </div>
                </ContextMenuTrigger>

                <ContextMenuContent className="w-52">
                  <ContextMenuLabel className="max-w-48 truncate font-normal">
                    {session.name}
                  </ContextMenuLabel>
                  <ContextMenuSeparator />
                  <ContextMenuItem
                    disabled={!sessionLost}
                    onSelect={() => void reconnect(session.id)}
                  >
                    <RefreshCwIcon />
                    Reconnect
                  </ContextMenuItem>
                  <ContextMenuItem onSelect={() => void disconnect(session.id)}>
                    <PowerIcon />
                    Disconnect
                  </ContextMenuItem>
                  <ContextMenuSeparator />
                  <ContextMenuItem
                    disabled={index <= 0}
                    onSelect={() => moveSession(session.id, index - 1)}
                  >
                    <ArrowLeftIcon />
                    Move tab left
                  </ContextMenuItem>
                  <ContextMenuItem
                    disabled={index >= order.length - 1}
                    onSelect={() => moveSession(session.id, index + 1)}
                  >
                    <ArrowRightIcon />
                    Move tab right
                  </ContextMenuItem>
                  <ContextMenuSeparator />
                  <ContextMenuItem
                    onSelect={() => void copyText(`${session.host}:${session.port}`, "Host copied")}
                  >
                    <CopyIcon />
                    Copy host
                  </ContextMenuItem>
                  <ContextMenuItem
                    onSelect={() =>
                      void copyText(
                        `${session.username}@${session.host}:${session.port}`,
                        "Login copied",
                      )
                    }
                  >
                    <CopyIcon />
                    Copy login
                  </ContextMenuItem>
                  <ContextMenuItem
                    onSelect={() =>
                      void copyText(paths[session.id] ?? session.initialPath, "Path copied")
                    }
                  >
                    <CopyIcon />
                    Copy current path
                  </ContextMenuItem>
                </ContextMenuContent>
              </ContextMenu>
            )
          })}
        </div>
      ) : null}

      <div className="min-h-0 flex-1">
        {lostMessage ? (
          <ConnectionLostPane
            session={active}
            message={lostMessage}
            reconnecting={Boolean(reconnecting[active.id])}
            onReconnect={() => void reconnect(active.id)}
            onDisconnect={() => void disconnect(active.id)}
          />
        ) : (
          <DirectoryBrowser
            key={active.id}
            pane="remote"
            title={active.name}
            icon={ServerIcon}
            scope={remoteScope(active.id)}
            initialPath={paths[active.id] ?? active.initialPath}
            allowOpenFile={false}
            allowReveal={false}
            statusLabel={`${PROTOCOL_LABELS[active.protocol]} · ${active.host}:${active.port}`}
            emptyDescription="This folder is empty. Remote uploads arrive with transfers."
            onPathChange={(path) => setPath(active.id, path)}
            onCancel={() => void cancel(active.id)}
            headerExtra={
              <>
                <Badge
                  variant={protocolIsSecure(active.protocol) ? "secondary" : "outline"}
                  className={cn(
                    "h-4.5 px-1.5 text-[10px] font-medium",
                    !protocolIsSecure(active.protocol) && "border-warning/40 text-warning",
                  )}
                >
                  {PROTOCOL_LABELS[active.protocol]}
                </Badge>
                <span className="text-2xs text-muted-foreground tabular">
                  {Math.max(1, Math.round(active.latencyMs))} ms
                </span>
              </>
            }
          />
        )}
      </div>
    </div>
  )
}

function ConnectionLostPane({
  session,
  message,
  reconnecting,
  onReconnect,
  onDisconnect,
}: {
  session: SessionInfo
  message: string
  reconnecting: boolean
  onReconnect: () => void
  onDisconnect: () => void
}) {
  return (
    <section
      aria-label={`${session.name} connection lost`}
      className="flex h-full min-h-0 flex-col bg-background"
    >
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border/70 bg-panel-header px-3">
        <ServerIcon className="size-3.5 text-warning" />
        <span className="min-w-0 truncate text-xs font-semibold text-foreground">
          {session.name}
        </span>
        <Badge
          variant="outline"
          className="h-4.5 gap-1 border-warning/40 px-1.5 text-[10px] font-medium text-warning"
        >
          <span className="size-1.5 rounded-full bg-warning" />
          Connection lost
        </Badge>
        <span className="ml-auto text-2xs text-muted-foreground">
          {PROTOCOL_LABELS[session.protocol]} · {session.host}:{session.port}
        </span>
      </div>

      <div className="flex min-h-0 flex-1 items-center justify-center p-6">
        <div className="flex max-w-[320px] flex-col items-center text-center">
          <span className="mb-3 flex size-11 items-center justify-center rounded-xl border border-warning/30 bg-warning/10 text-warning">
            <WifiOffIcon className="size-5" />
          </span>
          <h2 className="text-sm font-medium text-foreground">The connection was lost</h2>
          <p className="mt-1 text-xs leading-relaxed text-balance text-muted-foreground">
            {message}
          </p>
          <p className="mt-1 text-2xs leading-relaxed text-balance text-muted-foreground">
            Reconnecting opens a new stream to the same server. Your tab and current folder are
            kept.
          </p>
          <div className="mt-4 flex items-center gap-2">
            <Button size="sm" disabled={reconnecting} onClick={onReconnect}>
              {reconnecting ? <LoaderCircleIcon className="animate-spin" /> : <RefreshCwIcon />}
              {reconnecting ? "Reconnecting…" : "Reconnect"}
            </Button>
            <Button variant="outline" size="sm" onClick={onDisconnect}>
              <PowerIcon />
              Disconnect
            </Button>
          </div>
        </div>
      </div>

      <div className="flex h-7 shrink-0 items-center justify-between border-t border-border/60 px-3 text-2xs text-muted-foreground">
        <span>Session paused</span>
        <span className="tabular">—</span>
      </div>
    </section>
  )
}
