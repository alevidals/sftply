import { useQuery } from "@tanstack/react-query"
import { localFiles } from "@/features/files/api"

export const localListingKey = (path: string, showHidden: boolean) =>
  ["fs", "local", path, showHidden] as const

export function useLocalListing(path: string | null, showHidden: boolean) {
  return useQuery({
    queryKey: localListingKey(path ?? "", showHidden),
    queryFn: () => localFiles.list(path ?? "", showHidden),
    enabled: Boolean(path),
    retry: false,
    refetchOnWindowFocus: false,
    staleTime: 5_000,
  })
}
