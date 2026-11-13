import { cn } from "cn"
import { ArrowLeftIcon, ArrowRightIcon, ArrowUpIcon, PencilLineIcon } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { tinykeys } from "tinykeys"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { pathBreadcrumbs } from "@/features/files/model/path"
import { shortcutLabel } from "@/lib/shortcuts"
import { useUiStore } from "@/stores/ui-store"

interface PathBarProps {
  path: string
  canBack: boolean
  canForward: boolean
  canUp: boolean
  onBack: () => void
  onForward: () => void
  onUp: () => void
  onNavigate: (path: string) => void
  children?: React.ReactNode
}

export function PathBar({
  path,
  canBack,
  canForward,
  canUp,
  onBack,
  onForward,
  onUp,
  onNavigate,
  children,
}: PathBarProps) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(path)
  const inputRef = useRef<HTMLInputElement>(null)
  const crumbs = pathBreadcrumbs(path)

  // Leaving path-edit mode when navigation changes folders is intentional.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset on path change
  useEffect(() => {
    setEditing(false)
  }, [path])

  useEffect(() => {
    if (!editing) return
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [editing])

  useEffect(
    () =>
      tinykeys(window, {
        "$mod+KeyL": (event) => {
          const ui = useUiStore.getState()
          if (ui.paletteOpen || ui.settingsOpen) return
          event.preventDefault()
          setValue(path)
          setEditing(true)
        },
      }),
    [path],
  )

  const startEditing = () => {
    setValue(path)
    setEditing(true)
  }

  const submit = (event: React.FormEvent) => {
    event.preventDefault()
    const next = value.trim()
    setEditing(false)
    if (next && next !== path) onNavigate(next)
  }

  return (
    <div className="flex h-9 shrink-0 items-center gap-1 border-b border-border/60 bg-background/40 px-2">
      <NavButton label="Back" shortcut={shortcutLabel("back")} disabled={!canBack} onClick={onBack}>
        <ArrowLeftIcon />
      </NavButton>
      <NavButton
        label="Forward"
        shortcut={shortcutLabel("forward")}
        disabled={!canForward}
        onClick={onForward}
      >
        <ArrowRightIcon />
      </NavButton>
      <NavButton
        label="Enclosing folder"
        shortcut={shortcutLabel("up")}
        disabled={!canUp}
        onClick={onUp}
      >
        <ArrowUpIcon />
      </NavButton>

      <div className="mx-0.5 h-4 w-px bg-border/70" />

      {editing ? (
        <form onSubmit={submit} className="min-w-0 flex-1">
          <Input
            ref={inputRef}
            value={value}
            onChange={(event) => setValue(event.target.value)}
            onBlur={() => setEditing(false)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault()
                setEditing(false)
              }
            }}
            spellCheck={false}
            autoComplete="off"
            aria-label="Folder path"
            className="h-6 rounded-md px-2 font-mono text-[11px]"
          />
        </form>
      ) : (
        <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {crumbs.map((crumb, index) => (
            <div key={crumb.path} className="flex shrink-0 items-center gap-0.5">
              {index > 0 ? <span className="px-0.5 text-muted-foreground/40">/</span> : null}
              <button
                type="button"
                onClick={() => onNavigate(crumb.path)}
                onDoubleClick={startEditing}
                aria-current={index === crumbs.length - 1 ? "page" : undefined}
                className={cn(
                  "max-w-[180px] truncate rounded px-1.5 py-0.5 text-[11px] transition-colors focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none",
                  index === crumbs.length - 1
                    ? "font-medium text-foreground"
                    : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                )}
              >
                {crumb.label}
              </button>
            </div>
          ))}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label="Edit folder path"
                onClick={startEditing}
                className="ml-0.5 shrink-0 text-muted-foreground/60"
              >
                <PencilLineIcon />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" sideOffset={6}>
              Edit path <span className="ml-1 text-muted-foreground">{shortcutLabel("path")}</span>
            </TooltipContent>
          </Tooltip>
        </div>
      )}

      <div className="ml-1 flex shrink-0 items-center gap-0.5">{children}</div>
    </div>
  )
}

function NavButton({
  label,
  shortcut,
  disabled,
  onClick,
  children,
}: {
  label: string
  shortcut: string
  disabled: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={label}
          disabled={disabled}
          onClick={onClick}
          className="text-muted-foreground"
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={6}>
        {label} <span className="ml-1 text-muted-foreground">{shortcut}</span>
      </TooltipContent>
    </Tooltip>
  )
}
