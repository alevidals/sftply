import { useQuery } from "@tanstack/react-query"
import { filesApi, scopeKey } from "@/features/files/api"
import type { FsScope } from "@/lib/ipc/bindings"

export const fsListingKey = (scope: FsScope, path: string, showHidden: boolean) =>
  ["fs", scopeKey(scope), path, showHidden] as const

export function useFsListing(scope: FsScope, path: string | null, showHidden: boolean) {
  return useQuery({
    queryKey: fsListingKey(scope, path ?? "", showHidden),
    queryFn: () => filesApi(scope).list(path ?? "", showHidden),
    enabled: Boolean(path),
    retry: false,
    refetchOnWindowFocus: false,
    staleTime: 5_000,
  })
}
