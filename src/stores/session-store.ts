import { create } from "zustand"
import type { SessionInfo } from "@/lib/ipc/bindings"

interface SessionStoreState {
  sessions: Record<string, SessionInfo>
  /** Session ids in connection order. */
  order: string[]
  activeSessionId: string | null
  /** Connection ids with an in-flight connect request. */
  connecting: Record<string, boolean>
  setSessions: (sessions: SessionInfo[]) => void
  upsertSession: (session: SessionInfo) => void
  removeSession: (sessionId: string) => void
  setActiveSession: (sessionId: string | null) => void
  setConnecting: (connectionId: string, value: boolean) => void
}

export const useSessionStore = create<SessionStoreState>((set) => ({
  sessions: {},
  order: [],
  activeSessionId: null,
  connecting: {},

  setSessions: (sessions) =>
    set((state) => {
      const next: Record<string, SessionInfo> = {}
      const order: string[] = []
      for (const session of sessions) {
        next[session.id] = session
        order.push(session.id)
      }
      const activeSessionId =
        state.activeSessionId && next[state.activeSessionId]
          ? state.activeSessionId
          : (order[0] ?? null)
      return { sessions: next, order, activeSessionId }
    }),

  upsertSession: (session) =>
    set((state) => {
      const exists = Boolean(state.sessions[session.id])
      return {
        sessions: { ...state.sessions, [session.id]: session },
        order: exists ? state.order : [...state.order, session.id],
        activeSessionId: state.activeSessionId ?? session.id,
      }
    }),

  removeSession: (sessionId) =>
    set((state) => {
      if (!state.sessions[sessionId]) return state
      const sessions = { ...state.sessions }
      delete sessions[sessionId]
      const order = state.order.filter((id) => id !== sessionId)
      const activeSessionId =
        state.activeSessionId === sessionId
          ? (order[order.length - 1] ?? null)
          : state.activeSessionId
      return { sessions, order, activeSessionId }
    }),

  setActiveSession: (activeSessionId) => set({ activeSessionId }),

  setConnecting: (connectionId, value) =>
    set((state) => {
      const connecting = { ...state.connecting }
      if (value) connecting[connectionId] = true
      else delete connecting[connectionId]
      return { connecting }
    }),
}))

export function activeSession(): SessionInfo | null {
  const state = useSessionStore.getState()
  return state.activeSessionId ? (state.sessions[state.activeSessionId] ?? null) : null
}

export function sessionForConnection(
  sessions: Record<string, SessionInfo>,
  connectionId: string,
): SessionInfo | null {
  return Object.values(sessions).find((session) => session.connectionId === connectionId) ?? null
}
