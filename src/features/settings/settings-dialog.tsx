import { zodResolver } from "@hookform/resolvers/zod"
import { cn } from "cn"
import { CheckIcon } from "lucide-react"
import { useEffect, useRef } from "react"
import { Controller, useForm } from "react-hook-form"
import { toast } from "sonner"
import { z } from "zod"
import { BrandMark } from "@/components/brand"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useSettings } from "@/features/settings/settings-context"
import { ShortcutsPanel } from "@/features/settings/shortcuts-panel"
import { useAppInfo } from "@/hooks/use-app-info"
import { errorMessage } from "@/lib/errors"
import type { AppSettings_Serialize } from "@/lib/ipc/bindings"
import { isMacPlatform } from "@/lib/shortcuts"
import { THEME_OPTIONS, THEME_VALUES } from "@/lib/themes"
import { useUiStore } from "@/stores/ui-store"

const MIN_BANDWIDTH_KBPS = 16
const MAX_BANDWIDTH_KBPS = 10_000_000

const settingsSchema = z.object({
  theme: z.enum(THEME_VALUES),
  density: z.enum(["compact", "comfortable"]),
  sizeFormat: z.enum(["binary", "decimal"]),
  dateFormat: z.enum(["friendly", "iso"]),
  showHiddenFiles: z.boolean(),
  confirmDelete: z.boolean(),
  transferConcurrency: z.number().int().min(1).max(8),
  bandwidthLimit: z.string().refine(
    (value) => {
      if (value.trim() === "") return true
      const parsed = Number(value)
      return (
        Number.isInteger(parsed) && parsed >= MIN_BANDWIDTH_KBPS && parsed <= MAX_BANDWIDTH_KBPS
      )
    },
    { message: `Enter ${MIN_BANDWIDTH_KBPS}–${MAX_BANDWIDTH_KBPS} kbps, or leave it empty.` },
  ),
  connectTimeoutSeconds: z.number().int().min(5).max(300),
  operationTimeoutSeconds: z.number().int().min(5).max(600),
})

type SettingsFormValues = z.infer<typeof settingsSchema>

function toFormValues(settings: AppSettings_Serialize): SettingsFormValues {
  return {
    theme: settings.theme,
    density: settings.density,
    sizeFormat: settings.sizeFormat,
    dateFormat: settings.dateFormat,
    showHiddenFiles: settings.showHiddenFiles,
    confirmDelete: settings.confirmDelete,
    transferConcurrency: settings.transferConcurrency,
    bandwidthLimit: settings.bandwidthLimitKbps?.toString() ?? "",
    connectTimeoutSeconds: settings.connectTimeoutSeconds,
    operationTimeoutSeconds: settings.operationTimeoutSeconds,
  }
}

export function SettingsDialog() {
  const open = useUiStore((state) => state.settingsOpen)
  const setOpen = useUiStore((state) => state.setSettingsOpen)
  const { settings, updateSettings, saving } = useSettings()
  const appInfo = useAppInfo()
  const tab = useUiStore((state) => state.settingsTab)
  const setTab = useUiStore((state) => state.setSettingsTab)
  const wasOpen = useRef(false)
  const isMac = isMacPlatform(appInfo.data?.platform)

  const form = useForm<SettingsFormValues>({
    resolver: zodResolver(settingsSchema),
    defaultValues: toFormValues(settings),
  })

  const { reset, handleSubmit, control, register, formState } = form

  useEffect(() => {
    if (open && !wasOpen.current) reset(toFormValues(settings))
    wasOpen.current = open
  }, [open, settings, reset])

  const onSubmit = handleSubmit(async (values) => {
    const { bandwidthLimit, ...rest } = values
    try {
      await updateSettings({
        ...rest,
        bandwidthLimitKbps: bandwidthLimit.trim() === "" ? null : Number(bandwidthLimit),
      })
      toast.success("Settings saved")
      setOpen(false)
    } catch (error) {
      toast.error("Could not save settings", { description: errorMessage(error) })
    }
  })

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-h-[calc(100vh-2rem)] gap-0 overflow-hidden p-0 sm:max-w-2xl">
        <form onSubmit={onSubmit} className="flex h-[min(600px,calc(100vh-3rem))] min-h-0 flex-col">
          <DialogHeader className="border-b border-border/70 px-5 py-4">
            <DialogTitle>Settings</DialogTitle>
            <DialogDescription>
              Preferences are stored locally and apply to every session.
            </DialogDescription>
          </DialogHeader>

          <Tabs
            orientation="vertical"
            value={tab}
            onValueChange={setTab}
            className="min-h-0 flex-1 gap-0"
          >
            <TabsList className="h-full w-44 shrink-0 items-stretch justify-start gap-0.5 rounded-none border-r border-border/70 bg-muted/20 p-2 group-data-vertical/tabs:h-full">
              <TabsTrigger value="appearance" className="h-8 justify-start px-2.5 text-xs">
                Appearance
              </TabsTrigger>
              <TabsTrigger value="behavior" className="h-8 justify-start px-2.5 text-xs">
                Behavior
              </TabsTrigger>
              <TabsTrigger value="connections" className="h-8 justify-start px-2.5 text-xs">
                Connections
              </TabsTrigger>
              <TabsTrigger value="transfers" className="h-8 justify-start px-2.5 text-xs">
                Transfers
              </TabsTrigger>
              <TabsTrigger value="shortcuts" className="h-8 justify-start px-2.5 text-xs">
                Shortcuts
              </TabsTrigger>
              <TabsTrigger value="about" className="h-8 justify-start px-2.5 text-xs">
                About
              </TabsTrigger>
            </TabsList>

            <div className="min-h-0 flex-1 overflow-y-auto p-5">
              <TabsContent value="appearance" className="space-y-6">
                <section className="space-y-3">
                  <div>
                    <h3 className="text-sm font-medium">Theme</h3>
                    <p className="text-xs text-muted-foreground">
                      sftply is dark by default. Choose an appearance or follow the system.
                    </p>
                  </div>
                  <Controller
                    control={control}
                    name="theme"
                    render={({ field }) => (
                      <div role="radiogroup" aria-label="Theme" className="grid grid-cols-2 gap-2">
                        {THEME_OPTIONS.map((option) => {
                          const Icon = option.icon
                          const selected = field.value === option.value
                          return (
                            <label
                              key={option.value}
                              title={option.description}
                              className={cn(
                                "group relative flex cursor-pointer flex-col gap-1.5 rounded-lg border p-2 text-left transition-colors focus-within:ring-2 focus-within:ring-ring/50",
                                selected
                                  ? "border-primary/40 bg-primary/5"
                                  : "border-border hover:border-border hover:bg-muted/40",
                              )}
                            >
                              <input
                                type="radio"
                                name={field.name}
                                value={option.value}
                                checked={selected}
                                onChange={() => field.onChange(option.value)}
                                onBlur={field.onBlur}
                                className="sr-only"
                              />
                              <span
                                aria-hidden
                                className="flex h-7 w-full items-center gap-1.5 rounded-md border border-black/10 px-2 dark:border-white/10"
                                style={{ backgroundColor: option.preview.background }}
                              >
                                <span
                                  className="size-2 shrink-0 rounded-full"
                                  style={{ backgroundColor: option.preview.accent }}
                                />
                                <span
                                  className="h-1.5 flex-1 rounded-full opacity-70"
                                  style={{ backgroundColor: option.preview.foreground }}
                                />
                                <span
                                  className="size-2 shrink-0 rounded-full opacity-50"
                                  style={{ backgroundColor: option.preview.foreground }}
                                />
                              </span>
                              <span className="flex w-full items-center gap-1.5">
                                <Icon
                                  className={cn(
                                    "size-3.5 shrink-0",
                                    selected ? "text-primary" : "text-muted-foreground",
                                  )}
                                />
                                <span className="min-w-0 flex-1 truncate text-xs font-medium">
                                  {option.label}
                                </span>
                                {selected ? (
                                  <CheckIcon className="size-3.5 shrink-0 text-primary" />
                                ) : null}
                              </span>
                            </label>
                          )
                        })}
                      </div>
                    )}
                  />
                </section>

                <section className="space-y-3">
                  <div>
                    <h3 className="text-sm font-medium">Row density</h3>
                    <p className="text-xs text-muted-foreground">
                      Controls the height of file and activity rows.
                    </p>
                  </div>
                  <Controller
                    control={control}
                    name="density"
                    render={({ field }) => (
                      <div className="grid grid-cols-2 gap-2">
                        {(
                          [
                            { value: "compact", label: "Compact", hint: "30 px rows" },
                            { value: "comfortable", label: "Comfortable", hint: "38 px rows" },
                          ] as const
                        ).map((option) => {
                          const selected = field.value === option.value
                          return (
                            <button
                              key={option.value}
                              type="button"
                              aria-pressed={selected}
                              onClick={() => field.onChange(option.value)}
                              className={cn(
                                "flex items-center justify-between rounded-lg border px-3 py-2.5 text-left transition-colors focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none",
                                selected
                                  ? "border-primary/40 bg-primary/5"
                                  : "border-border hover:bg-muted/40",
                              )}
                            >
                              <span>
                                <span className="block text-xs font-medium">{option.label}</span>
                                <span className="block text-2xs text-muted-foreground">
                                  {option.hint}
                                </span>
                              </span>
                              {selected ? <CheckIcon className="size-3.5 text-primary" /> : null}
                            </button>
                          )
                        })}
                      </div>
                    )}
                  />
                </section>

                <section className="space-y-3">
                  <div>
                    <h3 className="text-sm font-medium">File sizes</h3>
                    <p className="text-xs text-muted-foreground">
                      Binary uses 1 KB = 1024 bytes; decimal uses 1 KB = 1000 bytes.
                    </p>
                  </div>
                  <Controller
                    control={control}
                    name="sizeFormat"
                    render={({ field }) => (
                      <PreferenceChoices
                        value={field.value}
                        onChange={field.onChange}
                        options={[
                          { value: "binary", label: "Binary", hint: "1 KB = 1024 B" },
                          { value: "decimal", label: "Decimal", hint: "1 KB = 1000 B" },
                        ]}
                      />
                    )}
                  />
                </section>

                <section className="space-y-3">
                  <div>
                    <h3 className="text-sm font-medium">Dates</h3>
                    <p className="text-xs text-muted-foreground">
                      Choose a compact friendly date or an unambiguous ISO timestamp.
                    </p>
                  </div>
                  <Controller
                    control={control}
                    name="dateFormat"
                    render={({ field }) => (
                      <PreferenceChoices
                        value={field.value}
                        onChange={field.onChange}
                        options={[
                          { value: "friendly", label: "Friendly", hint: "Nov 13, 10:30" },
                          { value: "iso", label: "ISO 8601", hint: "2026-11-13 10:30" },
                        ]}
                      />
                    )}
                  />
                </section>
              </TabsContent>

              <TabsContent value="behavior" className="space-y-3">
                <Controller
                  control={control}
                  name="showHiddenFiles"
                  render={({ field }) => (
                    <SettingRow
                      title="Show hidden files"
                      description="Include dotfiles in local and remote listings."
                    >
                      <Switch checked={field.value} onCheckedChange={field.onChange} />
                    </SettingRow>
                  )}
                />
                <Controller
                  control={control}
                  name="confirmDelete"
                  render={({ field }) => (
                    <SettingRow
                      title="Confirm destructive actions"
                      description="Ask before deleting files or overwriting an existing item."
                    >
                      <Switch checked={field.value} onCheckedChange={field.onChange} />
                    </SettingRow>
                  )}
                />
              </TabsContent>

              <TabsContent value="connections" className="space-y-4">
                <Field data-invalid={Boolean(formState.errors.connectTimeoutSeconds)}>
                  <FieldLabel htmlFor="connect-timeout">Connection timeout</FieldLabel>
                  <FieldDescription>
                    Seconds to wait while opening a connection. Values from 5 to 300.
                  </FieldDescription>
                  <div className="flex items-center gap-2">
                    <Input
                      id="connect-timeout"
                      type="number"
                      min={5}
                      max={300}
                      className="w-24"
                      aria-invalid={Boolean(formState.errors.connectTimeoutSeconds)}
                      {...register("connectTimeoutSeconds", { valueAsNumber: true })}
                    />
                    <span className="text-xs text-muted-foreground">seconds</span>
                  </div>
                  <FieldError errors={[formState.errors.connectTimeoutSeconds]} />
                </Field>
                <Field data-invalid={Boolean(formState.errors.operationTimeoutSeconds)}>
                  <FieldLabel htmlFor="operation-timeout">Operation timeout</FieldLabel>
                  <FieldDescription>
                    Seconds a single remote listing or file operation may run before it is
                    cancelled. Values from 5 to 600.
                  </FieldDescription>
                  <div className="flex items-center gap-2">
                    <Input
                      id="operation-timeout"
                      type="number"
                      min={5}
                      max={600}
                      className="w-24"
                      aria-invalid={Boolean(formState.errors.operationTimeoutSeconds)}
                      {...register("operationTimeoutSeconds", { valueAsNumber: true })}
                    />
                    <span className="text-xs text-muted-foreground">seconds</span>
                  </div>
                  <FieldError errors={[formState.errors.operationTimeoutSeconds]} />
                </Field>
                <p className="rounded-lg border border-border/70 bg-muted/20 px-3 py-2 text-2xs leading-relaxed text-muted-foreground">
                  A cancelled or timed-out remote operation may leave the protocol stream out of
                  sync. sftply asks you to reconnect rather than guessing the stream state.
                </p>
              </TabsContent>

              <TabsContent value="transfers" className="space-y-4">
                <Field data-invalid={Boolean(formState.errors.transferConcurrency)}>
                  <FieldLabel htmlFor="transfer-concurrency">Simultaneous transfers</FieldLabel>
                  <FieldDescription>
                    How many files sftply may transfer at the same time. Values from 1 to 8.
                  </FieldDescription>
                  <Input
                    id="transfer-concurrency"
                    type="number"
                    min={1}
                    max={8}
                    className="w-24"
                    aria-invalid={Boolean(formState.errors.transferConcurrency)}
                    {...register("transferConcurrency", { valueAsNumber: true })}
                  />
                  <FieldError errors={[formState.errors.transferConcurrency]} />
                </Field>
                <Field data-invalid={Boolean(formState.errors.bandwidthLimit)}>
                  <FieldLabel htmlFor="bandwidth-limit">Bandwidth limit</FieldLabel>
                  <FieldDescription>
                    Caps the combined speed of every transfer. Leave it empty for unlimited. Values
                    from 16 to 10,000,000 kbps.
                  </FieldDescription>
                  <div className="flex items-center gap-2">
                    <Input
                      id="bandwidth-limit"
                      type="number"
                      min={MIN_BANDWIDTH_KBPS}
                      max={MAX_BANDWIDTH_KBPS}
                      step={1}
                      placeholder="Unlimited"
                      className="w-32"
                      aria-invalid={Boolean(formState.errors.bandwidthLimit)}
                      {...register("bandwidthLimit")}
                    />
                    <span className="text-xs text-muted-foreground">kbps</span>
                  </div>
                  <FieldError errors={[formState.errors.bandwidthLimit]} />
                </Field>
              </TabsContent>

              <TabsContent value="shortcuts">
                <ShortcutsPanel isMac={isMac} />
              </TabsContent>

              <TabsContent value="about" className="space-y-5">
                <div className="flex items-center gap-3">
                  <BrandMark className="size-10 shadow-lg shadow-primary/20" />
                  <div>
                    <h3 className="text-sm font-medium">sftply</h3>
                    <p className="text-xs text-muted-foreground">
                      A modern FTP, FTPS and SFTP desktop client.
                    </p>
                  </div>
                </div>
                <dl className="selectable grid grid-cols-[110px_minmax(0,1fr)] gap-x-3 gap-y-2 text-xs">
                  <dt className="text-muted-foreground">Version</dt>
                  <dd className="font-mono text-[11px]">{appInfo.data?.version ?? "—"}</dd>
                  <dt className="text-muted-foreground">Platform</dt>
                  <dd className="font-mono text-[11px]">
                    {appInfo.data ? `${appInfo.data.platform} / ${appInfo.data.arch}` : "—"}
                  </dd>
                  <dt className="text-muted-foreground">Config</dt>
                  <dd className="font-mono text-[11px] break-all text-muted-foreground">
                    {appInfo.data?.configDir ?? "—"}
                  </dd>
                  <dt className="text-muted-foreground">Logs</dt>
                  <dd className="font-mono text-[11px] break-all text-muted-foreground">
                    {appInfo.data?.logDir ?? "—"}
                  </dd>
                </dl>
                <p className="text-2xs leading-relaxed text-muted-foreground">
                  Credentials are stored in the operating system keychain and never written to
                  configuration files or logs.
                </p>
              </TabsContent>
            </div>
          </Tabs>

          <DialogFooter className="mx-0 mb-0 shrink-0 rounded-b-xl border-t border-border/70 bg-muted/20 px-5 py-3">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving} aria-busy={saving} className="relative">
              {/* The label stays in the layout while saving (just transparent),
                  so the button keeps its exact width. The spinner overlays it
                  instead of being inserted, which would widen the right-aligned
                  button and shift both footer buttons. */}
              <span data-slot="submit-label" className={saving ? "opacity-0" : undefined}>
                Save changes
              </span>
              {saving ? (
                <span className="absolute inset-0 flex items-center justify-center">
                  <Spinner aria-hidden className="size-3.5" />
                </span>
              ) : null}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function SettingRow({
  title,
  description,
  children,
}: {
  title: string
  description: string
  children: React.ReactNode
}) {
  return (
    <div className="flex items-center justify-between gap-6 rounded-lg border border-border px-3 py-3">
      <div>
        <p className="text-sm font-medium">{title}</p>
        <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{description}</p>
      </div>
      {children}
    </div>
  )
}

function PreferenceChoices<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T
  options: readonly { value: T; label: string; hint: string }[]
  onChange: (value: T) => void
}) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {options.map((option) => {
        const selected = value === option.value
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={selected}
            onClick={() => onChange(option.value)}
            className={cn(
              "flex items-center justify-between rounded-lg border px-3 py-2.5 text-left transition-colors focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none",
              selected ? "border-primary/40 bg-primary/5" : "border-border hover:bg-muted/40",
            )}
          >
            <span>
              <span className="block text-xs font-medium">{option.label}</span>
              <span className="block text-2xs text-muted-foreground">{option.hint}</span>
            </span>
            {selected ? <CheckIcon className="size-3.5 text-primary" /> : null}
          </button>
        )
      })}
    </div>
  )
}
