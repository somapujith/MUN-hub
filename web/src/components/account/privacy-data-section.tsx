import { useState } from "react";
import type { FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { DownloadIcon } from "lucide-react";
import { Link, useNavigate } from "react-router";
import { toast } from "sonner";
import { deleteAccount, downloadAccountData } from "@/api/account";
import { signOut } from "@/api/auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
import { useSession } from "@/hooks/use-session";
import { mailto, SITE_INFO } from "@/lib/site-info";

/** Must match lib/actions/account-deletion.ts's ACCOUNT_DELETION_CONFIRMATION. */
const CONFIRMATION_WORD = "DELETE";

const EMPTY_DELETE_FORM = { confirmation: "", password: "" };

function saveFile(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  // Revoked on the next tick: some browsers start the download asynchronously.
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

/**
 * "Privacy & data" block at the bottom of /profile: download a copy of your
 * data, and the delete-account danger zone. Self-contained (own queries and
 * mutations) so the profile page only has to render it.
 */
export function PrivacyDataSection() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { data: session } = useSession();
  // Only a known non-delegate session swaps the form for guidance, so the
  // brief signed-out moment after a deletion doesn't flash the wrong copy.
  const canSelfDelete = !session || session.role === "STUDENT";

  const downloadMutation = useMutation({
    mutationFn: downloadAccountData,
    onSuccess: ({ blob, filename }) => {
      saveFile(blob, filename);
      toast.success("Your data is downloading");
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Unable to download your data"),
  });

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteForm, setDeleteForm] = useState(EMPTY_DELETE_FORM);
  const deleteMutation = useMutation({
    mutationFn: () =>
      deleteAccount({ confirmation: deleteForm.confirmation.trim(), password: deleteForm.password }),
    onSuccess: async () => {
      // The server already revoked every session and cleared the cookie; this
      // sign-out is a harmless second attempt at clearing it.
      await signOut().catch(() => undefined);
      setDeleteOpen(false);
      toast.success("Your account has been deleted");
      // Leave the signed-in-only page before dropping the cached session, so
      // RequireAuth doesn't bounce to the sign-in page on the way out.
      await Promise.resolve(navigate("/", { replace: true }));
      queryClient.clear();
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Unable to delete your account"),
  });

  const confirmationMatches = deleteForm.confirmation.trim() === CONFIRMATION_WORD;

  function handleDeleteSubmit(event: FormEvent) {
    event.preventDefault();
    if (!confirmationMatches || !deleteForm.password) return;
    deleteMutation.mutate();
  }

  return (
    <section className="flex max-w-lg flex-col gap-lg" aria-labelledby="privacy-data-heading">
      <header className="flex flex-col gap-xxs">
        <h2 id="privacy-data-heading" className="font-display text-title-lg text-ink">
          Privacy &amp; data
        </h2>
        <p className="text-body-md text-muted-foreground">
          Get a copy of what we hold about you, or close your account. See our{" "}
          <Link to="/legal/privacy" className="text-link underline underline-offset-2">
            Privacy Policy
          </Link>{" "}
          for how we use your data.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Download your data</CardTitle>
          <CardDescription>
            A JSON file with your account and profile details, consents, registrations, payments,
            awards and support conversations. For organizers it also includes your organizer
            profile and the applications you have submitted.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            variant="outline"
            size="sm"
            disabled={downloadMutation.isPending}
            onClick={() => downloadMutation.mutate()}
          >
            <DownloadIcon aria-hidden />
            {downloadMutation.isPending ? "Preparing..." : "Download my data"}
          </Button>
        </CardContent>
      </Card>

      <Card className="border-destructive/40">
        <CardHeader>
          <CardTitle>Delete your account</CardTitle>
          {canSelfDelete && <CardDescription>This can&apos;t be undone.</CardDescription>}
        </CardHeader>
        <CardContent className="flex flex-col gap-md">
          {canSelfDelete ? (
            <>
              <ul className="flex list-disc flex-col gap-xxs pl-lg text-body-md text-body marker:text-muted-foreground">
                <li>Your name, contact details and profile are erased, and you are signed out everywhere.</li>
                <li>
                  Registration and payment records are kept without your name, as the law requires. Payments
                  are not refunded.
                </li>
                <li>Seats you haven&apos;t paid for yet are released.</li>
                <li>
                  For confirmed seats at conferences that haven&apos;t ended, the organizer keeps your
                  registration answers until the conference is over.
                </li>
              </ul>
              <p className="text-body-md text-muted-foreground">
                Download your data first if you want a copy.
              </p>
              <Button
                variant="destructive"
                size="sm"
                className="self-start"
                onClick={() => {
                  setDeleteForm(EMPTY_DELETE_FORM);
                  setDeleteOpen(true);
                }}
              >
                Delete my account
              </Button>
            </>
          ) : (
            <p className="text-body-md text-body">
              Organizer and staff accounts can&apos;t be deleted from here, because conferences, payouts or
              review history depend on them. Email{" "}
              <a
                href={mailto(SITE_INFO.emails.support)}
                className="text-link underline underline-offset-2"
              >
                {SITE_INFO.emails.support}
              </a>{" "}
              and we&apos;ll help you close it.
            </p>
          )}
        </CardContent>
      </Card>

      <Dialog
        open={deleteOpen}
        onOpenChange={(open) => {
          if (!deleteMutation.isPending) setDeleteOpen(open);
        }}
      >
        <DialogContent>
          <form onSubmit={handleDeleteSubmit} className="flex flex-col gap-lg">
            <DialogHeader>
              <DialogTitle>Delete your account?</DialogTitle>
              <DialogDescription>
                You&apos;ll be signed out and won&apos;t be able to sign in again. This can&apos;t be undone.
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-xs">
              <Label htmlFor="delete-account-confirmation">
                Type <span className="font-mono font-semibold">{CONFIRMATION_WORD}</span> to confirm
              </Label>
              <Input
                id="delete-account-confirmation"
                value={deleteForm.confirmation}
                onChange={(event) => setDeleteForm({ ...deleteForm, confirmation: event.target.value })}
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                required
                autoFocus
              />
            </div>
            <div className="flex flex-col gap-xs">
              <Label htmlFor="delete-account-password">Password</Label>
              <Input
                id="delete-account-password"
                type="password"
                autoComplete="current-password"
                value={deleteForm.password}
                onChange={(event) => setDeleteForm({ ...deleteForm, password: event.target.value })}
                required
              />
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={deleteMutation.isPending}
                onClick={() => setDeleteOpen(false)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                variant="destructive"
                size="sm"
                disabled={deleteMutation.isPending || !confirmationMatches || !deleteForm.password}
              >
                {deleteMutation.isPending ? "Deleting..." : "Delete my account"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  );
}
