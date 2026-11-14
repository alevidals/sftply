import type {
  ConnectionExportSummary,
  ConnectionImportSummary,
  ConnectionInput_Deserialize,
  ConnectionProfile_Serialize,
  SecretKind,
  SecretStatus,
} from "@/lib/ipc/bindings"
import { ipc } from "@/lib/ipc/client"

/** Connection metadata API. Secrets are only written, never read. */
export const connectionsApi = {
  list(): Promise<ConnectionProfile_Serialize[]> {
    return ipc.connectionsList()
  },

  create(input: ConnectionInput_Deserialize): Promise<ConnectionProfile_Serialize> {
    return ipc.connectionCreate(input)
  },

  update(id: string, input: ConnectionInput_Deserialize): Promise<ConnectionProfile_Serialize> {
    return ipc.connectionUpdate(id, input)
  },

  remove(id: string): Promise<void> {
    return ipc.connectionDelete(id)
  },

  duplicate(id: string): Promise<ConnectionProfile_Serialize> {
    return ipc.connectionDuplicate(id)
  },

  setFavorite(id: string, favorite: boolean): Promise<ConnectionProfile_Serialize> {
    return ipc.connectionSetFavorite(id, favorite)
  },

  test(input: ConnectionInput_Deserialize, id: string | null, secret: string | null) {
    return ipc.connectionTest(input, id, secret)
  },

  reorder(ids: string[]): Promise<ConnectionProfile_Serialize[]> {
    return ipc.connectionReorder(ids)
  },

  setSecret(id: string, kind: SecretKind, secret: string): Promise<void> {
    return ipc.connectionSecretSet(id, kind, secret)
  },

  deleteSecret(id: string, kind: SecretKind): Promise<void> {
    return ipc.connectionSecretDelete(id, kind)
  },

  secretStatus(id: string): Promise<SecretStatus> {
    return ipc.connectionSecretStatus(id)
  },

  /** Write every non-secret connection field to a JSON bundle. */
  exportTo(path: string): Promise<ConnectionExportSummary> {
    return ipc.connectionsExport(path)
  },

  /** Merge a bundle into the saved connections, skipping duplicates. */
  importFrom(path: string): Promise<ConnectionImportSummary> {
    return ipc.connectionsImport(path)
  },
}
