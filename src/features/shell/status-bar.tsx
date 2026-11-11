import {
  ActivityIcon,
  ArrowDownUpIcon,
  HardDriveIcon,
  PanelBottomIcon,
  ServerIcon,
} from "lucide-react"
import { toast } from "sonner"
import { Kbd } from "@/components/kbd"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { PROTOCOL_LABELS } from "@/features/connections/schema"
import { pathLeaf } from "@/features/files/model/path"
import { useSettings } from "@/features/settings/settings-context"
import { useAppInfo } from "@/hooks/use-app-info"
import { errorMessage } from "@/lib/errors"
import { formatBytes, formatCount } from "@/lib/format"
import { useActivityStore } from "@/stores/activity-store"
import { useSessionStore } from "@/stores/session-store"
import {
  selectActiveTransferCount,
  selectTransferSpeed,
  useTransferStore,
} from "@/stores/transfer-store"
import { useUiStore } from "@/stores/ui-store"

export function StatusBar() {
  const { settings, updateSettings } = useSettings()
  const appInfo = useAppInfo()
  const activityCount = useActivityStore((state) => state.entries.length)
  const activeTransfers = useTransferStore(selectActiveTransferCount)
  const transferSpeed = useTransferStore(selectTransferSpeed)
  const localSummary = useUiStore((state) => state.localSummary)
  const remoteSummary = useUiStore((state) => state.remoteSummary)
  const sessions = useSessionStore((state) => state.sessions)
  const sessionCount = useSessionStore((state) => state.order.length)
  const activeSessionId = useSessionStore((state) => state.activeSessionId)
  const setBottomTab = useUiStore((state) => state.setBottomTab)
  const activeSession = activeSessionId ? sessions[activeSessionId] : undefined

  const openPanel = (tab: "transfers" | "activity") => {
    setBottomTab(tab)
    if (!settings.bottomPanelOpen) {
      updateSettings({ bottomPanelOpen: true }).catch((error) => {
        toast.error("Could not open the panel", { description: errorMessage(error) })
      })
    }
  }

  const togglePanel = () => {
    updateSettings({ bottomPanelOpen: !settings.bottomPanelOpen }).catch((error) => {
      toast.error("Could not update the panel", { description: errorMessage(error) })
    })
  }

  return (
    <footer className="flex h-7 shrink-0 items-center gap-3 border-t border-border/70 bg-chrome px-3 text-2xs text-muted-foreground select-none">
      <span className="flex min-w-0 items-center gap-1.5">
        <HardDriveIcon className="size-3 shrink-0" />
        <span className="max-w-[180px] truncate">
          {localSummary.path ? pathLeaf(localSummary.path) : "Local"}
        </span>
      </span>

      {localSummary.path ? (
        <span className="shrink-0 tabular">
          {formatCount(localSummary.items)} items
          {localSummary.selected > 0 ? ` · ${formatCount(localSummary.selected)} selected` : ""}
        </span>
      ) : null}

      <span className="h-3 w-px bg-border/80" />

      {activeSession ? (
        <>
          <span className="flex min-w-0 items-center gap-1.5">
            <ServerIcon className="size-3 shrink-0 text-success" />
            <span className="max-w-[160px] truncate text-foreground">{activeSession.name}</span>
            <span className="shrink-0 text-muted-foreground/60">
              {PROTOCOL_LABELS[activeSession.protocol]}
            </span>
          </span>
          {remoteSummary.path ? (
            <span className="shrink-0 tabular">
              {formatCount(remoteSummary.items)} items
              {remoteSummary.selected > 0
                ? ` · ${formatCount(remoteSummary.selected)} selected`
                : ""}
            </span>
          ) : null}
          {sessionCount > 1 ? (
            <span className="shrink-0 text-muted-foreground/60 tabular">
              {sessionCount} sessions
            </span>
          ) : null}
        </>
      ) : (
        <span className="flex items-center gap-1.5">
          <span className="size-1.5 rounded-full bg-warning" />
          <span>Remote</span>
          <span className="text-muted-foreground/60">Not connected</span>
        </span>
      )}

      <div className="ml-auto flex items-center gap-0.5">
        <StatusButton label="Transfers" onClick={() => openPanel("transfers")}>
          <ArrowDownUpIcon className="size-3" />
          <span className="tabular">{activeTransfers}</span>
          {transferSpeed > 0 ? (
            <span className="tabular text-muted-foreground/70">{formatBytes(transferSpeed)}/s</span>
          ) : null}
        </StatusButton>

        <StatusButton label="Activity" onClick={() => openPanel("activity")}>
          <ActivityIcon className="size-3" />
          <span className="tabular">{activityCount}</span>
        </StatusButton>

        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={togglePanel}
              aria-label={settings.bottomPanelOpen ? "Hide panel" : "Show panel"}
              className="flex h-5 items-center rounded px-1.5 transition-colors hover:bg-muted/60 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
            >
              <PanelBottomIcon className="size-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="top" sideOffset={6}>
            {settings.bottomPanelOpen ? "Hide panel" : "Show panel"} <Kbd className="ml-1">⌘J</Kbd>
          </TooltipContent>
        </Tooltip>

        <span className="mx-1 h-3 w-px bg-border/80" />

        <span className="px-1 font-mono text-[10px] text-muted-foreground/70">
          {appInfo.data
            ? `v${appInfo.data.version} · ${appInfo.data.platform}/${appInfo.data.arch}`
            : "sftply"}
        </span>

        <Kbd className="ml-1 hidden md:inline-flex">⌘K</Kbd>
      </div>
    </footer>
  )
}

function StatusButton({
  label,
  onClick,
  children,
}: {
  label: string
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="flex h-5 items-center gap-1 rounded px-1.5 transition-colors hover:bg-muted/60 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
    >
      {children}
    </button>
  )
}
