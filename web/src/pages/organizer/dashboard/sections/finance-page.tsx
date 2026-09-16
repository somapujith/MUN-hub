import { useEffect, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Helmet } from "react-helmet-async";
import { CircleCheck, CircleDashed, ShieldAlert, TriangleAlert } from "lucide-react";
import { useParams } from "react-router";
import { toast } from "sonner";
import { getPaymentSettings, upsertPaymentSettings } from "@/api/payment-settlement";
import { queryKeys } from "@/api/query-keys";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { WorkspacePage } from "@/components/organizer/workspace-page";
import type { MaskedPaymentSettings, PaymentVerificationState } from "@/types/payment-settlement";

const ORG_TYPE_OPTIONS = [
  "Individual",
  "Proprietorship",
  "Partnership",
  "Trust",
  "Society",
  "Section 8 Company",
  "Private Limited Company",
  "Educational Institution",
  "Other",
];

const ACCOUNT_TYPE_OPTIONS = ["Savings", "Current"];

const VERIFICATION_META: Record<
  PaymentVerificationState,
  { label: string; variant: "secondary" | "warning" | "success" | "destructive"; icon: typeof CircleDashed }
> = {
  NOT_SUBMITTED: { label: "Not submitted", variant: "secondary", icon: CircleDashed },
  PENDING: { label: "Pending review", variant: "warning", icon: TriangleAlert },
  VERIFIED: { label: "Verified", variant: "success", icon: CircleCheck },
  FAILED: { label: "Verification failed", variant: "destructive", icon: ShieldAlert },
};

interface PaymentFormState {
  legalName: string;
  orgType: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  state: string;
  postalCode: string;
  pan: string;
  gstin: string;
  authorizedRepName: string;
  authorizedRepEmail: string;
  accountHolderName: string;
  bankName: string;
  accountNumber: string;
  ifsc: string;
  accountType: string;
  gateway: string;
  currency: string;
  refundPolicy: string;
  settlementNotes: string;
}

const EMPTY_FORM: PaymentFormState = {
  legalName: "",
  orgType: ORG_TYPE_OPTIONS[0],
  addressLine1: "",
  addressLine2: "",
  city: "",
  state: "",
  postalCode: "",
  pan: "",
  gstin: "",
  authorizedRepName: "",
  authorizedRepEmail: "",
  accountHolderName: "",
  bankName: "",
  accountNumber: "",
  ifsc: "",
  accountType: ACCOUNT_TYPE_OPTIONS[0],
  gateway: "Razorpay",
  currency: "INR",
  refundPolicy: "",
  settlementNotes: "",
};

// PAN/account number are write-only server-side (never echoed back), so an
// existing settings row always hydrates those two fields blank — the
// organizer must re-enter the full value to change (or reconfirm) them.
function toForm(settings: MaskedPaymentSettings): PaymentFormState {
  return {
    legalName: settings.legalName,
    orgType: settings.orgType,
    addressLine1: settings.addressLine1,
    addressLine2: settings.addressLine2 ?? "",
    city: settings.city,
    state: settings.state,
    postalCode: settings.postalCode,
    pan: "",
    gstin: settings.gstin ?? "",
    authorizedRepName: settings.authorizedRepName,
    authorizedRepEmail: settings.authorizedRepEmail,
    accountHolderName: settings.accountHolderName,
    bankName: settings.bankName,
    accountNumber: "",
    ifsc: settings.ifsc,
    accountType: settings.accountType,
    gateway: settings.gateway,
    currency: settings.currency,
    refundPolicy: settings.refundPolicy ?? "",
    settlementNotes: settings.settlementNotes ?? "",
  };
}

const REQUIRED_FIELDS: Array<[keyof PaymentFormState, string]> = [
  ["legalName", "Legal name"],
  ["orgType", "Organization type"],
  ["addressLine1", "Address"],
  ["city", "City"],
  ["state", "State"],
  ["postalCode", "Postal code"],
  ["pan", "PAN"],
  ["authorizedRepName", "Authorized representative name"],
  ["authorizedRepEmail", "Authorized representative email"],
  ["accountHolderName", "Account holder name"],
  ["bankName", "Bank name"],
  ["accountNumber", "Account number"],
  ["ifsc", "IFSC"],
  ["accountType", "Account type"],
  ["gateway", "Gateway"],
];

export function OrganizerFinancePage() {
  const { munId = "" } = useParams();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<PaymentFormState>(EMPTY_FORM);

  const settingsQuery = useQuery({
    queryKey: queryKeys.paymentSettings(munId),
    queryFn: () => getPaymentSettings(munId),
    enabled: Boolean(munId),
  });

  // Hydrate the form once per distinct settings row — not on every
  // background refetch, so an organizer mid-edit never loses their draft.
  useEffect(() => {
    if (settingsQuery.data) setForm(toForm(settingsQuery.data));
  }, [settingsQuery.data?.id]);

  const saveMutation = useMutation({
    mutationFn: () =>
      upsertPaymentSettings(munId, {
        legalName: form.legalName.trim(),
        orgType: form.orgType.trim(),
        addressLine1: form.addressLine1.trim(),
        addressLine2: form.addressLine2.trim() || null,
        city: form.city.trim(),
        state: form.state.trim(),
        postalCode: form.postalCode.trim(),
        pan: form.pan.trim(),
        gstin: form.gstin.trim() || null,
        authorizedRepName: form.authorizedRepName.trim(),
        authorizedRepEmail: form.authorizedRepEmail.trim(),
        accountHolderName: form.accountHolderName.trim(),
        bankName: form.bankName.trim(),
        accountNumber: form.accountNumber.trim(),
        ifsc: form.ifsc.trim(),
        accountType: form.accountType.trim(),
        gateway: form.gateway.trim(),
        currency: form.currency.trim() || undefined,
        refundPolicy: form.refundPolicy.trim() || null,
        settlementNotes: form.settlementNotes.trim() || null,
      }),
    onSuccess: (settings) => {
      queryClient.setQueryData(queryKeys.paymentSettings(munId), settings);
      setForm(toForm(settings));
      toast.success("Settlement settings saved");
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Unable to save settlement settings"),
  });

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    const missing = REQUIRED_FIELDS.find(([key]) => !form[key].trim());
    if (missing) {
      toast.error(`${missing[1]} is required`);
      return;
    }
    saveMutation.mutate();
  };

  const settings = settingsQuery.data ?? null;
  const verification = VERIFICATION_META[settings?.verificationState ?? "NOT_SUBMITTED"];
  const VerificationIcon = verification.icon;

  return (
    <>
      <Helmet title="Payments & Finance" />
      <WorkspacePage
        title="Payments & Finance"
        description="Payments collected, platform fees, and settlement settings."
      >
        <div className="flex flex-col gap-lg">
          {settingsQuery.isLoading && (
            <p className="text-body-md text-muted-foreground">Loading settlement settings...</p>
          )}
          {settingsQuery.isError && (
            <p className="text-body-md text-destructive">{settingsQuery.error.message}</p>
          )}

          {settings && (
            <Card size="sm">
              <CardContent className="flex flex-wrap items-center gap-md">
                <div className="flex size-11 shrink-0 items-center justify-center rounded-sm bg-surface-soft text-muted-foreground">
                  <VerificationIcon aria-hidden />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-sm gap-y-xxs">
                    <h2 className="font-display text-title-sm text-ink">{settings.bankName}</h2>
                    <Badge variant={verification.variant}>{verification.label}</Badge>
                  </div>
                  <p className="mt-xxs text-body-md text-muted-foreground">
                    Account ending {settings.accountNumberLast4} · PAN ending {settings.panLast4} ·{" "}
                    {settings.gateway}
                    {settings.verifiedAt
                      ? ` · Verified ${new Date(settings.verifiedAt).toLocaleDateString()}`
                      : ""}
                  </p>
                </div>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle>{settings ? "Update settlement settings" : "Set up settlement settings"}</CardTitle>
            </CardHeader>
            <CardContent>
              <form className="flex flex-col gap-lg" onSubmit={handleSubmit}>
                <fieldset className="flex flex-col gap-md">
                  <legend className="font-display text-body-md font-medium text-ink">Organization</legend>
                  <div className="grid gap-md sm:grid-cols-2">
                    <div className="flex flex-col gap-xs">
                      <Label htmlFor="pay-legal-name">Legal name</Label>
                      <Input
                        id="pay-legal-name"
                        value={form.legalName}
                        onChange={(event) => setForm({ ...form, legalName: event.target.value })}
                        required
                      />
                    </div>
                    <div className="flex flex-col gap-xs">
                      <Label htmlFor="pay-org-type">Organization type</Label>
                      <select
                        id="pay-org-type"
                        className="h-11 rounded-sm border border-input bg-background px-md text-body-md text-ink"
                        value={form.orgType}
                        onChange={(event) => setForm({ ...form, orgType: event.target.value })}
                      >
                        {ORG_TYPE_OPTIONS.map((option) => (
                          <option key={option} value={option}>
                            {option}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="flex flex-col gap-xs sm:col-span-2">
                      <Label htmlFor="pay-address-1">Address line 1</Label>
                      <Input
                        id="pay-address-1"
                        value={form.addressLine1}
                        onChange={(event) => setForm({ ...form, addressLine1: event.target.value })}
                        required
                      />
                    </div>
                    <div className="flex flex-col gap-xs sm:col-span-2">
                      <Label htmlFor="pay-address-2">Address line 2</Label>
                      <Input
                        id="pay-address-2"
                        value={form.addressLine2}
                        onChange={(event) => setForm({ ...form, addressLine2: event.target.value })}
                      />
                    </div>
                    <div className="flex flex-col gap-xs">
                      <Label htmlFor="pay-city">City</Label>
                      <Input
                        id="pay-city"
                        value={form.city}
                        onChange={(event) => setForm({ ...form, city: event.target.value })}
                        required
                      />
                    </div>
                    <div className="flex flex-col gap-xs">
                      <Label htmlFor="pay-state">State</Label>
                      <Input
                        id="pay-state"
                        value={form.state}
                        onChange={(event) => setForm({ ...form, state: event.target.value })}
                        required
                      />
                    </div>
                    <div className="flex flex-col gap-xs">
                      <Label htmlFor="pay-postal-code">Postal code</Label>
                      <Input
                        id="pay-postal-code"
                        value={form.postalCode}
                        onChange={(event) => setForm({ ...form, postalCode: event.target.value })}
                        required
                      />
                    </div>
                    <div className="flex flex-col gap-xs">
                      <Label htmlFor="pay-gstin">GSTIN (optional)</Label>
                      <Input
                        id="pay-gstin"
                        value={form.gstin}
                        onChange={(event) => setForm({ ...form, gstin: event.target.value })}
                      />
                    </div>
                  </div>
                </fieldset>

                <fieldset className="flex flex-col gap-md">
                  <legend className="font-display text-body-md font-medium text-ink">
                    Authorized representative
                  </legend>
                  <div className="grid gap-md sm:grid-cols-2">
                    <div className="flex flex-col gap-xs">
                      <Label htmlFor="pay-rep-name">Full name</Label>
                      <Input
                        id="pay-rep-name"
                        value={form.authorizedRepName}
                        onChange={(event) => setForm({ ...form, authorizedRepName: event.target.value })}
                        required
                      />
                    </div>
                    <div className="flex flex-col gap-xs">
                      <Label htmlFor="pay-rep-email">Email</Label>
                      <Input
                        id="pay-rep-email"
                        type="email"
                        value={form.authorizedRepEmail}
                        onChange={(event) => setForm({ ...form, authorizedRepEmail: event.target.value })}
                        required
                      />
                    </div>
                  </div>
                </fieldset>

                <fieldset className="flex flex-col gap-md">
                  <legend className="font-display text-body-md font-medium text-ink">Bank account</legend>
                  <p className="text-body-md text-muted-foreground">
                    For security, saved PAN and account numbers are never shown here — re-enter the full
                    value every time you add or change them.
                    {settings && (
                      <>
                        {" "}
                        Currently on file: PAN ending {settings.panLast4}, account ending{" "}
                        {settings.accountNumberLast4}.
                      </>
                    )}
                  </p>
                  <div className="grid gap-md sm:grid-cols-2">
                    <div className="flex flex-col gap-xs">
                      <Label htmlFor="pay-pan">PAN</Label>
                      <Input
                        id="pay-pan"
                        value={form.pan}
                        onChange={(event) => setForm({ ...form, pan: event.target.value.toUpperCase() })}
                        placeholder={settings ? `Ending in ${settings.panLast4}` : undefined}
                        required
                      />
                    </div>
                    <div className="flex flex-col gap-xs">
                      <Label htmlFor="pay-account-holder">Account holder name</Label>
                      <Input
                        id="pay-account-holder"
                        value={form.accountHolderName}
                        onChange={(event) => setForm({ ...form, accountHolderName: event.target.value })}
                        required
                      />
                    </div>
                    <div className="flex flex-col gap-xs">
                      <Label htmlFor="pay-bank-name">Bank name</Label>
                      <Input
                        id="pay-bank-name"
                        value={form.bankName}
                        onChange={(event) => setForm({ ...form, bankName: event.target.value })}
                        required
                      />
                    </div>
                    <div className="flex flex-col gap-xs">
                      <Label htmlFor="pay-account-number">Account number</Label>
                      <Input
                        id="pay-account-number"
                        value={form.accountNumber}
                        onChange={(event) => setForm({ ...form, accountNumber: event.target.value })}
                        placeholder={settings ? `Ending in ${settings.accountNumberLast4}` : undefined}
                        required
                      />
                    </div>
                    <div className="flex flex-col gap-xs">
                      <Label htmlFor="pay-ifsc">IFSC</Label>
                      <Input
                        id="pay-ifsc"
                        value={form.ifsc}
                        onChange={(event) => setForm({ ...form, ifsc: event.target.value.toUpperCase() })}
                        required
                      />
                    </div>
                    <div className="flex flex-col gap-xs">
                      <Label htmlFor="pay-account-type">Account type</Label>
                      <select
                        id="pay-account-type"
                        className="h-11 rounded-sm border border-input bg-background px-md text-body-md text-ink"
                        value={form.accountType}
                        onChange={(event) => setForm({ ...form, accountType: event.target.value })}
                      >
                        {ACCOUNT_TYPE_OPTIONS.map((option) => (
                          <option key={option} value={option}>
                            {option}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                </fieldset>

                <fieldset className="flex flex-col gap-md">
                  <legend className="font-display text-body-md font-medium text-ink">
                    Gateway &amp; policies
                  </legend>
                  <div className="grid gap-md sm:grid-cols-2">
                    <div className="flex flex-col gap-xs">
                      <Label htmlFor="pay-gateway">Payment gateway</Label>
                      <Input
                        id="pay-gateway"
                        value={form.gateway}
                        onChange={(event) => setForm({ ...form, gateway: event.target.value })}
                        required
                      />
                    </div>
                    <div className="flex flex-col gap-xs">
                      <Label htmlFor="pay-currency">Currency</Label>
                      <Input
                        id="pay-currency"
                        value={form.currency}
                        onChange={(event) => setForm({ ...form, currency: event.target.value })}
                      />
                    </div>
                    <div className="flex flex-col gap-xs sm:col-span-2">
                      <Label htmlFor="pay-refund-policy">Refund policy (optional)</Label>
                      <textarea
                        id="pay-refund-policy"
                        className="min-h-24 rounded-sm border border-input bg-background px-md py-sm text-body-md text-ink outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/25"
                        value={form.refundPolicy}
                        onChange={(event) => setForm({ ...form, refundPolicy: event.target.value })}
                      />
                    </div>
                    <div className="flex flex-col gap-xs sm:col-span-2">
                      <Label htmlFor="pay-settlement-notes">Settlement notes (optional)</Label>
                      <textarea
                        id="pay-settlement-notes"
                        className="min-h-24 rounded-sm border border-input bg-background px-md py-sm text-body-md text-ink outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/25"
                        value={form.settlementNotes}
                        onChange={(event) => setForm({ ...form, settlementNotes: event.target.value })}
                      />
                    </div>
                  </div>
                </fieldset>

                <div className="flex justify-end">
                  <Button type="submit" size="sm" disabled={saveMutation.isPending}>
                    {saveMutation.isPending ? "Saving..." : "Save settlement settings"}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>
      </WorkspacePage>
    </>
  );
}
