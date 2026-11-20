import { zodResolver } from "@hookform/resolvers/zod"
import { open as openFileDialog } from "@tauri-apps/plugin-dialog"
import {
  FingerprintIcon,
  FolderOpenIcon,
  KeyRoundIcon,
  LockKeyholeIcon,
  PlugZapIcon,
  ServerIcon,
  ZapIcon,
} from "lucide-react"
import { useEffect, useState } from "react"
import { Controller, useForm } from "react-hook-form"
import { toast } from "sonner"
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
import { connectionsApi } from "@/features/connections/api"
import {
  defaultPort,
  emptyQuickConnectValues,
  PROTOCOL_LABELS,
  protocolIsFtps,
  protocolUsesDataMode,
  type QuickConnectValues,
  quickConnectSchema,
  toQuickConnectInput,
} from "@/features/connections/schema"
import { useSessionActions } from "@/features/sessions/hooks/use-session-actions"
import { errorMessage, normalizeError } from "@/lib/errors"
import type { ConnectionProtocol } from "@/lib/ipc/bindings"
import { recordActivity } from "@/stores/activity-store"
import { useHostKeyStore } from "@/stores/host-key-store"
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
  const [testing, setTesting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const requestHostKey = useHostKeyStore((state) => state.request)
  const authKind = form.watch("authKind")
  const protocol = form.watch("protocol")
  const save = form.watch("save")
  const tlsAllowInvalid = form.watch("tlsAllowInvalid")

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
    if (next !== "sftp" && ["key", "agent"].includes(form.getValues("authKind"))) {
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

  const pickCaFile = async () => {
    const selected = await openFileDialog({
      multiple: false,
      directory: false,
      title: "Choose a CA certificate bundle",
    })
    if (typeof selected === "string") {
      form.setValue("tlsCaFile", selected, { shouldValidate: true })
    }
  }

  const testConnection = async (
    values: QuickConnectValues,
    allowHostKeyPrompt: boolean,
  ): Promise<void> => {
    setTesting(true)
    setError(null)
    try {
      const result = await connectionsApi.test(
        toQuickConnectInput(values),
        null,
        values.secret || null,
      )
      toast.success(`Connected in ${Math.max(1, Math.round(result.latencyMs))} ms`, {
        description: `${result.entryCount} items in ${result.path}`,
      })
      recordActivity(
        "success",
        `Tested ${values.host.trim() || "the server"} (${Math.round(result.latencyMs)} ms)`,
      )
    } catch (cause) {
      const normalized = normalizeError(cause)
      if (normalized.hostKey && allowHostKeyPrompt) {
        setError("This server's host key is not trusted yet. Review it to continue.")
        requestHostKey(null, normalized.hostKey, () => testConnection(values, false))
      } else {
        setError(normalized.message)
      }
    } finally {
      setTesting(false)
    }
  }

  const runTest = async () => {
    if (!(await form.trigger())) return
    await testConnection(form.getValues(), true)
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
      <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-lg">
        <form onSubmit={submit} className="flex max-h-[calc(100vh-4rem)] min-h-0 flex-col">
          <div className="min-h-0 flex-1 space-y-4 overflow-x-hidden overflow-y-auto p-4">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <ZapIcon className="size-4 text-primary" />
                Quick connect
              </DialogTitle>
              <DialogDescription>
                Connect with credentials for this session. Secrets stay in memory unless you save
                the connection.
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
                    placeholder={protocol === "sftp" ? "ada" : "anonymous"}
                    autoComplete="username"
                    spellCheck={false}
                  />
                  <FieldMessage message={form.formState.errors.username?.message} />
                  {protocol !== "sftp" ? (
                    <p className="text-2xs text-muted-foreground">
                      Leave blank to connect anonymously. The password is optional.
                    </p>
                  ) : null}
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
                        <SelectItem value="agent" disabled={protocol !== "sftp"}>
                          <FingerprintIcon />
                          SSH agent
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

              {authKind === "agent" ? (
                <div className="space-y-1 rounded-lg border border-border/70 bg-muted/20 p-3">
                  <p className="text-xs font-medium">System SSH agent</p>
                  <p className="text-2xs leading-relaxed text-muted-foreground">
                    sftply asks your running SSH agent to sign. No private key or passphrase is read
                    or stored. Unlock the agent in its own app if it asks.
                  </p>
                </div>
              ) : null}

              {authKind !== "agent" ? (
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
              ) : null}

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

              {protocolUsesDataMode(protocol) ? (
                <div className="space-y-1.5">
                  <Label htmlFor="quick-connect-data-mode">Data channel</Label>
                  <Controller
                    control={form.control}
                    name="ftpDataMode"
                    render={({ field }) => (
                      <Select value={field.value} onValueChange={field.onChange}>
                        <SelectTrigger id="quick-connect-data-mode" className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="passive">Passive (PASV)</SelectItem>
                          <SelectItem value="extendedPassive">Extended passive (EPSV)</SelectItem>
                          <SelectItem value="active">Active (PORT)</SelectItem>
                        </SelectContent>
                      </Select>
                    )}
                  />
                </div>
              ) : null}

              {protocolIsFtps(protocol) ? (
                <div className="space-y-3 rounded-lg border border-border/70 bg-muted/20 p-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="quick-connect-ca-file">Custom CA file (optional)</Label>
                    <div className="flex gap-2">
                      <Input
                        id="quick-connect-ca-file"
                        {...form.register("tlsCaFile")}
                        aria-invalid={Boolean(form.formState.errors.tlsCaFile)}
                        placeholder="/etc/ssl/certs/private-ca.pem"
                        spellCheck={false}
                        className="font-mono text-xs"
                      />
                      <Button type="button" variant="outline" size="sm" onClick={pickCaFile}>
                        <FolderOpenIcon />
                        Choose…
                      </Button>
                    </div>
                    <FieldMessage message={form.formState.errors.tlsCaFile?.message} />
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="quick-connect-pin">Certificate pin (optional)</Label>
                    <Input
                      id="quick-connect-pin"
                      {...form.register("tlsCertificatePin")}
                      aria-invalid={Boolean(form.formState.errors.tlsCertificatePin)}
                      placeholder="SHA-256 fingerprint"
                      spellCheck={false}
                      className="font-mono text-xs"
                    />
                    <FieldMessage message={form.formState.errors.tlsCertificatePin?.message} />
                  </div>

                  <div className="flex items-center justify-between gap-3">
                    <div className="space-y-0.5">
                      <Label htmlFor="quick-connect-invalid">Allow invalid certificates</Label>
                      <p className="text-2xs text-muted-foreground">
                        Only use this on a trusted network.
                      </p>
                    </div>
                    <Controller
                      control={form.control}
                      name="tlsAllowInvalid"
                      render={({ field }) => (
                        <Switch
                          id="quick-connect-invalid"
                          checked={field.value}
                          onCheckedChange={field.onChange}
                        />
                      )}
                    />
                  </div>

                  {tlsAllowInvalid ? (
                    <p className="text-2xs font-medium text-destructive" role="alert">
                      TLS certificate verification is disabled for this connection.
                    </p>
                  ) : null}
                </div>
              ) : null}

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
          </div>

          <DialogFooter className="mx-0 mb-0 shrink-0 rounded-none border-t px-4 py-3">
            <Button
              type="button"
              variant="ghost"
              className="mr-auto"
              disabled={connecting || testing}
              onClick={() => void runTest()}
            >
              <PlugZapIcon />
              {testing ? "Testing…" : "Test connection"}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={connecting || testing}
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={connecting || testing}>
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
