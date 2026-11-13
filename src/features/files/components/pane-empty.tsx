import { FolderOpenIcon, SearchXIcon } from "lucide-react"
import { Button } from "@/components/ui/button"

interface PaneEmptyProps {
  /** True when the folder has entries but the current filter hides them. */
  filtered: boolean
  /** Extra explanation for an empty folder, provided by the pane owner. */
  description?: string
  /** False when the server cannot create folders; the action is hidden then. */
  canCreate: boolean
  onNewFolder: () => void
  onClearFilter: () => void
}

/** Empty or fully filtered folder state shared by local and remote panes. */
export function PaneEmpty({
  filtered,
  description,
  canCreate,
  onNewFolder,
  onClearFilter,
}: PaneEmptyProps) {
  const Icon = filtered ? SearchXIcon : FolderOpenIcon
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center p-6">
      <div className="flex max-w-[280px] flex-col items-center text-center">
        <span className="mb-3 flex size-11 items-center justify-center rounded-xl border border-border/70 bg-muted/40 text-muted-foreground">
          <Icon className="size-5" />
        </span>
        <h2 className="text-sm font-medium text-foreground">
          {filtered ? "No matching items" : "This folder is empty"}
        </h2>
        <p className="mt-1 text-xs leading-relaxed text-balance text-muted-foreground">
          {filtered
            ? "No files or folders match the current filter."
            : (description ?? "Create a folder to get started, or go to another location.")}
        </p>
        {filtered ? (
          <Button variant="outline" size="sm" className="mt-3" onClick={onClearFilter}>
            Clear filter
          </Button>
        ) : canCreate ? (
          <Button variant="outline" size="sm" className="mt-3" onClick={onNewFolder}>
            New folder
          </Button>
        ) : null}
      </div>
    </div>
  )
}
