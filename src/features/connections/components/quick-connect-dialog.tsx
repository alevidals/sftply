import { zodResolver } from "@hookform/resolvers/zod"
import { open as openFileDialog } from "@tauri-apps/plugin-dialog"
import { FolderOpenIcon, KeyRoundIcon, LockKeyholeIcon, ServerIcon, ZapIcon } from "lucide-react"
import { useEffect, useState } from "react"
import { Controller, useForm } from "react-hook-form"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import {
  defaultPort,
  emptyQuickConnectValues,
  PROTOCOL_LABELS,
  type QuickConnectValues,
  quickConnectSchema,
  toQuickConnectInput,
} from "@/features/connections/schema"
import { useSessionActions } from "@/features/sessions/hooks/use-session-actions"
import { errorMessage } from "@/lib/errors"
import type { ConnectionProtocol } from "@/lib/ipc/bindings"
import { useUiStore } from "@/stores/ui-store"

/**
 * Connect with ad-hoc credentials. The secret only lives in Rust memory unless
 * the user opts into saving the connection.
 */
export function QuickConnectDialog() {
  const open = useUiStore((state) => state.quickConnectOpen)
  const setOpen = useUiStore((state) => state.setQuickConnectOpen)
  const { quickConnect } = useSessionActions()
  const form = useForm<QuickConnectValues>({
    resolver: zodResolver(quickConnectSchema),
    defaultValues: emptyQuickConnectValues(),
  })
  const [connecting, setConnecting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const authKind = form.watch("authKind")
  const protocol = form.watch("protocol")
  const save = form.watch("save")

  useEffect(() => {
    if (!open) return
    form.reset(emptyQuickConnectValues())
    setError(null)
    setConnecting(false)
  }, [open, form])

  const changeProtocol = (value: string, onChange: (next: ConnectionProtocol) => void) => {
    const next = value as ConnectionProtocol
    const currentPort = form.getValues("port")
    if (!currentPort || Number(currentPort) === defaultPort(protocol)) {
      form.setValue("port", String(defaultPort(next)))
    }
    if (next !== "sftp" && form.getValues("authKind") === "key") {
      form.setValue("authKind", "password")
    }
    onChange(next)
  }

  const pickKey = async () => {
    const selected = await openFileDialog({
      multiple: false,
      directory: false,
      title: "Choose a private key",
    })
    if (typeof selected === "string") {
      form.setValue("keyPath", selected, { shouldValidate: true })
    }
  }

  const submit = form.handleSubmit(async (values) => {
    setConnecting(true)
    setError(null)
    try {
      await quickConnect(toQuickConnectInput(values), values.secret, values.save)
      // A host-key challenge hands off to the host-key dialog; either way the
      // quick-connect form is done.
      setOpen(false)
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setConnecting(false)
    }
  })

  const formError = error ?? form.formState.errors.root?.message

  return (
    <Dialog open={open} onOpenChange={(next) => !connecting && setOpen(next)}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ZapIcon className="size-4 text-primary" />
              Quick connect
            </DialogTitle>
            <DialogDescription>
              Connect with credentials for this session. Secrets stay in memory unless you save the
              connection.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="quick-connect-protocol">Protocol</Label>
                <Controller
                  control={form.control}
                  name="protocol"
                  render={({ field }) => (
                    <Select
                      value={field.value}
                      onValueChange={(value) => changeProtocol(value, field.onChange)}
                    >
                      <SelectTrigger id="quick-connect-protocol" className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {(Object.keys(PROTOCOL_LABELS) as ConnectionProtocol[]).map((value) => (
                          <SelectItem key={value} value={value}>
                            {PROTOCOL_LABELS[value]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="quick-connect-port">Port</Label>
                <Input
                  id="quick-connect-port"
                  {...form.register("port")}
                  inputMode="numeric"
                  aria-invalid={Boolean(form.formState.errors.port)}
                  className="font-mono"
                />
                <FieldMessage message={form.formState.errors.port?.message} />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="quick-connect-host">Host</Label>
                <Input
                  id="quick-connect-host"
                  {...form.register("host")}
                  aria-invalid={Boolean(form.formState.errors.host)}
                  placeholder="ftp.example.com"
                  autoComplete="off"
                  spellCheck={false}
                />
                <FieldMessage message={form.formState.errors.host?.message} />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="quick-connect-username">Username</Label>
                <Input
                  id="quick-connect-username"
                  {...form.register("username")}
                  aria-invalid={Boolean(form.formState.errors.username)}
                  autoComplete="username"
                  spellCheck={false}
                />
                <FieldMessage message={form.formState.errors.username?.message} />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="quick-connect-auth">Authentication</Label>
              <Controller
                control={form.control}
                name="authKind"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger id="quick-connect-auth" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="password">
                        <LockKeyholeIcon />
                        Password
                      </SelectItem>
                      <SelectItem value="key" disabled={protocol !== "sftp"}>
                        <KeyRoundIcon />
                        SSH key
                      </SelectItem>
                    </SelectContent>
                  </Select>
                )}
              />
              <FieldMessage message={form.formState.errors.authKind?.message} />
            </div>

            {authKind === "key" ? (
              <div className="space-y-3 rounded-lg border border-border/70 bg-muted/20 p-3">
                <div className="space-y-1.5">
                  <Label htmlFor="quick-connect-key">Private key</Label>
                  <div className="flex gap-2">
                    <Input
                      id="quick-connect-key"
                      {...form.register("keyPath")}
                      aria-invalid={Boolean(form.formState.errors.keyPath)}
                      placeholder="/Users/you/.ssh/id_ed25519"
                      spellCheck={false}
                      className="font-mono text-xs"
                    />
                    <Button type="button" variant="outline" size="sm" onClick={pickKey}>
                      <FolderOpenIcon />
                      Choose…
                    </Button>
                  </div>
                  <FieldMessage message={form.formState.errors.keyPath?.message} />
                </div>

                <div className="flex items-center justify-between gap-3">
                  <div className="space-y-0.5">
                    <Label htmlFor="quick-connect-passphrase">Key needs a passphrase</Label>
                    <p className="text-2xs text-muted-foreground">
                      {save
                        ? "The passphrase is stored in the keychain."
                        : "The passphrase is kept in memory for this session."}
                    </p>
                  </div>
                  <Controller
                    control={form.control}
                    name="passphraseProtected"
                    render={({ field }) => (
                      <Switch
                        id="quick-connect-passphrase"
                        checked={field.value}
                        onCheckedChange={field.onChange}
                      />
                    )}
                  />
                </div>
              </div>
            ) : null}

            <div className="space-y-1.5">
              <Label htmlFor="quick-connect-secret">
                {authKind === "key" ? "Passphrase" : "Password"}
              </Label>
              <Input
                id="quick-connect-secret"
                type="password"
                {...form.register("secret")}
                autoComplete="off"
                placeholder={
                  authKind === "key" && !form.watch("passphraseProtected")
                    ? "Optional"
                    : save
                      ? "Stored in your keychain"
                      : "Used for this session only"
                }
              />
              <FieldMessage message={form.formState.errors.secret?.message} />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="quick-connect-path">Start folder</Label>
              <Input
                id="quick-connect-path"
                {...form.register("initialPath")}
                aria-invalid={Boolean(form.formState.errors.initialPath)}
                placeholder="/"
                spellCheck={false}
                className="font-mono text-xs"
              />
              <FieldMessage message={form.formState.errors.initialPath?.message} />
            </div>

            <div className="flex items-center justify-between gap-3 rounded-lg border border-border/70 px-3 py-2">
              <div className="space-y-0.5">
                <Label htmlFor="quick-connect-save">Save this connection</Label>
                <p className="text-2xs text-muted-foreground">
                  {save
                    ? "The profile is saved and the secret goes to your keychain."
                    : "Nothing is written to the config or the keychain."}
                </p>
              </div>
              <Controller
                control={form.control}
                name="save"
                render={({ field }) => (
                  <Switch
                    id="quick-connect-save"
                    checked={field.value}
                    onCheckedChange={field.onChange}
                  />
                )}
              />
            </div>

            {save ? (
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="quick-connect-name">Name</Label>
                  <Input
                    id="quick-connect-name"
                    {...form.register("name")}
                    aria-invalid={Boolean(form.formState.errors.name)}
                    placeholder="Production server"
                    autoComplete="off"
                  />
                  <FieldMessage message={form.formState.errors.name?.message} />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="quick-connect-group">Group (optional)</Label>
                  <Input
                    id="quick-connect-group"
                    {...form.register("group")}
                    aria-invalid={Boolean(form.formState.errors.group)}
                    placeholder="Work"
                    autoComplete="off"
                  />
                  <FieldMessage message={form.formState.errors.group?.message} />
                </div>
              </div>
            ) : null}
          </div>

          {formError ? (
            <p
              className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive"
              role="alert"
            >
              {formError}
            </p>
          ) : null}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={connecting}
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={connecting}>
              <ServerIcon />
              {connecting ? "Connecting…" : "Connect"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function FieldMessage({ message }: { message?: string }) {
  if (!message) return null
  return (
    <p className="text-2xs text-destructive" role="alert">
      {message}
    </p>
  )
}
