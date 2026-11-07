import { useQuery } from "@tanstack/react-query"
import { connectionsApi } from "@/features/connections/api"
import type { SecretStatus } from "@/lib/ipc/bindings"

export const connectionsQueryKey = ["connections"] as const
export const secretStatusQueryKey = (id: string) => ["connection-secret", id] as const

export function useConnections() {
  return useQuery({
    queryKey: connectionsQueryKey,
    queryFn: () => connectionsApi.list(),
    staleTime: 10_000,
    refetchOnWindowFocus: false,
  })
}

export function useSecretStatus(id: string | null, enabled: boolean) {
  return useQuery<SecretStatus>({
    queryKey: secretStatusQueryKey(id ?? "new"),
    queryFn: () => connectionsApi.secretStatus(id ?? ""),
    enabled: enabled && Boolean(id),
    staleTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
  })
}
