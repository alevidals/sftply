import { cn } from "cn"
import { ArrowLeftIcon, ArrowRightIcon, ArrowUpIcon, HouseIcon, PencilLineIcon } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { tinykeys } from "tinykeys"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { pathBreadcrumbs } from "@/features/files/model/path"
import { shortcutLabel } from "@/lib/shortcuts"
import { useUiStore } from "@/stores/ui-store"

interface PathBarProps {
  pane: "local" | "remote"
  path: string
  canBack: boolean
  canForward: boolean
  canUp: boolean
  onBack: () => void
  onForward: () => void
  onUp: () => void
  /** Present only for the local pane, where a home folder exists. */
  onHome?: () => void
  onNavigate: (path: string) => void
  /** Validated navigation for a typed path, so a bad folder is rejected. */
  onSubmitPath?: (path: string) => void
  /** Folder suggestions for the typed value. Absent disables autocomplete. */
  suggestPath?: (value: string) => Promise<string[]>
  children?: React.ReactNode
}

export function PathBar({
  pane,
  path,
  canBack,
  canForward,
  canUp,
  onBack,
  onForward,
  onUp,
  onHome,
  onNavigate,
  onSubmitPath,
  suggestPath,
  children,
}: PathBarProps) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(path)
  const [suggestions, setSuggestions] = useState<string[]>([])
  const [activeIndex, setActiveIndex] = useState(-1)
  const requestId = useRef(0)
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

  // Debounced completion. The request id drops answers for stale keystrokes.
  useEffect(() => {
    if (!editing || !suggestPath) {
      setSuggestions([])
      setActiveIndex(-1)
      return
    }
    const id = ++requestId.current
    const handle = setTimeout(() => {
      suggestPath(value)
        .then((next) => {
          if (id !== requestId.current) return
          setSuggestions(next)
          setActiveIndex(-1)
        })
        .catch(() => {
          if (id === requestId.current) setSuggestions([])
        })
    }, 160)
    return () => clearTimeout(handle)
  }, [editing, value, suggestPath])

  const applySuggestion = (next: string) => {
    setSuggestions([])
    setActiveIndex(-1)
    setEditing(false)
    if (next !== path) {
      if (onSubmitPath) onSubmitPath(next)
      else onNavigate(next)
    }
  }

  useEffect(
    () =>
      tinykeys(window, {
        "$mod+KeyL": (event) => {
          const ui = useUiStore.getState()
          // Both panes mount a path bar; only the active one may react.
          if (ui.activePane !== pane || ui.paletteOpen || ui.settingsOpen) return
          event.preventDefault()
          setValue(path)
          setEditing(true)
        },
      }),
    [pane, path],
  )

  const startEditing = () => {
    setValue(path)
    setEditing(true)
  }

  const submit = (event: React.FormEvent) => {
    event.preventDefault()
    const next = value.trim()
    setEditing(false)
    if (!next || next === path) return
    if (onSubmitPath) onSubmitPath(next)
    else onNavigate(next)
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
      {onHome ? (
        <NavButton label="Home folder" shortcut="" disabled={false} onClick={onHome}>
          <HouseIcon />
        </NavButton>
      ) : null}

      <div className="mx-0.5 h-4 w-px bg-border/70" />

      {editing ? (
        <form onSubmit={submit} className="relative min-w-0 flex-1">
          <Input
            ref={inputRef}
            value={value}
            onChange={(event) => setValue(event.target.value)}
            onBlur={() => setEditing(false)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault()
                setEditing(false)
                return
              }
              if (event.key === "ArrowDown" && suggestions.length > 0) {
                event.preventDefault()
                setActiveIndex((index) => (index + 1) % suggestions.length)
                return
              }
              if (event.key === "ArrowUp" && suggestions.length > 0) {
                event.preventDefault()
                setActiveIndex((index) => (index <= 0 ? suggestions.length - 1 : index - 1))
                return
              }
              if (event.key === "Enter" && activeIndex >= 0) {
                event.preventDefault()
                const next = suggestions[activeIndex]
                if (next) applySuggestion(next)
              }
            }}
            spellCheck={false}
            autoComplete="off"
            role="combobox"
            aria-expanded={suggestions.length > 0}
            aria-controls="path-suggestions"
            aria-autocomplete="list"
            aria-label="Folder path"
            className="h-6 rounded-md px-2 font-mono text-[11px]"
          />
          {suggestions.length > 0 ? (
            <div
              id="path-suggestions"
              role="listbox"
              aria-label="Folder suggestions"
              className="absolute inset-x-0 top-7 z-50 max-h-56 overflow-y-auto rounded-md border border-border bg-popover p-1 shadow-md"
            >
              {suggestions.map((suggestion, index) => (
                <button
                  key={suggestion}
                  type="button"
                  role="option"
                  aria-selected={index === activeIndex}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => applySuggestion(suggestion)}
                  className={cn(
                    "block w-full truncate rounded px-2 py-1 text-left font-mono text-[11px]",
                    index === activeIndex
                      ? "bg-accent text-accent-foreground"
                      : "text-muted-foreground hover:bg-accent/60 hover:text-accent-foreground",
                  )}
                >
                  {suggestion}
                </button>
              ))}
            </div>
          ) : null}
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
        {label}
        {shortcut ? <span className="ml-1 text-muted-foreground">{shortcut}</span> : null}
      </TooltipContent>
    </Tooltip>
  )
}
