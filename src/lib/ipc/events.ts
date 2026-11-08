import type { UnlistenFn } from "@tauri-apps/api/event"
import { type ActivityEntry, events, type SessionState } from "@/lib/ipc/bindings"

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
