import { beforeEach, describe, expect, it } from "vitest"
import type { SessionInfo } from "@/lib/ipc/bindings"
import { useSessionStore } from "@/stores/session-store"

const session: SessionInfo = {
  id: "s1",
  connectionId: "c1",
  name: "Old name",
  protocol: "ftp",
  host: "127.0.0.1",
  port: 2121,
  username: "sftply",
  initialPath: "/",
  capabilities: {
    list: true,
    mkdir: true,
    remove: true,
    rename: true,
    chmod: true,
    chown: false,
    symlinks: false,
    unixPermissions: true,
    detailedListing: true,
    resumeDownload: "supported",
    resumeUpload: "supported",
    serverSideMove: false,
    serverSideCopy: false,
    textRead: true,
    textWrite: true,
  },
  connectedAt: 0,
  latencyMs: 1,
  usable: true,
}

describe("session store", () => {
  beforeEach(() => {
    useSessionStore.setState({
      sessions: {},
      order: [],
      activeSessionId: null,
      connecting: {},
      lost: {},
      reconnecting: {},
      paths: {},
    })
  })

  it("renames open sessions when their connection is renamed", () => {
    useSessionStore.getState().setSessions([session])

    useSessionStore.getState().syncConnectionNames([{ id: "c1", name: "New name" }])

    expect(useSessionStore.getState().sessions.s1?.name).toBe("New name")
  })

  it("leaves sessions alone when the names already match", () => {
    useSessionStore.getState().setSessions([session])
    const sessions = useSessionStore.getState().sessions

    useSessionStore.getState().syncConnectionNames([{ id: "c1", name: "Old name" }])

    expect(useSessionStore.getState().sessions).toBe(sessions)
  })
})
