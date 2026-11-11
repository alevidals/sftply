import type { UnlistenFn } from "@tauri-apps/api/event"
import {
  type ActivityEntry,
  events,
  type SessionState,
  type TransferDeltaEvent,
  type TransferItem,
  type TransferItem_Serialize,
} from "@/lib/ipc/bindings"

/** Normalized lifecycle event. The generated deserialize type uses the Rust
 * field names while the emitted payload is camelCase, so read both. */
export interface NormalizedSessionStateEvent {
  sessionId: string
  connectionId: string
  state: SessionState
  message: string | null
  timestamp: number
}

/** Subscribe to backend activity events. */
export function onActivityEntry(handler: (entry: ActivityEntry) => void): Promise<UnlistenFn> {
  return events.activityEntry.listen((event) => handler(event.payload))
}

/** Normalize a transfer row. The generated deserialize type marks optional
 * fields that the backend always sends, so fill them for stable consumers. */
export function normalizeTransferItem(item: TransferItem): TransferItem_Serialize {
  return {
    ...item,
    etaMs: item.etaMs ?? null,
    error: item.error ?? null,
    finishedAt: item.finishedAt ?? null,
  }
}

/** Subscribe to batched transfer progress events. */
export function onTransferDelta(handler: (event: TransferDeltaEvent) => void): Promise<UnlistenFn> {
  return events.transferDelta.listen((event) => handler(event.payload))
}

/** Subscribe to session lifecycle events. */
export function onSessionState(
  handler: (event: NormalizedSessionStateEvent) => void,
): Promise<UnlistenFn> {
  return events.sessionState.listen((event) => {
    const raw = event.payload as unknown as Record<string, unknown>
    handler({
      sessionId: String(raw.sessionId ?? raw.session_id ?? ""),
      connectionId: String(raw.connectionId ?? raw.connection_id ?? ""),
      state: raw.state as SessionState,
      message: (raw.message as string | null | undefined) ?? null,
      timestamp: Number(raw.timestamp ?? Date.now()),
    })
  })
}
