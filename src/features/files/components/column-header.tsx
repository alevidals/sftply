import { cn } from "cn"
import { ArrowDownIcon, ArrowUpIcon } from "lucide-react"
import { type ColumnOptions, fileGridTemplate } from "@/features/files/model/columns"
import type { SortColumn, SortState } from "@/features/files/model/sort"

interface ColumnHeaderProps {
  sort: SortState
  columns: ColumnOptions
  onSort: (column: SortColumn) => void
}

const COLUMNS: Array<{ id: SortColumn; label: string; align?: "right" }> = [
  { id: "name", label: "Name" },
  { id: "size", label: "Size", align: "right" },
  { id: "modified", label: "Modified", align: "right" },
  { id: "permissions", label: "Mode", align: "right" },
]

export function ColumnHeader({ sort, columns, onSort }: ColumnHeaderProps) {
  return (
    <div
      role="row"
      className="grid h-7 shrink-0 items-center gap-3 border-b border-border/60 bg-panel-header/60 px-3 text-2xs font-medium tracking-wide text-muted-foreground/80 uppercase"
      style={{ gridTemplateColumns: fileGridTemplate(columns) }}
    >
      {COLUMNS.filter((column) => column.id !== "permissions" || columns.permissions).map(
        (column) => {
          const active = sort.column === column.id
          const Icon = sort.direction === "asc" ? ArrowUpIcon : ArrowDownIcon
          return (
            <button
              key={column.id}
              type="button"
              role="columnheader"
              aria-sort={active ? (sort.direction === "asc" ? "ascending" : "descending") : "none"}
              onClick={() => onSort(column.id)}
              className={cn(
                "flex h-full min-w-0 items-center gap-1 rounded-sm transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none",
                column.align === "right" && "justify-end",
                active && "text-foreground",
              )}
            >
              <span className="truncate">{column.label}</span>
              {active ? <Icon className="size-3 shrink-0 opacity-70" aria-hidden /> : null}
            </button>
          )
        },
      )}
    </div>
  )
}
