import { create } from "zustand"
import type { SessionInfo } from "@/lib/ipc/bindings"

interface SessionStoreState {
  sessions: Record<string, SessionInfo>
  /** Session ids in connection order. */
  order: string[]
  activeSessionId: string | null
  /** Connection ids with an in-flight connect request. */
  connecting: Record<string, boolean>
  /** Sessions whose stream is no longer usable, with a user-safe reason. */
  lost: Record<string, string>
  /** Sessions with an in-flight reconnect request. */
  reconnecting: Record<string, boolean>
  /** Last folder visited per session, so tab switches and reconnects keep it. */
  paths: Record<string, string>
  setSessions: (sessions: SessionInfo[]) => void
  upsertSession: (session: SessionInfo) => void
  removeSession: (sessionId: string) => void
  setActiveSession: (sessionId: string | null) => void
  /** Move a session tab to a final position in the tab order. */
  moveSession: (sessionId: string, toIndex: number) => void
  setConnecting: (connectionId: string, value: boolean) => void
  setLost: (sessionId: string, message: string) => void
  clearLost: (sessionId: string) => void
  setReconnecting: (sessionId: string, value: boolean) => void
  setPath: (sessionId: string, path: string) => void
}

export const useSessionStore = create<SessionStoreState>((set) => ({
  sessions: {},
  order: [],
  activeSessionId: null,
  connecting: {},
  lost: {},
  reconnecting: {},
  paths: {},

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
      const lost: Record<string, string> = {}
      for (const session of sessions) {
        if (!session.usable) {
          lost[session.id] =
            state.lost[session.id] ?? "The connection was lost. Reconnect to continue."
        }
      }
      const reconnecting = Object.fromEntries(
        Object.entries(state.reconnecting).filter(([sessionId]) => next[sessionId]),
      )
      const paths = Object.fromEntries(
        Object.entries(state.paths).filter(([sessionId]) => next[sessionId]),
      )
      return { sessions: next, order, activeSessionId, lost, reconnecting, paths }
    }),

  upsertSession: (session) =>
    set((state) => {
      const exists = Boolean(state.sessions[session.id])
      return {
        sessions: { ...state.sessions, [session.id]: session },
        order: exists ? state.order : [...state.order, session.id],
        activeSessionId: state.activeSessionId ?? session.id,
        lost: Object.fromEntries(
          Object.entries(state.lost).filter(([sessionId]) => sessionId !== session.id),
        ),
      }
    }),

  removeSession: (sessionId) =>
    set((state) => {
      if (!state.sessions[sessionId]) return state
      const sessions = { ...state.sessions }
      delete sessions[sessionId]
      const lost = { ...state.lost }
      delete lost[sessionId]
      const reconnecting = { ...state.reconnecting }
      delete reconnecting[sessionId]
      const paths = { ...state.paths }
      delete paths[sessionId]
      const order = state.order.filter((id) => id !== sessionId)
      const activeSessionId =
        state.activeSessionId === sessionId
          ? (order[order.length - 1] ?? null)
          : state.activeSessionId
      return { sessions, order, activeSessionId, lost, reconnecting, paths }
    }),

  setActiveSession: (activeSessionId) => set({ activeSessionId }),

  moveSession: (sessionId, toIndex) =>
    set((state) => {
      const from = state.order.indexOf(sessionId)
      if (from < 0 || state.order.length < 2) return state
      const to = Math.max(0, Math.min(toIndex, state.order.length - 1))
      if (to === from) return state
      const order = [...state.order]
      order.splice(from, 1)
      order.splice(to, 0, sessionId)
      return { order }
    }),

  setConnecting: (connectionId, value) =>
    set((state) => {
      const connecting = { ...state.connecting }
      if (value) connecting[connectionId] = true
      else delete connecting[connectionId]
      return { connecting }
    }),

  setLost: (sessionId, message) =>
    set((state) => ({ lost: { ...state.lost, [sessionId]: message } })),

  clearLost: (sessionId) =>
    set((state) => {
      if (!(sessionId in state.lost)) return state
      const lost = { ...state.lost }
      delete lost[sessionId]
      return { lost }
    }),

  setReconnecting: (sessionId, value) =>
    set((state) => {
      const reconnecting = { ...state.reconnecting }
      if (value) reconnecting[sessionId] = true
      else delete reconnecting[sessionId]
      return { reconnecting }
    }),

  setPath: (sessionId, path) =>
    set((state) =>
      state.paths[sessionId] === path ? state : { paths: { ...state.paths, [sessionId]: path } },
    ),
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
