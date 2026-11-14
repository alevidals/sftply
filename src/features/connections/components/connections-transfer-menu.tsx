import { open as openFileDialog, save as saveFileDialog } from "@tauri-apps/plugin-dialog"
import { DownloadIcon, MoreHorizontalIcon, UploadIcon } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { connectionsApi } from "@/features/connections/api"
import { errorMessage } from "@/lib/errors"
import { recordActivity } from "@/stores/activity-store"

const JSON_FILTER = [{ name: "JSON", extensions: ["json"] }]

interface Props {
  connectionCount: number
  onChanged: () => void | Promise<void>
}

/**
 * Import and export of saved connections. The bundle never contains passwords,
 * passphrases or key material; the backend enforces that shape.
 */
export function ConnectionsTransferMenu({ connectionCount, onChanged }: Props) {
  const [busy, setBusy] = useState(false)

  const exportConnections = async () => {
    try {
      const path = await saveFileDialog({
        title: "Export connections",
        defaultPath: "sftply-connections.json",
        filters: JSON_FILTER,
      })
      if (!path) return

      setBusy(true)
      const summary = await connectionsApi.exportTo(path)
      const label = summary.count === 1 ? "connection" : "connections"
      toast.success(`Exported ${summary.count} ${label}`, {
        description: "Passwords and passphrases stay in your keychain.",
      })
      recordActivity("success", `Exported ${summary.count} ${label}`)
    } catch (cause) {
      toast.error("Could not export your connections", { description: errorMessage(cause) })
      recordActivity("error", `Export failed: ${errorMessage(cause)}`)
    } finally {
      setBusy(false)
    }
  }

  const importConnections = async () => {
    try {
      const selected = await openFileDialog({
        title: "Import connections",
        multiple: false,
        directory: false,
        filters: JSON_FILTER,
      })
      const path = Array.isArray(selected) ? selected[0] : selected
      if (!path) return

      setBusy(true)
      const summary = await connectionsApi.importFrom(path)
      await onChanged()

      const importedLabel = summary.imported === 1 ? "connection" : "connections"
      if (summary.problems.length > 0) {
        toast.warning(`Imported ${summary.imported} ${importedLabel}`, {
          description: summary.problems.slice(0, 3).join(" "),
        })
        recordActivity(
          "warning",
          `Imported ${summary.imported} ${importedLabel}, ${summary.skipped} skipped`,
        )
      } else {
        toast.success(`Imported ${summary.imported} ${importedLabel}`)
        recordActivity("success", `Imported ${summary.imported} ${importedLabel}`)
      }
    } catch (cause) {
      toast.error("Could not import those connections", { description: errorMessage(cause) })
      recordActivity("error", `Import failed: ${errorMessage(cause)}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="Connection import and export"
          disabled={busy}
        >
          <MoreHorizontalIcon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>Credential-free JSON</DropdownMenuLabel>
        <DropdownMenuItem onSelect={() => void importConnections()}>
          <DownloadIcon />
          Import connections…
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => void exportConnections()}
          disabled={connectionCount === 0}
        >
          <UploadIcon />
          Export connections…
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <p className="px-2 py-1.5 text-2xs leading-relaxed text-muted-foreground">
          Secrets are never exported. Imported connections ask for the password again.
        </p>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
