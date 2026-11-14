import { ClockIcon, StarIcon, StarOffIcon, Trash2Icon } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

interface BookmarksDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  currentPath: string
  bookmarks: readonly string[]
  recent: readonly string[]
  isBookmarked: boolean
  onToggleBookmark: () => void
  onRemoveBookmark: (path: string) => void
  onNavigate: (path: string) => void
  onClearRecent: () => void
}

/** Bookmarked and recently visited folders for one remote connection. */
export function BookmarksDialog({
  open,
  onOpenChange,
  currentPath,
  bookmarks,
  recent,
  isBookmarked,
  onToggleBookmark,
  onRemoveBookmark,
  onNavigate,
  onClearRecent,
}: BookmarksDialogProps) {
  const navigate = (path: string) => {
    onNavigate(path)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <StarIcon className="size-4 text-primary" />
            Bookmarks and recent folders
          </DialogTitle>
          <DialogDescription className="truncate font-mono text-2xs">
            {currentPath || "No folder loaded"}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="flex items-center gap-3 rounded-md border border-border bg-muted/30 px-3 py-2">
            <div className="min-w-0 flex-1">
              <p className="text-2xs font-medium tracking-wide text-muted-foreground uppercase">
                Current folder
              </p>
              <p className="selectable truncate font-mono text-xs text-foreground">
                {currentPath || "—"}
              </p>
            </div>
            <Button
              size="sm"
              variant={isBookmarked ? "outline" : "default"}
              disabled={!currentPath}
              onClick={onToggleBookmark}
            >
              {isBookmarked ? <StarOffIcon /> : <StarIcon />}
              {isBookmarked ? "Remove bookmark" : "Bookmark"}
            </Button>
          </div>

          <section aria-labelledby="bookmarks-heading">
            <div className="mb-1.5 flex items-center justify-between">
              <h3 id="bookmarks-heading" className="text-xs font-medium text-foreground">
                Bookmarks
              </h3>
              <span className="text-2xs text-muted-foreground tabular">{bookmarks.length}</span>
            </div>
            {bookmarks.length === 0 ? (
              <p className="rounded-md border border-dashed border-border px-3 py-3 text-center text-2xs text-muted-foreground">
                No bookmarks yet. Bookmark the current folder to find it here.
              </p>
            ) : (
              <ul className="max-h-40 overflow-auto rounded-md border border-border">
                {bookmarks.map((path) => (
                  <li
                    key={path}
                    className="flex items-center gap-1 border-b border-border/50 pr-1 last:border-b-0"
                  >
                    <button
                      type="button"
                      onClick={() => navigate(path)}
                      className="min-w-0 flex-1 truncate rounded px-2 py-1.5 text-left font-mono text-xs text-foreground transition-colors hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
                    >
                      {path}
                    </button>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      aria-label={`Remove bookmark ${path}`}
                      onClick={() => onRemoveBookmark(path)}
                      className="text-muted-foreground"
                    >
                      <Trash2Icon />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-labelledby="recent-heading">
            <div className="mb-1.5 flex items-center justify-between">
              <h3 id="recent-heading" className="text-xs font-medium text-foreground">
                Recent folders
              </h3>
              {recent.length > 0 ? (
                <Button variant="ghost" size="xs" onClick={onClearRecent}>
                  Clear
                </Button>
              ) : (
                <span className="text-2xs text-muted-foreground tabular">0</span>
              )}
            </div>
            {recent.length === 0 ? (
              <p className="rounded-md border border-dashed border-border px-3 py-3 text-center text-2xs text-muted-foreground">
                Folders you visit appear here.
              </p>
            ) : (
              <ul className="max-h-40 overflow-auto rounded-md border border-border">
                {recent.map((path) => (
                  <li key={path} className="border-b border-border/50 last:border-b-0">
                    <button
                      type="button"
                      onClick={() => navigate(path)}
                      className="flex w-full min-w-0 items-center gap-2 rounded px-2 py-1.5 text-left font-mono text-xs text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
                    >
                      <ClockIcon className="size-3 shrink-0 opacity-60" />
                      <span className="truncate">{path}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
