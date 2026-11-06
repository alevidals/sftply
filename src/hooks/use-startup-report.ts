import { useQuery } from "@tanstack/react-query"
import { ipc } from "@/lib/ipc/client"

export const STARTUP_REPORT_QUERY_KEY = ["startup-report"] as const

export function useStartupReport() {
  return useQuery({
    queryKey: STARTUP_REPORT_QUERY_KEY,
    queryFn: ipc.startupReport,
    staleTime: Number.POSITIVE_INFINITY,
    retry: 0,
  })
}
