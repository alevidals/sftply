import { zodResolver } from "@hookform/resolvers/zod"
import { useQueryClient } from "@tanstack/react-query"
import { open as openFileDialog } from "@tauri-apps/plugin-dialog"
import {
  FolderOpenIcon,
  KeyRoundIcon,
  LockKeyholeIcon,
  PlugZapIcon,
  ServerIcon,
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
  connectionsQueryKey,
  secretStatusQueryKey,
  useSecretStatus,
} from "@/features/connections/hooks/use-connections"
import {
  type ConnectionFormValues,
  connectionSchema,
  defaultPort,
  emptyConnectionValues,
  PROTOCOL_LABELS,
  protocolIsFtps,
  protocolUsesDataMode,
  secretKindFor,
  toConnectionInput,
  valuesFromProfile,
} from "@/features/connections/schema"
import { useDelayedFlag } from "@/hooks/use-delayed-flag"
import { errorMessage } from "@/lib/errors"
import type { ConnectionProfile_Serialize, ConnectionProtocol } from "@/lib/ipc/bindings"
import { recordActivity } from "@/stores/activity-store"

interface ConnectionDialogProps {
  open: boolean
  connection: ConnectionProfile_Serialize | null
  onOpenChange: (open: boolean) => void
}

export function ConnectionDialog({ open, connection, onOpenChange }: ConnectionDialogProps) {
  const queryClient = useQueryClient()
  const form = useForm<ConnectionFormValues>({
    resolver: zodResolver(connectionSchema),
    defaultValues: emptyConnectionValues(),
  })
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const showSaving = useDelayedFlag(saving)
  const [error, setError] = useState<string | null>(null)
  const secretStatus = useSecretStatus(connection?.id ?? null, open)
  const authKind = form.watch("authKind")
  const protocol = form.watch("protocol")
  const tlsAllowInvalid = form.watch("tlsAllowInvalid")

  useEffect(() => {
    if (!open) return
    form.reset(connection ? valuesFromProfile(connection) : emptyConnectionValues())
    setError(null)
    setSaving(false)
  }, [open, connection, form])

  const existingSecret =
    authKind === "key" ? secretStatus.data?.passphrase : secretStatus.data?.password

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

  const submit = form.handleSubmit(async (values) => {
    setSaving(true)
    setError(null)
    try {
      const input = toConnectionInput(values)
      const saved = connection
        ? await connectionsApi.update(connection.id, input)
        : await connectionsApi.create(input)

      if (values.secret) {
        await connectionsApi.setSecret(saved.id, secretKindFor(values), values.secret)
      }

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: connectionsQueryKey }),
        queryClient.invalidateQueries({ queryKey: secretStatusQueryKey(saved.id) }),
      ])
      recordActivity(
        "success",
        connection ? `Updated connection “${saved.name}”` : `Saved connection “${saved.name}”`,
      )
      toast.success(connection ? `Updated “${saved.name}”` : `Saved “${saved.name}”`)
      onOpenChange(false)
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setSaving(false)
    }
  })

  const runTest = async () => {
    if (!(await form.trigger())) return
    const values = form.getValues()
    setTesting(true)
    setError(null)
    try {
      const result = await connectionsApi.test(
        toConnectionInput(values),
        connection?.id ?? null,
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
      setError(errorMessage(cause))
    } finally {
      setTesting(false)
    }
  }

  const removeSecret = async () => {
    if (!connection) return
    try {
      await connectionsApi.deleteSecret(connection.id, secretKindFor(form.getValues()))
      await queryClient.invalidateQueries({ queryKey: secretStatusQueryKey(connection.id) })
      toast.success("Removed the saved secret")
    } catch (cause) {
      setError(errorMessage(cause))
    }
  }

  const formError = error ?? form.formState.errors.root?.message

  return (
    <Dialog open={open} onOpenChange={(next) => !saving && onOpenChange(next)}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={submit} className="max-h-[calc(100vh-6rem)] space-y-4 overflow-y-auto pr-1">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ServerIcon className="size-4 text-primary" />
              {connection ? "Edit connection" : "New connection"}
            </DialogTitle>
            <DialogDescription>
              Credentials are stored in your OS keychain, never in the app config.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="connection-name">Name</Label>
              <Input
                id="connection-name"
                {...form.register("name")}
                aria-invalid={Boolean(form.formState.errors.name)}
                placeholder="Production server"
                autoComplete="off"
              />
              <FieldMessage message={form.formState.errors.name?.message} />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="connection-protocol">Protocol</Label>
                <Controller
                  control={form.control}
                  name="protocol"
                  render={({ field }) => (
                    <Select
                      value={field.value}
                      onValueChange={(value) => changeProtocol(value, field.onChange)}
                    >
                      <SelectTrigger id="connection-protocol" className="w-full">
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
                <Label htmlFor="connection-port">Port</Label>
                <Input
                  id="connection-port"
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
                <Label htmlFor="connection-host">Host</Label>
                <Input
                  id="connection-host"
                  {...form.register("host")}
                  aria-invalid={Boolean(form.formState.errors.host)}
                  placeholder="ftp.example.com"
                  autoComplete="off"
                  spellCheck={false}
                />
                <FieldMessage message={form.formState.errors.host?.message} />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="connection-username">Username</Label>
                <Input
                  id="connection-username"
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
              <Label htmlFor="connection-auth">Authentication</Label>
              <Controller
                control={form.control}
                name="authKind"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger id="connection-auth" className="w-full">
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
                  <Label htmlFor="connection-key">Private key</Label>
                  <div className="flex gap-2">
                    <Input
                      id="connection-key"
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
                    <Label htmlFor="connection-passphrase">Key needs a passphrase</Label>
                    <p className="text-2xs text-muted-foreground">
                      The passphrase is stored in the keychain.
                    </p>
                  </div>
                  <Controller
                    control={form.control}
                    name="passphraseProtected"
                    render={({ field }) => (
                      <Switch
                        id="connection-passphrase"
                        checked={field.value}
                        onCheckedChange={field.onChange}
                      />
                    )}
                  />
                </div>
              </div>
            ) : null}

            <div className="space-y-1.5">
              <Label htmlFor="connection-secret">
                {authKind === "key" ? "Passphrase" : "Password"}
              </Label>
              <Input
                id="connection-secret"
                type="password"
                {...form.register("secret")}
                autoComplete="new-password"
                placeholder={
                  existingSecret
                    ? "Saved in keychain — leave blank to keep"
                    : "Not saved yet — enter to store in keychain"
                }
              />
              <div className="flex items-center justify-between gap-2">
                <FieldMessage message={form.formState.errors.secret?.message} />
                {existingSecret ? (
                  <button
                    type="button"
                    onClick={removeSecret}
                    className="text-2xs text-muted-foreground underline-offset-2 hover:text-destructive hover:underline"
                  >
                    Remove saved secret
                  </button>
                ) : null}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="connection-path">Start folder</Label>
                <Input
                  id="connection-path"
                  {...form.register("initialPath")}
                  aria-invalid={Boolean(form.formState.errors.initialPath)}
                  placeholder="/"
                  spellCheck={false}
                  className="font-mono text-xs"
                />
                <FieldMessage message={form.formState.errors.initialPath?.message} />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="connection-group">Group (optional)</Label>
                <Input
                  id="connection-group"
                  {...form.register("group")}
                  aria-invalid={Boolean(form.formState.errors.group)}
                  placeholder="Work"
                  autoComplete="off"
                />
                <FieldMessage message={form.formState.errors.group?.message} />
              </div>
            </div>

            {protocolUsesDataMode(protocol) ? (
              <div className="space-y-1.5">
                <Label htmlFor="connection-data-mode">Data channel</Label>
                <Controller
                  control={form.control}
                  name="ftpDataMode"
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger id="connection-data-mode" className="w-full">
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
                <p className="text-2xs text-muted-foreground">
                  Passive works through most firewalls. Active requires the server to reach this
                  machine.
                </p>
              </div>
            ) : null}

            {protocolIsFtps(protocol) ? (
              <div className="space-y-3 rounded-lg border border-border/70 bg-muted/20 p-3">
                <div className="space-y-0.5">
                  <p className="text-xs font-medium text-foreground">TLS verification</p>
                  <p className="text-2xs text-muted-foreground">
                    The system trust store is used unless you choose a CA or pin a certificate.
                  </p>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="connection-ca-file">Custom CA file (optional)</Label>
                  <div className="flex gap-2">
                    <Input
                      id="connection-ca-file"
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
                  <Label htmlFor="connection-pin">Certificate pin (optional)</Label>
                  <Input
                    id="connection-pin"
                    {...form.register("tlsCertificatePin")}
                    aria-invalid={Boolean(form.formState.errors.tlsCertificatePin)}
                    placeholder="SHA-256 fingerprint"
                    spellCheck={false}
                    className="font-mono text-xs"
                  />
                  <FieldMessage message={form.formState.errors.tlsCertificatePin?.message} />
                  <p className="text-2xs text-muted-foreground">
                    Pinning rejects any server certificate whose SHA-256 fingerprint differs.
                  </p>
                </div>

                <div className="flex items-center justify-between gap-3 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2">
                  <div className="space-y-0.5">
                    <Label htmlFor="connection-allow-invalid">Allow invalid certificates</Label>
                    <p className="text-2xs text-muted-foreground">
                      Accepts self-signed or expired certificates. Only use this on a trusted
                      network.
                    </p>
                  </div>
                  <Controller
                    control={form.control}
                    name="tlsAllowInvalid"
                    render={({ field }) => (
                      <Switch
                        id="connection-allow-invalid"
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
                <Label htmlFor="connection-favorite">Pin to favorites</Label>
                <p className="text-2xs text-muted-foreground">
                  Favorites stay at the top of the sidebar.
                </p>
              </div>
              <Controller
                control={form.control}
                name="favorite"
                render={({ field }) => (
                  <Switch
                    id="connection-favorite"
                    checked={field.value}
                    onCheckedChange={field.onChange}
                  />
                )}
              />
            </div>
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
              variant="ghost"
              className="mr-auto"
              disabled={saving || testing}
              onClick={() => void runTest()}
            >
              <PlugZapIcon />
              {testing ? "Testing…" : "Test connection"}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={saving || testing}
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={saving || testing}>
              {showSaving ? "Saving…" : connection ? "Save changes" : "Save connection"}
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
