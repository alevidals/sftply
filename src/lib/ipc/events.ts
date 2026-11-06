import type { UnlistenFn } from "@tauri-apps/api/event"
import { type ActivityEntry, events } from "@/lib/ipc/bindings"

/** Subscribe to backend activity events. */
export function onActivityEntry(handler: (entry: ActivityEntry) => void): Promise<UnlistenFn> {
  return events.activityEntry.listen((event) => handler(event.payload))
}
