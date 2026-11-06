import { AppProviders } from "@/app/providers"
import { AppShell } from "@/features/shell/app-shell"

export default function App() {
  return (
    <AppProviders>
      <AppShell />
    </AppProviders>
  )
}
