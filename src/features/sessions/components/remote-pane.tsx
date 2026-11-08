import { cn } from "cn"
import { ServerIcon, XIcon } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { PROTOCOL_LABELS, protocolIsSecure } from "@/features/connections/schema"
import { remoteScope } from "@/features/files/api"
import { DirectoryBrowser } from "@/features/files/directory-browser"
import { FilePane } from "@/features/files/file-pane"
import { useSessionActions } from "@/features/sessions/hooks/use-session-actions"
import { useSessionStore } from "@/stores/session-store"

/** Remote pane: one tab per live session, each with an isolated browser. */
export function RemotePane() {
  const sessions = useSessionStore((state) => state.sessions)
  const order = useSessionStore((state) => state.order)
  const activeSessionId = useSessionStore((state) => state.activeSessionId)
  const setActiveSession = useSessionStore((state) => state.setActiveSession)
  const { disconnect } = useSessionActions()

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
            return (
              <div
                key={session.id}
                className={cn(
                  "flex h-6 shrink-0 items-center rounded-md border text-2xs transition-colors",
                  selected
                    ? "border-border bg-background text-foreground"
                    : "border-transparent text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                )}
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  onClick={() => setActiveSession(session.id)}
                  className="flex h-full max-w-44 items-center gap-1.5 rounded-l-md px-2 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
                >
                  <ServerIcon className="size-3 shrink-0" />
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
            )
          })}
        </div>
      ) : null}

      <div className="min-h-0 flex-1">
        <DirectoryBrowser
          key={active.id}
          pane="remote"
          title={active.name}
          icon={ServerIcon}
          scope={remoteScope(active.id)}
          initialPath={active.initialPath}
          allowOpenFile={false}
          allowReveal={false}
          statusLabel={`${PROTOCOL_LABELS[active.protocol]} · ${active.host}:${active.port}`}
          emptyDescription="This folder is empty. Remote uploads arrive with transfers."
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
      </div>
    </div>
  )
}
