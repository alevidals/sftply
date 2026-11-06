import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { type ReactNode, useState } from "react"
import { Toaster } from "@/components/ui/sonner"
import { TooltipProvider } from "@/components/ui/tooltip"
import { SettingsProvider } from "@/features/settings/settings-context"

export function AppProviders({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            retry: 1,
            refetchOnWindowFocus: false,
            staleTime: 30_000,
          },
        },
      }),
  )

  return (
    <QueryClientProvider client={queryClient}>
      <SettingsProvider>
        <TooltipProvider delayDuration={250}>
          {children}
          <Toaster position="bottom-right" closeButton />
        </TooltipProvider>
      </SettingsProvider>
    </QueryClientProvider>
  )
}
