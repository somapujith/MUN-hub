import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CopyIcon, DownloadIcon, ShieldCheckIcon, ShieldOffIcon } from "lucide-react";
import { toast } from "sonner";
import {
  beginMfaSetup,
  confirmMfaSetup,
  disableMfa,
  getMfaStatus,
  regenerateMfaRecoveryCodes,
} from "@/api/staff-mfa";
import { AdminPageFrame } from "@/components/admin/admin-page-frame";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { adminQueryKeys } from "@/lib/admin/query-keys";
import type { MfaSetupResult } from "@/types/staff-mfa";

const UNAVAILABLE_MESSAGE = "Two-factor authentication isn't available yet";

async function copyText(text: string, label: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(`${label} copied`);
  } catch {
    toast.error(`Couldn't copy — select the ${label.toLowerCase()} and copy it manually`);
  }
}

function downloadRecoveryCodes(codes: string[]) {
  const blob = new Blob([`MUN Hub — two-factor recovery codes\n\n${codes.join("\n")}\n`], {
    type: "text/plain",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "mun-hub-recovery-codes.txt";
  link.click();
  URL.revokeObjectURL(url);
}

/**
 * Staff two-factor authentication (lib/actions/staff-mfa.ts). Every staff
 * role can manage their own — there's no admin-facing "enable for someone
 * else"; a SUPER_ADMIN can only reset (clear) another account's enrollment
 * from the Staff page after a lost device.
 */
export function AdminSecurityPage() {
  const queryClient = useQueryClient();
  const [setup, setSetup] = useState<MfaSetupResult | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [regenerateOpen, setRegenerateOpen] = useState(false);
  const [disableOpen, setDisableOpen] = useState(false);

  const statusQuery = useQuery({ queryKey: adminQueryKeys.mfaStatus(), queryFn: getMfaStatus });
  const refreshStatus = () => queryClient.invalidateQueries({ queryKey: adminQueryKeys.mfaStatus() });

  const setupMutation = useMutation({
    mutationFn: beginMfaSetup,
    onSuccess: (result) => {
      setUnavailable(false);
      setSetup(result);
    },
    onError: (error) => {
      if (error instanceof Error && error.message === UNAVAILABLE_MESSAGE) {
        setUnavailable(true);
        return;
      }
      toast.error(error instanceof Error ? error.message : "Unable to start setup");
    },
  });

  const confirmMutation = useMutation({
    mutationFn: confirmMfaSetup,
    onSuccess: async (result) => {
      setSetup(null);
      setRecoveryCodes(result.recoveryCodes);
      await refreshStatus();
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "That code didn't work"),
  });

  const regenerateMutation = useMutation({
    mutationFn: regenerateMfaRecoveryCodes,
    onSuccess: (result) => {
      setRegenerateOpen(false);
      setRecoveryCodes(result.recoveryCodes);
      toast.success("New recovery codes generated — your old codes no longer work");
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "That code didn't work"),
  });

  const disableMutation = useMutation({
    mutationFn: disableMfa,
    onSuccess: async () => {
      setDisableOpen(false);
      await refreshStatus();
      toast.success("Two-factor authentication is off");
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "That code didn't work"),
  });

  return (
    <AdminPageFrame title="Security" description="Two-factor authentication for your own account.">
      {statusQuery.isLoading ? (
        <Skeleton className="h-32 w-full max-w-xl" />
      ) : statusQuery.isError ? (
        <p className="text-body-md text-destructive">
          {statusQuery.error instanceof Error ? statusQuery.error.message : "Unable to load your 2FA status."}
        </p>
      ) : (
        <div className="flex max-w-xl flex-col gap-lg">
          <div className="flex flex-col gap-sm rounded-md border border-border bg-card p-lg">
            <div className="flex items-center gap-sm">
              {statusQuery.data?.confirmed ? (
                <Badge variant="success">
                  <ShieldCheckIcon aria-hidden /> On
                </Badge>
              ) : (
                <Badge variant="secondary">
                  <ShieldOffIcon aria-hidden /> Off
                </Badge>
              )}
              <p className="font-medium text-ink">Two-factor authentication</p>
            </div>
            <p className="text-body-md text-muted-foreground">
              {statusQuery.data?.confirmed
                ? "Signing in asks for a code from your authenticator app after your password."
                : "Add a second step to sign-in using an authenticator app (Google Authenticator, Authy, 1Password, ...)."}
            </p>

            {statusQuery.data?.confirmed ? (
              <div className="mt-sm flex flex-wrap gap-sm">
                <Button size="sm" variant="outline" onClick={() => setRegenerateOpen(true)}>
                  Regenerate recovery codes
                </Button>
                <Button size="sm" variant="destructive" onClick={() => setDisableOpen(true)}>
                  Turn off
                </Button>
              </div>
            ) : setup ? null : (
              <div className="mt-sm">
                <Button size="sm" disabled={setupMutation.isPending} onClick={() => setupMutation.mutate()}>
                  {setupMutation.isPending ? "Starting…" : "Set up two-factor authentication"}
                </Button>
                {unavailable && (
                  <p className="mt-sm text-body-md text-muted-foreground">{UNAVAILABLE_MESSAGE}. Try again later.</p>
                )}
              </div>
            )}
          </div>

          {setup && <SetupPanel setup={setup} confirmMutation={confirmMutation} onCancel={() => setSetup(null)} />}
        </div>
      )}

      <CodeDialog
        open={regenerateOpen}
        title="Regenerate recovery codes"
        description="Enter a current code from your authenticator app. Your existing recovery codes stop working immediately."
        confirmLabel="Regenerate"
        pendingLabel="Regenerating…"
        codeInputMode="numeric"
        isPending={regenerateMutation.isPending}
        onConfirm={(code) => regenerateMutation.mutate(code)}
        onClose={() => setRegenerateOpen(false)}
      />

      <CodeDialog
        open={disableOpen}
        title="Turn off two-factor authentication"
        description="Enter a code from your authenticator app or one of your recovery codes to confirm."
        confirmLabel="Turn off"
        pendingLabel="Turning off…"
        destructive
        isPending={disableMutation.isPending}
        onConfirm={(code) => disableMutation.mutate(code)}
        onClose={() => setDisableOpen(false)}
      />

      <RecoveryCodesDialog codes={recoveryCodes} onClose={() => setRecoveryCodes(null)} />
    </AdminPageFrame>
  );
}

function SetupPanel({
  setup,
  confirmMutation,
  onCancel,
}: {
  setup: MfaSetupResult;
  confirmMutation: ReturnType<typeof useMutation<{ recoveryCodes: string[] }, Error, string>>;
  onCancel: () => void;
}) {
  const [code, setCode] = useState("");

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    confirmMutation.mutate(code.trim());
  };

  return (
    <div className="flex flex-col gap-md rounded-md border border-border bg-card p-lg">
      <div className="flex flex-col gap-xs">
        <p className="font-medium text-ink">1. Scan or enter this key</p>
        <p className="text-body-md text-muted-foreground">
          In your authenticator app, add an account using this setup key (there's no QR code in this
          console yet — the manual key works the same way).
        </p>
      </div>
      <div className="flex flex-col gap-xs">
        <Label htmlFor="mfa-secret">Setup key</Label>
        <div className="flex gap-xs">
          <Input id="mfa-secret" readOnly value={setup.secret} className="font-mono" onFocus={(e) => e.currentTarget.select()} />
          <Button type="button" variant="outline" size="icon-sm" aria-label="Copy setup key" onClick={() => copyText(setup.secret, "Setup key")}>
            <CopyIcon aria-hidden />
          </Button>
        </div>
        <a
          href={setup.otpauthUri}
          className="text-body-md text-link underline-offset-2 hover:underline"
        >
          Open in authenticator app
        </a>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-xs">
        <Label htmlFor="mfa-confirm-code">2. Enter the 6-digit code it shows</Label>
        <div className="flex gap-xs">
          <Input
            id="mfa-confirm-code"
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="123456"
            className="font-mono tracking-[0.3em]"
            value={code}
            onChange={(event) => setCode(event.target.value)}
            required
          />
          <Button type="submit" disabled={confirmMutation.isPending}>
            {confirmMutation.isPending ? "Confirming…" : "Confirm"}
          </Button>
        </div>
      </form>
      <Button type="button" variant="outline" size="sm" className="self-start" onClick={onCancel}>
        Cancel
      </Button>
    </div>
  );
}

function CodeDialog({
  open,
  title,
  description,
  confirmLabel,
  pendingLabel,
  destructive,
  codeInputMode = "text",
  isPending,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  pendingLabel: string;
  destructive?: boolean;
  codeInputMode?: "text" | "numeric";
  isPending: boolean;
  onConfirm: (code: string) => void;
  onClose: () => void;
}) {
  const [code, setCode] = useState("");

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onConfirm(code.trim());
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setCode("");
          onClose();
        }
      }}
    >
      <DialogContent className="sm:max-w-md">
        <form onSubmit={handleSubmit} className="flex flex-col gap-lg">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-xs">
            <Label htmlFor="dialog-code">Code</Label>
            <Input
              id="dialog-code"
              inputMode={codeInputMode}
              autoComplete="one-time-code"
              autoFocus
              required
              value={code}
              onChange={(event) => setCode(event.target.value)}
              className="font-mono"
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" variant={destructive ? "destructive" : "default"} size="sm" disabled={isPending}>
              {isPending ? pendingLabel : confirmLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Shows a freshly minted set of recovery codes exactly once. */
function RecoveryCodesDialog({ codes, onClose }: { codes: string[] | null; onClose: () => void }) {
  return (
    <Dialog
      open={codes !== null}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Your recovery codes</DialogTitle>
          <DialogDescription>
            Save these somewhere safe. Each works once, if you lose access to your authenticator app.
            They won&apos;t be shown again.
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-xs rounded-md border border-border bg-surface-soft/60 p-md font-mono text-body-md">
          {codes?.map((recoveryCode) => <span key={recoveryCode}>{recoveryCode}</span>)}
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => codes && downloadRecoveryCodes(codes)}
          >
            <DownloadIcon aria-hidden /> Download
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => codes && copyText(codes.join("\n"), "Recovery codes")}
          >
            <CopyIcon aria-hidden /> Copy all
          </Button>
          <Button type="button" size="sm" onClick={onClose}>
            I&apos;ve saved these
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
