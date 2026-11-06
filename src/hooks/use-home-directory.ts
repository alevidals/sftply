import { useQuery } from "@tanstack/react-query"
import { homeDir } from "@tauri-apps/api/path"

export function useHomeDirectory() {
  return useQuery({
    queryKey: ["home-directory"],
    queryFn: () => homeDir(),
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  })
}
