import { useCallback, useState } from "react"
import { toast } from "sonner"
import { LOCAL_SCOPE, remoteScope } from "@/features/files/api"
import { useSettings } from "@/features/settings/settings-context"
import { transfersApi } from "@/features/transfers/api"
import { joinLocalPath, joinRemotePath, transferableEntries } from "@/features/transfers/model"
import { normalizeError } from "@/lib/errors"
import type {
  ConflictPolicy,
  FsEntry,
  FsScope,
  TransferConflict,
  TransferDirection,
} from "@/lib/ipc/bindings"
import { recordActivity } from "@/stores/activity-store"
import { useSessionStore } from "@/stores/session-store"
import { useUiStore } from "@/stores/ui-store"

export type ConflictChoice = ConflictPolicy | "skip"

interface PlannedTransfer {
  entry: FsEntry
  targetPath: string
  conflict: TransferConflict | null
}

interface TransferActions {
  canTransfer: boolean
  transferLabel: string
  transfer: (entries: readonly FsEntry[]) => void
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
  const { settings, updateSettings } = useSettings()
  const localPath = useUiStore((state) => state.localSummary.path)
  const remotePath = useUiStore((state) => state.remoteSummary.path)
  const setBottomTab = useUiStore((state) => state.setBottomTab)
  const activeSessionId = useSessionStore((state) => state.activeSessionId)
  const sessions = useSessionStore((state) => state.sessions)

  const [plans, setPlans] = useState<PlannedTransfer[]>([])
  const [conflicts, setConflicts] = useState<TransferConflict[]>([])
  const [open, setOpen] = useState(false)

  const upload = pane === "local"
  const direction: TransferDirection = upload ? "upload" : "download"
  const activeSession = activeSessionId ? sessions[activeSessionId] : undefined
  const targetScope: FsScope | null = upload
    ? activeSessionId
      ? remoteScope(activeSessionId)
      : null
    : LOCAL_SCOPE
  const targetDirectory = upload ? remotePath : localPath
  const canTransfer = Boolean(targetScope && targetDirectory && (upload ? activeSession : true))
  const transferLabel = upload ? "Upload to remote" : "Download to local"

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

  const enqueue = useCallback(
    async (queue: PlannedTransfer[], policy: ConflictPolicy, skipConflicts: boolean) => {
      if (!targetScope) return
      let started = 0
      let failed = 0

      for (const plan of queue) {
        if (skipConflicts && plan.conflict) continue
        try {
          await transfersApi.enqueue(scope, plan.entry.path, targetScope, plan.targetPath, policy)
          started += 1
        } catch (error) {
          failed += 1
          reportError(`Could not queue “${plan.entry.name}”`, error)
        }
      }

      if (started > 0) {
        const noun = started === 1 ? "transfer" : "transfers"
        toast.success(`Queued ${started} ${noun}`)
        recordActivity(
          "info",
          upload
            ? `Queued ${started} upload${started === 1 ? "" : "s"} to ${activeSession?.name ?? "remote"}`
            : `Queued ${started} download${started === 1 ? "" : "s"} to ${targetDirectory ?? "local"}`,
        )
        openTransfers()
      }
      if (failed === 0 && started === 0) {
        toast.info("Nothing to transfer", {
          description: "Every selected file already exists and was skipped.",
        })
      }
    },
    [activeSession?.name, openTransfers, reportError, scope, targetDirectory, targetScope, upload],
  )

  const transfer = useCallback(
    (entries: readonly FsEntry[]) => {
      if (!targetScope || !targetDirectory) {
        toast.info("Choose a destination folder first.")
        return
      }
      const files = transferableEntries(entries)
      if (files.length === 0) {
        toast.info("Folders cannot be transferred yet.", {
          description: "Select individual files. Folder transfers arrive in a later update.",
        })
        return
      }

      void (async () => {
        const planned: PlannedTransfer[] = []
        for (const entry of files) {
          const targetPath = upload
            ? joinRemotePath(targetDirectory, entry.name)
            : joinLocalPath(targetDirectory, entry.name)
          try {
            const conflict = await transfersApi.preflight(targetScope, targetPath)
            planned.push({ entry, targetPath, conflict })
          } catch (error) {
            reportError(`Could not check “${entry.name}”`, error)
            return
          }
        }

        const found = planned.flatMap((plan) => (plan.conflict ? [plan.conflict] : []))
        if (found.length > 0) {
          setPlans(planned)
          setConflicts(found)
          setOpen(true)
          return
        }
        await enqueue(planned, "overwrite", false)
      })()
    },
    [enqueue, reportError, targetDirectory, targetScope, upload],
  )

  const onConfirm = useCallback(
    async (choice: ConflictChoice) => {
      if (choice === "skip") {
        await enqueue(plans, "overwrite", true)
      } else {
        await enqueue(plans, choice, false)
      }
      setOpen(false)
      setPlans([])
      setConflicts([])
    },
    [enqueue, plans],
  )

  return {
    canTransfer,
    transferLabel,
    transfer,
    conflictPrompt:
      conflicts.length > 0
        ? {
            open,
            conflicts,
            direction,
            onOpenChange: (next) => {
              setOpen(next)
              if (!next) {
                setPlans([])
                setConflicts([])
              }
            },
            onConfirm,
          }
        : null,
  }
}
