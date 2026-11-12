import {
  ActivityIcon,
  ArrowDownUpIcon,
  CopyIcon,
  HardDriveIcon,
  PanelBottomIcon,
  RefreshCwIcon,
  ServerIcon,
  Settings2Icon,
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
import { useAppInfo } from "@/hooks/use-app-info"
import { errorMessage } from "@/lib/errors"
import type { ThemeMode } from "@/lib/ipc/bindings"
import { THEME_OPTIONS } from "@/lib/themes"
import { useSessionStore } from "@/stores/session-store"
import { useUiStore } from "@/stores/ui-store"

export function CommandPalette() {
  const { settings, updateSettings } = useSettings()
  const appInfo = useAppInfo()
  const open = useUiStore((state) => state.paletteOpen)
  const setOpen = useUiStore((state) => state.setPaletteOpen)
  const setActivePane = useUiStore((state) => state.setActivePane)
  const setSettingsOpen = useUiStore((state) => state.setSettingsOpen)
  const setQuickConnectOpen = useUiStore((state) => state.setQuickConnectOpen)
  const setBottomTab = useUiStore((state) => state.setBottomTab)
  const activeSessionId = useSessionStore((state) => state.activeSessionId)
  const { reconnect, cancel } = useSessionActions()

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

  const showPanel = (tab: "transfers" | "activity") => {
    run(() => {
      setBottomTab(tab)
      if (!settings.bottomPanelOpen) {
        updateSettings({ bottomPanelOpen: true }).catch((error) => {
          toast.error("Could not open the panel", { description: errorMessage(error) })
        })
      }
    })
  }

  const changeTheme = (mode: ThemeMode) => {
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
          {THEME_OPTIONS.map(({ value, label, icon: Icon }) => (
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
            <CommandShortcut>⌘1</CommandShortcut>
          </CommandItem>
          <CommandItem value="focus remote pane" onSelect={() => focusPane("remote")}>
            <ServerIcon className="text-muted-foreground" />
            Focus remote pane
            <CommandShortcut>⌘2</CommandShortcut>
          </CommandItem>
          <CommandItem value="show activity" onSelect={() => showPanel("activity")}>
            <ActivityIcon className="text-muted-foreground" />
            Show activity
          </CommandItem>
          <CommandItem value="show transfers" onSelect={() => showPanel("transfers")}>
            <ArrowDownUpIcon className="text-muted-foreground" />
            Show transfers
          </CommandItem>
          <CommandItem value="toggle bottom panel" onSelect={togglePanel}>
            <PanelBottomIcon className="text-muted-foreground" />
            Toggle bottom panel
            <CommandShortcut>⌘J</CommandShortcut>
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
            value="cancel remote operation"
            disabled={!activeSessionId}
            onSelect={() => run(cancelActive)}
          >
            <XIcon className="text-muted-foreground" />
            Cancel remote operation
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
            <CommandShortcut>⌘,</CommandShortcut>
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
