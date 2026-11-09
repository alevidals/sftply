import { beforeEach, describe, expect, it } from "vitest"
import type { FsCapabilities, SessionInfo } from "@/lib/ipc/bindings"
import { useSessionStore } from "@/stores/session-store"

const capabilities: FsCapabilities = {
  list: true,
  mkdir: true,
  remove: true,
  rename: true,
  chmod: true,
  chown: false,
  symlinks: true,
  unixPermissions: true,
  detailedListing: true,
  resumeDownload: "supported",
  resumeUpload: "supported",
  serverSideMove: false,
  serverSideCopy: false,
  textRead: false,
  textWrite: false,
}

function session(id: string): SessionInfo {
  return {
    id,
    connectionId: `connection-${id}`,
    name: id,
    protocol: "sftp",
    host: "example.com",
    port: 22,
    username: "ada",
    initialPath: "/",
    capabilities,
    connectedAt: 0,
    latencyMs: 12,
    usable: true,
  }
}

const initialState = {
  sessions: {},
  order: [],
  activeSessionId: null,
  connecting: {},
  lost: {},
  reconnecting: {},
  paths: {},
}

beforeEach(() => {
  useSessionStore.setState(initialState)
})

describe("session store", () => {
  it("tracks and clears lost sessions", () => {
    const store = useSessionStore.getState()
    store.upsertSession(session("a"))
    store.setLost("a", "The connection was lost.")
    expect(useSessionStore.getState().lost.a).toBe("The connection was lost.")

    store.clearLost("a")
    expect(useSessionStore.getState().lost.a).toBeUndefined()
  })

  it("clears the lost flag when a session reconnects", () => {
    const store = useSessionStore.getState()
    store.upsertSession(session("a"))
    store.setLost("a", "lost")
    store.upsertSession(session("a"))
    expect(useSessionStore.getState().lost.a).toBeUndefined()
  })

  it("removes lost and reconnecting state with the session", () => {
    const store = useSessionStore.getState()
    store.upsertSession(session("a"))
    store.setLost("a", "lost")
    store.setReconnecting("a", true)
    store.removeSession("a")

    const state = useSessionStore.getState()
    expect(state.sessions.a).toBeUndefined()
    expect(state.lost.a).toBeUndefined()
    expect(state.reconnecting.a).toBeUndefined()
  })

  it("drops lost state for sessions that disappeared on refresh", () => {
    const store = useSessionStore.getState()
    store.upsertSession(session("a"))
    store.setLost("a", "lost")
    store.setSessions([session("b")])

    const state = useSessionStore.getState()
    expect(state.lost.a).toBeUndefined()
    expect(state.order).toEqual(["b"])
  })

  it("keeps the last folder across a reconnect and drops it with the session", () => {
    const store = useSessionStore.getState()
    store.upsertSession(session("a"))
    store.setPath("a", "/var/log")
    store.upsertSession(session("a"))
    expect(useSessionStore.getState().paths.a).toBe("/var/log")

    store.removeSession("a")
    expect(useSessionStore.getState().paths.a).toBeUndefined()
  })

  it("marks unusable sessions as lost when the list is restored", () => {
    useSessionStore.getState().setSessions([{ ...session("a"), usable: false }])
    expect(useSessionStore.getState().lost.a).toBe(
      "The connection was lost. Reconnect to continue.",
    )

    useSessionStore.getState().setSessions([session("a")])
    expect(useSessionStore.getState().lost.a).toBeUndefined()
  })
})
