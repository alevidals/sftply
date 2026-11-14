import { useQueryClient } from "@tanstack/react-query"
import { useCallback, useState } from "react"
import { toast } from "sonner"
import { LOCAL_SCOPE, remoteScope } from "@/features/files/api"
import { useSettings } from "@/features/settings/settings-context"
import { transfersApi } from "@/features/transfers/api"
import { transferableEntries, unsupportedEntryCount } from "@/features/transfers/model"
import { normalizeError } from "@/lib/errors"
import type {
  ConflictPolicy,
  FsEntry,
  FsScope,
  TransferConflict,
  TransferDirection,
  TransferPlan_Serialize,
} from "@/lib/ipc/bindings"
import { recordActivity } from "@/stores/activity-store"
import { useSessionStore } from "@/stores/session-store"
import { useUiStore } from "@/stores/ui-store"

export type ConflictChoice = ConflictPolicy | "skip"

interface PendingBatch {
  sourceScope: FsScope
  targetScope: FsScope
  targetDirectory: string
  direction: TransferDirection
  plan: TransferPlan_Serialize
}

interface TransferActions {
  canTransfer: boolean
  transferLabel: string
  transfer: (entries: readonly FsEntry[]) => void
  /** Used by drag-and-drop, where the source is the other pane. */
  transferFrom: (source: FsScope, entries: readonly FsEntry[], directory?: string) => void
  /** Dialog state, or null when no conflict prompt is open. */
  conflictPrompt: {
    open: boolean
    conflicts: TransferConflict[]
    direction: TransferDirection
    onOpenChange: (open: boolean) => void
    onConfirm: (choice: ConflictChoice) => Promise<void>
  } | null
}

/**
 * Move files between the two panes. The destination is the other pane's
 * current folder, so the user never has to type a path.
 */
export function useTransferActions(pane: "local" | "remote", scope: FsScope): TransferActions {
  const queryClient = useQueryClient()
  const { settings, updateSettings } = useSettings()
  const localPath = useUiStore((state) => state.localSummary.path)
  const remotePath = useUiStore((state) => state.remoteSummary.path)
  const setBottomTab = useUiStore((state) => state.setBottomTab)
  const activeSessionId = useSessionStore((state) => state.activeSessionId)
  const sessions = useSessionStore((state) => state.sessions)

  const [batch, setBatch] = useState<PendingBatch | null>(null)
  const [conflicts, setConflicts] = useState<TransferConflict[]>([])
  const [open, setOpen] = useState(false)

  const upload = pane === "local"
  const activeSession = activeSessionId ? sessions[activeSessionId] : undefined
  const targetScope: FsScope | null = upload
    ? activeSessionId
      ? remoteScope(activeSessionId)
      : null
    : LOCAL_SCOPE
  const targetDirectory = upload ? remotePath : localPath
  const paneDirectory = upload ? localPath : remotePath
  const canTransfer = Boolean(targetScope && targetDirectory && (upload ? activeSession : true))
  const transferLabel = upload ? "Upload to remote" : "Download to local"

  const scopeLabel = useCallback(
    (target: FsScope) =>
      target.kind === "local"
        ? "local"
        : (sessions[target.sessionId]?.name ?? activeSession?.name ?? "remote"),
    [activeSession?.name, sessions],
  )

  const reportError = useCallback((title: string, error: unknown) => {
    const normalized = normalizeError(error)
    toast.error(title, { description: normalized.message })
    recordActivity("error", `${title}: ${normalized.message}`)
  }, [])

  const openTransfers = useCallback(() => {
    setBottomTab("transfers")
    if (!settings.bottomPanelOpen) {
      updateSettings({ bottomPanelOpen: true }).catch(() => {
        // The status bar still exposes the queue; a failed panel update is
        // reported by the settings provider.
      })
    }
  }, [setBottomTab, settings.bottomPanelOpen, updateSettings])

  const enqueueBatch = useCallback(
    async (pending: PendingBatch, policy: ConflictPolicy, skipConflicts: boolean) => {
      const skipTargets = skipConflicts
        ? pending.plan.entries.flatMap((entry) => (entry.conflict ? [entry.targetPath] : []))
        : []

      try {
        const items = await transfersApi.enqueueTree(
          pending.sourceScope,
          pending.targetScope,
          policy,
          pending.plan.entries,
          skipTargets,
        )
        const directories = pending.plan.entries.filter(
          (entry) => entry.kind === "directory",
        ).length

        if (items.length > 0) {
          const noun = items.length === 1 ? "transfer" : "transfers"
          toast.success(`Queued ${items.length} ${noun}`)
          recordActivity(
            "info",
            pending.direction === "upload"
              ? `Queued ${items.length} upload${items.length === 1 ? "" : "s"} to ${scopeLabel(pending.targetScope)}`
              : `Queued ${items.length} download${items.length === 1 ? "" : "s"} to ${pending.targetDirectory}`,
          )
          openTransfers()
        } else if (directories > 0) {
          toast.success(`Created ${directories} folder${directories === 1 ? "" : "s"}`)
          recordActivity(
            "info",
            `Created ${directories} folder${directories === 1 ? "" : "s"} in ${scopeLabel(pending.targetScope)}`,
          )
          // Empty folders are created during enqueue and produce no transfer
          // rows, so no terminal delta triggers the usual listing refresh.
          void queryClient.invalidateQueries({ queryKey: ["fs"] })
        } else {
          toast.info("Nothing to transfer", {
            description: "Every selected file already exists and was skipped.",
          })
        }

        if (pending.plan.skipped > 0) {
          toast.info(
            `${pending.plan.skipped} item${pending.plan.skipped === 1 ? "" : "s"} skipped`,
            {
              description: "Symlinks and special files are not transferred.",
            },
          )
        }
      } catch (error) {
        reportError("Could not queue the transfer", error)
      }
    },
    [openTransfers, queryClient, reportError, scopeLabel],
  )

  const transferBetween = useCallback(
    (sourceScope: FsScope, target: FsScope, directory: string, entries: readonly FsEntry[]) => {
      if (!directory) {
        toast.info("Choose a destination folder first.")
        return
      }
      if (sourceScope.kind === target.kind) {
        toast.info("Drop files into the other pane to transfer them.")
        return
      }

      const supported = transferableEntries(entries)
      if (supported.length === 0) {
        toast.info("Nothing to transfer", {
          description: "Symlinks and special files are not transferred.",
        })
        return
      }
      const unsupported = unsupportedEntryCount(entries)

      void (async () => {
        let plan: TransferPlan_Serialize
        try {
          plan = await transfersApi.plan(
            sourceScope,
            supported.map((entry) => entry.path),
            target,
            directory,
          )
        } catch (error) {
          reportError("Could not prepare the transfer", error)
          return
        }

        if (plan.entries.length === 0) {
          toast.info("Nothing to transfer", {
            description: "The selected items are empty or unavailable.",
          })
          return
        }

        if (unsupported > 0) {
          toast.info(`${unsupported} item${unsupported === 1 ? "" : "s"} skipped`, {
            description: "Symlinks and special files are not transferred.",
          })
        }

        const pending: PendingBatch = {
          sourceScope,
          targetScope: target,
          targetDirectory: directory,
          direction: target.kind === "local" ? "download" : "upload",
          plan,
        }
        const found = plan.entries.flatMap((entry) =>
          entry.kind === "file" && entry.conflict ? [entry.conflict] : [],
        )

        if (found.length > 0) {
          setBatch(pending)
          setConflicts(found)
          setOpen(true)
          return
        }
        await enqueueBatch(pending, "overwrite", false)
      })()
    },
    [enqueueBatch, reportError],
  )

  const transfer = useCallback(
    (entries: readonly FsEntry[]) => {
      if (!targetScope || !targetDirectory) {
        toast.info("Choose a destination folder first.")
        return
      }
      transferBetween(scope, targetScope, targetDirectory, entries)
    },
    [scope, targetDirectory, targetScope, transferBetween],
  )

  const transferFrom = useCallback(
    (sourceScope: FsScope, entries: readonly FsEntry[], directory?: string) => {
      // The drop target is this pane, not the pane the menu action would use.
      // `scope` is local for the local pane and the session scope for remote.
      if (scope.kind === "remote" && !sessions[scope.sessionId]) {
        toast.info("Connect to a remote server first.")
        return
      }
      const destination = directory ?? paneDirectory
      if (!destination) {
        toast.info("Choose a destination folder first.")
        return
      }
      transferBetween(sourceScope, scope, destination, entries)
    },
    [paneDirectory, scope, sessions, transferBetween],
  )

  const onConfirm = useCallback(
    async (choice: ConflictChoice) => {
      if (!batch) return
      if (choice === "skip") {
        await enqueueBatch(batch, "overwrite", true)
      } else {
        await enqueueBatch(batch, choice, false)
      }
      setOpen(false)
      setBatch(null)
      setConflicts([])
    },
    [batch, enqueueBatch],
  )

  return {
    canTransfer,
    transferLabel,
    transfer,
    transferFrom,
    conflictPrompt:
      conflicts.length > 0 && batch
        ? {
            open,
            conflicts,
            direction: batch.direction,
            onOpenChange: (next) => {
              setOpen(next)
              if (!next) {
                setBatch(null)
                setConflicts([])
              }
            },
            onConfirm,
          }
        : null,
  }
}
