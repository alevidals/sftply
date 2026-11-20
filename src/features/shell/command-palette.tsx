import {
  ActivityIcon,
  ArrowDownUpIcon,
  ArrowLeftRightIcon,
  CopyIcon,
  EyeIcon,
  EyeOffIcon,
  HardDriveIcon,
  HistoryIcon,
  PanelBottomIcon,
  PowerIcon,
  RefreshCwIcon,
  ServerIcon,
  Settings2Icon,
  Trash2Icon,
  XIcon,
  ZapIcon,
} from "lucide-react"
import { toast } from "sonner"
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command"
import { useSessionActions } from "@/features/sessions/hooks/use-session-actions"
import { useSettings } from "@/features/settings/settings-context"
import { transfersApi } from "@/features/transfers/api"
import { useAppInfo } from "@/hooks/use-app-info"
import { copyText } from "@/lib/clipboard"
import { allThemeOptions } from "@/lib/custom-theme"
import { errorMessage } from "@/lib/errors"
import { shortcutLabel } from "@/lib/shortcuts"
import { useSessionStore } from "@/stores/session-store"
import { useTransferStore } from "@/stores/transfer-store"
import { useUiStore } from "@/stores/ui-store"

export function CommandPalette() {
  const { settings, updateSettings, themes } = useSettings()
  const appInfo = useAppInfo()
  const open = useUiStore((state) => state.paletteOpen)
  const setOpen = useUiStore((state) => state.setPaletteOpen)
  const setActivePane = useUiStore((state) => state.setActivePane)
  const setSettingsOpen = useUiStore((state) => state.setSettingsOpen)
  const setSettingsTab = useUiStore((state) => state.setSettingsTab)
  const setQuickConnectOpen = useUiStore((state) => state.setQuickConnectOpen)
  const setSyncCompareOpen = useUiStore((state) => state.setSyncCompareOpen)
  const setBottomTab = useUiStore((state) => state.setBottomTab)
  const activeSessionId = useSessionStore((state) => state.activeSessionId)
  const localPath = useUiStore((state) => state.localSummary.path)
  const remotePath = useUiStore((state) => state.remoteSummary.path)
  const hasFinished = useTransferStore((state) =>
    state.order.some((id) => {
      const item = state.items[id]
      return item ? !["queued", "running"].includes(item.status) : false
    }),
  )
  const { reconnect, cancel, disconnect } = useSessionActions()

  const reconnectActive = () => {
    const sessionId = useSessionStore.getState().activeSessionId
    if (!sessionId) {
      toast.info("No remote session is active.")
      return
    }
    void reconnect(sessionId)
  }

  const cancelActive = () => {
    const sessionId = useSessionStore.getState().activeSessionId
    if (!sessionId) {
      toast.info("No remote session is active.")
      return
    }
    void cancel(sessionId)
  }

  const disconnectActive = () => {
    const sessionId = useSessionStore.getState().activeSessionId
    if (!sessionId) {
      toast.info("No remote session is active.")
      return
    }
    void disconnect(sessionId)
  }

  const copyPath = (label: string, path: string | null) => {
    if (!path) {
      toast.info(`No ${label.toLowerCase()} path is available.`)
      return
    }
    void copyText(path, `${label} path copied`)
  }

  const toggleHiddenFiles = () => {
    run(() => {
      updateSettings({ showHiddenFiles: !settings.showHiddenFiles }).catch((error) => {
        toast.error("Could not update hidden files", { description: errorMessage(error) })
      })
    })
  }

  const clearFinished = () => {
    run(() => {
      const state = useTransferStore.getState()
      const finished = state.order.filter((id) => {
        const item = state.items[id]
        return item ? !["queued", "running"].includes(item.status) : false
      })
      transfersApi
        .clearFinished()
        .then((removed) => {
          if (removed > 0) state.remove(finished)
        })
        .catch((error) => {
          toast.error("Could not clear finished transfers", { description: errorMessage(error) })
        })
    })
  }

  const run = (action: () => void) => {
    setOpen(false)
    action()
  }

  const focusPane = (pane: "local" | "remote") => {
    run(() => {
      setActivePane(pane)
      requestAnimationFrame(() => {
        document.getElementById(`pane-${pane}`)?.focus()
      })
    })
  }

  const showPanel = (tab: "transfers" | "activity" | "history") => {
    run(() => {
      setBottomTab(tab)
      if (!settings.bottomPanelOpen) {
        updateSettings({ bottomPanelOpen: true }).catch((error) => {
          toast.error("Could not open the panel", { description: errorMessage(error) })
        })
      }
    })
  }

  const changeTheme = (mode: string) => {
    run(() => {
      updateSettings({ theme: mode }).catch((error) => {
        toast.error("Could not change the theme", { description: errorMessage(error) })
      })
    })
  }

  const togglePanel = () => {
    run(() => {
      updateSettings({ bottomPanelOpen: !settings.bottomPanelOpen }).catch((error) => {
        toast.error("Could not update the panel", { description: errorMessage(error) })
      })
    })
  }

  const copyDiagnostics = () => {
    run(() => {
      const info = appInfo.data
      const lines = [
        "sftply diagnostics",
        `version: ${info?.version ?? "unknown"}`,
        `platform: ${info?.platform ?? "unknown"}/${info?.arch ?? "unknown"}`,
        `theme: ${settings.theme}`,
        `density: ${settings.density}`,
        `config: ${info?.configDir ?? "unknown"}`,
        `logs: ${info?.logDir ?? "unknown"}`,
      ]
      navigator.clipboard.writeText(lines.join("\n")).then(
        () => toast.success("Diagnostics copied to the clipboard"),
        (error) =>
          toast.error("Could not copy diagnostics", {
            description: errorMessage(error),
          }),
      )
    })
  }

  return (
    <CommandDialog
      open={open}
      onOpenChange={setOpen}
      title="Command palette"
      description="Search for a command or jump to a pane."
    >
      <CommandInput placeholder="Type a command or search…" />
      <CommandList>
        <CommandEmpty>No matching commands.</CommandEmpty>

        <CommandGroup heading="Appearance">
          {allThemeOptions(themes).map(({ value, label, icon: Icon }) => (
            <CommandItem
              key={value}
              value={`${label} theme`}
              data-checked={settings.theme === value}
              onSelect={() => changeTheme(value)}
            >
              <Icon className="text-muted-foreground" />
              {label} theme
            </CommandItem>
          ))}
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading="Navigate">
          <CommandItem value="focus local pane" onSelect={() => focusPane("local")}>
            <HardDriveIcon className="text-muted-foreground" />
            Focus local pane
            <CommandShortcut>{shortcutLabel("focus-local")}</CommandShortcut>
          </CommandItem>
          <CommandItem value="focus remote pane" onSelect={() => focusPane("remote")}>
            <ServerIcon className="text-muted-foreground" />
            Focus remote pane
            <CommandShortcut>{shortcutLabel("focus-remote")}</CommandShortcut>
          </CommandItem>
          <CommandItem value="show activity" onSelect={() => showPanel("activity")}>
            <ActivityIcon className="text-muted-foreground" />
            Show activity
          </CommandItem>
          <CommandItem value="show transfers" onSelect={() => showPanel("transfers")}>
            <ArrowDownUpIcon className="text-muted-foreground" />
            Show transfers
          </CommandItem>
          <CommandItem value="show transfer history" onSelect={() => showPanel("history")}>
            <HistoryIcon className="text-muted-foreground" />
            Show transfer history
          </CommandItem>
          <CommandItem value="toggle bottom panel" onSelect={togglePanel}>
            <PanelBottomIcon className="text-muted-foreground" />
            Toggle bottom panel
            <CommandShortcut>{shortcutLabel("panel")}</CommandShortcut>
          </CommandItem>
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading="Connections">
          <CommandItem
            value="quick connect ad hoc server"
            onSelect={() =>
              run(() => {
                setQuickConnectOpen(true)
              })
            }
          >
            <ZapIcon className="text-muted-foreground" />
            Quick connect…
          </CommandItem>
          <CommandItem
            value="reconnect active session"
            disabled={!activeSessionId}
            onSelect={() => run(reconnectActive)}
          >
            <RefreshCwIcon className="text-muted-foreground" />
            Reconnect active session
          </CommandItem>
          <CommandItem
            value="disconnect active session"
            disabled={!activeSessionId}
            onSelect={() => run(disconnectActive)}
          >
            <PowerIcon className="text-muted-foreground" />
            Disconnect active session
          </CommandItem>
          <CommandItem
            value="cancel remote operation"
            disabled={!activeSessionId}
            onSelect={() => run(cancelActive)}
          >
            <XIcon className="text-muted-foreground" />
            Cancel remote operation
          </CommandItem>
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading="Files">
          <CommandItem
            value="copy local path"
            onSelect={() => run(() => copyPath("Local", localPath))}
          >
            <CopyIcon className="text-muted-foreground" />
            Copy local path
          </CommandItem>
          <CommandItem
            value="copy remote path"
            onSelect={() => run(() => copyPath("Remote", remotePath))}
          >
            <CopyIcon className="text-muted-foreground" />
            Copy remote path
          </CommandItem>
          <CommandItem
            value="toggle hidden files"
            data-checked={settings.showHiddenFiles}
            onSelect={() => run(toggleHiddenFiles)}
          >
            {settings.showHiddenFiles ? (
              <EyeOffIcon className="text-muted-foreground" />
            ) : (
              <EyeIcon className="text-muted-foreground" />
            )}
            {settings.showHiddenFiles ? "Hide hidden files" : "Show hidden files"}
          </CommandItem>
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading="Sync">
          <CommandItem
            value="compare local and remote folders"
            disabled={!localPath || !remotePath || !activeSessionId}
            onSelect={() => run(() => setSyncCompareOpen(true))}
          >
            <ArrowLeftRightIcon className="text-muted-foreground" />
            Compare folders…
            <CommandShortcut>{shortcutLabel("compare")}</CommandShortcut>
          </CommandItem>
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading="Transfers">
          <CommandItem
            value="clear finished transfers"
            disabled={!hasFinished}
            onSelect={() => run(clearFinished)}
          >
            <Trash2Icon className="text-muted-foreground" />
            Clear finished transfers
          </CommandItem>
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading="Application">
          <CommandItem
            value="settings preferences"
            onSelect={() =>
              run(() => {
                setSettingsOpen(true)
              })
            }
          >
            <Settings2Icon className="text-muted-foreground" />
            Open settings
            <CommandShortcut>{shortcutLabel("settings")}</CommandShortcut>
          </CommandItem>
          <CommandItem
            value="keyboard shortcuts reference"
            onSelect={() =>
              run(() => {
                setSettingsTab("shortcuts")
                setSettingsOpen(true)
              })
            }
          >
            <Settings2Icon className="text-muted-foreground" />
            Keyboard shortcuts
            <CommandShortcut>{shortcutLabel("shortcuts")}</CommandShortcut>
          </CommandItem>
          <CommandItem value="copy diagnostics" onSelect={copyDiagnostics}>
            <CopyIcon className="text-muted-foreground" />
            Copy diagnostics
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  )
}
