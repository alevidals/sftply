import { useQuery, useQueryClient } from "@tanstack/react-query"
import { AlertTriangleIcon } from "lucide-react"
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { BrandMark } from "@/components/brand"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { normalizeError } from "@/lib/errors"
import type { AppSettings_Serialize, CustomTheme, DateFormat, SizeFormat } from "@/lib/ipc/bindings"
import { ipc } from "@/lib/ipc/client"
import {
  applyDocumentDensity,
  applyDocumentTheme,
  type EffectiveTheme,
  rememberAppearance,
  resolveTheme,
} from "@/lib/theme"
import { useUiStore } from "@/stores/ui-store"

const SETTINGS_QUERY_KEY = ["settings"] as const
const THEMES_QUERY_KEY = ["custom-themes"] as const

interface SettingsContextValue {
  settings: AppSettings_Serialize
  updateSettings: (patch: Partial<AppSettings_Serialize>) => Promise<AppSettings_Serialize>
  saving: boolean
  effectiveTheme: EffectiveTheme
  themes: CustomTheme[]
  themeWarnings: string[]
  reloadThemes: () => Promise<unknown>
}

const SettingsContext = createContext<SettingsContextValue | null>(null)

export function SettingsProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()
  const query = useQuery({
    queryKey: SETTINGS_QUERY_KEY,
    queryFn: ipc.settingsGet,
    staleTime: Number.POSITIVE_INFINITY,
    retry: 1,
  })
  const themesQuery = useQuery({
    queryKey: THEMES_QUERY_KEY,
    queryFn: ipc.themesList,
    staleTime: 1_000,
    refetchInterval: 3_000,
    refetchIntervalInBackground: true,
    retry: 1,
  })
  const customThemes = themesQuery.data?.themes ?? []

  const currentRef = useRef<AppSettings_Serialize | null>(null)
  const persistedRef = useRef<AppSettings_Serialize | null>(null)
  const queueRef = useRef<Promise<unknown>>(Promise.resolve())
  const [saving, setSaving] = useState(false)
  const themePreviewActive = useUiStore((state) => state.themePreviewActive)
  const [effectiveTheme, setEffectiveTheme] = useState<EffectiveTheme>(() =>
    document.documentElement.classList.contains("dark") ? "dark" : "light",
  )

  if (query.data && currentRef.current === null) {
    currentRef.current = query.data
    persistedRef.current = query.data
  }

  const themeMode = query.data?.theme
  const density = query.data?.density

  useEffect(() => {
    if (!themeMode || themePreviewActive) return
    // A selected custom theme needs its file before the first paint. Loading
    // the built-in fallback first would flash the wrong palette.
    if (themeMode.startsWith("custom:") && themesQuery.isPending) return
    const media = window.matchMedia("(prefers-color-scheme: dark)")
    const sync = () => {
      const next = resolveTheme(themeMode, media.matches, customThemes)
      setEffectiveTheme(next.dark ? "dark" : "light")
      applyDocumentTheme(next)
    }

    sync()
    if (themeMode !== "system") return
    media.addEventListener("change", sync)
    return () => media.removeEventListener("change", sync)
  }, [customThemes, themeMode, themesQuery.isPending, themePreviewActive])

  useEffect(() => {
    if (!density || !themeMode) return
    applyDocumentDensity(density)
    rememberAppearance(themeMode, density)
  }, [density, themeMode])

  const updateSettings = useCallback(
    (patch: Partial<AppSettings_Serialize>): Promise<AppSettings_Serialize> => {
      const base = currentRef.current
      if (!base) {
        return Promise.reject(
          normalizeError(null, "Settings are still loading. Please try again in a moment."),
        )
      }

      const next: AppSettings_Serialize = { ...base, ...patch }
      currentRef.current = next
      queryClient.setQueryData(SETTINGS_QUERY_KEY, next)

      const task = queueRef.current.then(async () => {
        setSaving(true)
        try {
          const saved = await ipc.settingsUpdate(next)
          persistedRef.current = saved
          if (currentRef.current === next) {
            currentRef.current = saved
            queryClient.setQueryData(SETTINGS_QUERY_KEY, saved)
          }
          return saved
        } catch (error) {
          if (currentRef.current === next) {
            const fallback = persistedRef.current
            if (fallback) {
              currentRef.current = fallback
              queryClient.setQueryData(SETTINGS_QUERY_KEY, fallback)
            }
          }
          throw normalizeError(error, "Could not save your settings.")
        } finally {
          setSaving(false)
        }
      })

      queueRef.current = task.catch(() => undefined)
      return task
    },
    [queryClient],
  )

  const value = useMemo<SettingsContextValue | null>(() => {
    if (!query.data) return null
    return {
      settings: query.data,
      updateSettings,
      saving,
      effectiveTheme,
      themes: customThemes,
      themeWarnings: themesQuery.data?.warnings ?? [],
      reloadThemes: () => queryClient.invalidateQueries({ queryKey: THEMES_QUERY_KEY }),
    }
  }, [
    customThemes,
    effectiveTheme,
    query.data,
    queryClient,
    saving,
    themesQuery.data?.warnings,
    updateSettings,
  ])

  if (query.isPending) return <BootScreen />
  if (query.isError || !value) {
    return <BootError error={query.error} onRetry={() => void query.refetch()} />
  }

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>
}

export function useSettings(): SettingsContextValue {
  const value = useContext(SettingsContext)
  if (!value) throw new Error("useSettings must be used inside SettingsProvider")
  return value
}

/**
 * Formatting preferences with safe defaults, so presentational components can
 * be tested without mounting the full settings provider.
 */
export function useFormatPreferences(): {
  sizeFormat: SizeFormat
  dateFormat: DateFormat
} {
  const value = useContext(SettingsContext)
  return {
    sizeFormat: value?.settings.sizeFormat ?? "binary",
    dateFormat: value?.settings.dateFormat ?? "friendly",
  }
}

function BootScreen() {
  return (
    <div className="relative flex h-full items-center justify-center overflow-hidden bg-background text-foreground">
      <div className="panel-grid pointer-events-none absolute inset-0 opacity-40" />
      <div className="relative flex flex-col items-center gap-5">
        <BrandMark className="size-14 shadow-2xl shadow-primary/20" />
        <div className="space-y-1 text-center">
          <h1 className="text-lg font-semibold tracking-tight">sftply</h1>
          <p className="text-sm text-muted-foreground">Starting your workspace…</p>
        </div>
        <Spinner className="size-4 text-muted-foreground" />
      </div>
    </div>
  )
}

function BootError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const normalized = normalizeError(error, "sftply could not load its settings.")

  return (
    <div className="flex h-full items-center justify-center bg-background p-8 text-foreground">
      <div className="w-full max-w-md space-y-4 rounded-xl border border-border bg-card p-6 shadow-sm">
        <div className="flex items-center gap-3">
          <span className="flex size-9 items-center justify-center rounded-lg bg-destructive/10 text-destructive">
            <AlertTriangleIcon className="size-4.5" />
          </span>
          <div>
            <h1 className="text-sm font-semibold">sftply could not start</h1>
            <p className="text-xs text-muted-foreground">
              The application settings could not be loaded.
            </p>
          </div>
        </div>
        <p className="text-sm text-muted-foreground">{normalized.message}</p>
        {normalized.detail ? (
          <pre className="max-h-32 overflow-auto rounded-md border border-border bg-muted/50 p-2 font-mono text-2xs text-muted-foreground">
            {normalized.detail}
          </pre>
        ) : null}
        <Button onClick={onRetry} size="sm">
          Try again
        </Button>
      </div>
    </div>
  )
}
