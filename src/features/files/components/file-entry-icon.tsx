import { cn } from "cn"
import {
  FileArchiveIcon,
  FileAudioIcon,
  FileCodeIcon,
  FileIcon,
  FileJsonIcon,
  FileSpreadsheetIcon,
  FileTextIcon,
  FileVideoIcon,
  FolderIcon,
  ImageIcon,
  LinkIcon,
  type LucideIcon,
} from "lucide-react"
import type { EntryKind } from "@/lib/ipc/bindings"

const GROUPS: Array<{ icon: LucideIcon; className: string; extensions: string[] }> = [
  {
    icon: ImageIcon,
    className: "text-info",
    extensions: ["png", "jpg", "jpeg", "gif", "webp", "svg", "heic", "tiff", "bmp", "avif"],
  },
  {
    icon: FileVideoIcon,
    className: "text-chart-4",
    extensions: ["mp4", "mov", "mkv", "avi", "webm", "m4v"],
  },
  {
    icon: FileAudioIcon,
    className: "text-chart-5",
    extensions: ["mp3", "wav", "flac", "aac", "ogg", "m4a"],
  },
  {
    icon: FileArchiveIcon,
    className: "text-warning",
    extensions: ["zip", "tar", "gz", "bz2", "xz", "7z", "rar", "dmg"],
  },
  {
    icon: FileCodeIcon,
    className: "text-success",
    extensions: [
      "ts",
      "tsx",
      "js",
      "jsx",
      "rs",
      "py",
      "go",
      "rb",
      "java",
      "c",
      "h",
      "cpp",
      "css",
      "html",
      "sh",
      "toml",
      "yaml",
      "yml",
    ],
  },
  {
    icon: FileJsonIcon,
    className: "text-warning",
    extensions: ["json", "jsonc"],
  },
  {
    icon: FileSpreadsheetIcon,
    className: "text-success",
    extensions: ["csv", "tsv", "xls", "xlsx", "numbers"],
  },
  {
    icon: FileTextIcon,
    className: "text-muted-foreground",
    extensions: ["txt", "md", "mdx", "pdf", "rtf", "log", "doc", "docx", "pages"],
  },
]

function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".")
  if (dot <= 0 || dot === name.length - 1) return ""
  return name.slice(dot + 1).toLocaleLowerCase()
}

interface FileEntryIconProps {
  kind: EntryKind
  name: string
  className?: string
}

export function FileEntryIcon({ kind, name, className }: FileEntryIconProps) {
  if (kind === "directory") {
    return <FolderIcon className={cn("size-3.5 shrink-0 text-primary/80", className)} />
  }
  if (kind === "symlink") {
    return <LinkIcon className={cn("size-3.5 shrink-0 text-muted-foreground", className)} />
  }
  if (kind === "other") {
    return <FileIcon className={cn("size-3.5 shrink-0 text-muted-foreground", className)} />
  }

  const extension = extensionOf(name)
  const group = GROUPS.find((candidate) => candidate.extensions.includes(extension))
  const Icon = group?.icon ?? FileIcon
  return (
    <Icon
      className={cn("size-3.5 shrink-0", group?.className ?? "text-muted-foreground", className)}
    />
  )
}
