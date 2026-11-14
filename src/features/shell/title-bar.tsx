import { CircleDotIcon, SearchIcon, Settings2Icon } from "lucide-react"
import { Fragment, memo } from "react"
import { toast } from "sonner"
import { BrandMark } from "@/components/brand"
import { Kbd } from "@/components/kbd"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useSettings } from "@/features/settings/settings-context"
import { errorMessage } from "@/lib/errors"
import type { ThemeMode } from "@/lib/ipc/bindings"
import { shortcutLabel } from "@/lib/shortcuts"
import { THEME_OPTIONS, themeOption } from "@/lib/themes"
import { useUiStore } from "@/stores/ui-store"

function TitleBarImpl() {
  const { settings, updateSettings } = useSettings()
  const setPaletteOpen = useUiStore((state) => state.setPaletteOpen)
  const setSettingsOpen = useUiStore((state) => state.setSettingsOpen)
  const ThemeIcon = themeOption(settings.theme).icon

  const changeTheme = (theme: string) => {
    updateSettings({ theme: theme as ThemeMode }).catch((error) => {
      toast.error("Could not change the theme", { description: errorMessage(error) })
    })
  }

  return (
    <header
      data-tauri-drag-region
      className="flex h-12 shrink-0 items-center gap-3 border-b border-border/70 bg-chrome px-3 pl-[84px] text-chrome-foreground select-none"
    >
      <div data-tauri-drag-region className="flex items-center gap-2">
        <BrandMark className="size-6" />
        <span className="text-[13px] font-semibold tracking-tight text-foreground">sftply</span>
      </div>

      <div className="h-4 w-px bg-border/80" />

      <div
        data-tauri-drag-region
        className="flex items-center gap-1.5 text-2xs text-muted-foreground"
      >
        <CircleDotIcon className="size-3 text-success" />
        <span>Local workspace</span>
      </div>

      <div className="flex flex-1 justify-center px-4">
        <button
          type="button"
          onClick={() => setPaletteOpen(true)}
          className="no-drag group flex h-7 w-full max-w-[360px] items-center gap-2 rounded-md border border-border/70 bg-background/50 px-2.5 text-xs text-muted-foreground shadow-xs transition-colors hover:border-border hover:bg-muted/60 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          <SearchIcon className="size-3.5 shrink-0 opacity-70" />
          <span className="flex-1 text-left">Search or jump to…</span>
          <Kbd className="hidden sm:inline-flex">{shortcutLabel("palette")}</Kbd>
        </button>
      </div>

      <div className="no-drag flex items-center gap-0.5">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label="Change theme">
              <ThemeIcon />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="max-h-[min(70vh,22rem)] w-52 overflow-y-auto">
            <DropdownMenuLabel>Appearance</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuRadioGroup value={settings.theme} onValueChange={changeTheme}>
              {THEME_OPTIONS.map((option, index) => {
                const Icon = option.icon
                return (
                  <Fragment key={option.value}>
                    {index === 3 ? <DropdownMenuSeparator /> : null}
                    <DropdownMenuRadioItem value={option.value}>
                      <Icon className="size-3.5 text-muted-foreground" />
                      {option.label}
                    </DropdownMenuRadioItem>
                  </Fragment>
                )
              })}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Settings"
              onClick={() => setSettingsOpen(true)}
            >
              <Settings2Icon />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom" sideOffset={6}>
            Settings <Kbd className="ml-1">{shortcutLabel("settings")}</Kbd>
          </TooltipContent>
        </Tooltip>
      </div>
    </header>
  )
}

export const TitleBar = memo(TitleBarImpl)
