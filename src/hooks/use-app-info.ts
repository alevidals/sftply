import { useQuery } from "@tanstack/react-query"
import { ipc } from "@/lib/ipc/client"

export const APP_INFO_QUERY_KEY = ["app-info"] as const

export function useAppInfo() {
  return useQuery({
    queryKey: APP_INFO_QUERY_KEY,
    queryFn: ipc.appInfo,
    staleTime: Number.POSITIVE_INFINITY,
    retry: 1,
  })
}
