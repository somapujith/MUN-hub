import type { PaymentStatus, RegistrationStatus } from "@/lib/db/schema-enums";

/**
 * Registration + payment status display metadata.
 *
 * Deliberately NOT reusing `lib/mun-status.ts` — that maps the 15-state MUN
 * lifecycle enum, which is a different enum with different semantics (a MUN is
 * "Published"; a registration is "Confirmed"). Sharing the module would force
 * one union to absorb the other's states. Same 3-channel encoding convention
 * though (colour + icon + label), and the same Badge tone tokens, so the two
 * chips read as siblings.
 *
 * Lives under `components/` rather than `lib/` because `lib/**` is frozen
 * contract surface owned by the backend session.
 */

export type StatusTone =
  | "muted"
  | "info"
  | "warning"
  | "destructive"
  | "success"
  | "secondary";

export type RegistrationStatusIcon =
  | "hourglass"
  | "credit-card"
  | "check"
  | "x-circle"
  | "rotate-ccw"
  | "user-check"
  | "user-x";

interface RegistrationStatusMeta {
  label: string;
  tone: StatusTone;
  icon: RegistrationStatusIcon;
  /** One-line plain-language explanation of what the delegate should expect. */
  hint: string;
}

const REGISTRATION_STATUS_META: Record<RegistrationStatus, RegistrationStatusMeta> = {
  PENDING: {
    label: "Pending",
    tone: "info",
    icon: "hourglass",
    hint: "Your seat is reserved while you complete registration.",
  },
  PAYMENT_PENDING: {
    label: "Payment pending",
    tone: "warning",
    icon: "credit-card",
    hint: "Complete payment to lock in your seat.",
  },
  CONFIRMED: {
    label: "Confirmed",
    tone: "success",
    icon: "check",
    hint: "You're in. Details will arrive from the organizer.",
  },
  CANCELLED: {
    label: "Cancelled",
    tone: "destructive",
    icon: "x-circle",
    hint: "This registration was cancelled and the seat released.",
  },
  REFUNDED: {
    label: "Refunded",
    tone: "muted",
    icon: "rotate-ccw",
    hint: "Your payment was returned.",
  },
  ATTENDED: {
    label: "Attended",
    tone: "secondary",
    icon: "user-check",
    hint: "Marked present by the organizer.",
  },
  NO_SHOW: {
    label: "No show",
    tone: "muted",
    icon: "user-x",
    hint: "The organizer did not record your attendance.",
  },
};

export function getRegistrationStatusMeta(
  status: RegistrationStatus,
): RegistrationStatusMeta {
  return REGISTRATION_STATUS_META[status];
}

/**
 * Tone classnames mirror `lib/mun-status.ts` exactly: a 15% tint field plus the
 * dedicated `--{tone}-text` token. Do NOT swap in `-foreground` tokens — those
 * are tuned for solid fills, and fail contrast on a 15% tint.
 */
const TONE_CLASSNAMES: Record<StatusTone, string> = {
  muted: "bg-muted text-muted-foreground border-transparent",
  info: "bg-info/15 text-info-text border-info/30",
  warning: "bg-warning/15 text-warning-text border-warning/30",
  destructive: "bg-destructive/15 text-destructive-text border-destructive/30",
  success: "bg-success/15 text-success-text border-success/30",
  secondary: "bg-surface-strong text-ink border-transparent",
};

export function getToneClassName(tone: StatusTone): string {
  return TONE_CLASSNAMES[tone];
}

interface PaymentStatusMeta {
  label: string;
  tone: StatusTone;
}

const PAYMENT_STATUS_META: Record<PaymentStatus, PaymentStatusMeta> = {
  CREATED: { label: "Order created", tone: "info" },
  PENDING: { label: "Payment processing", tone: "warning" },
  PAID: { label: "Paid", tone: "success" },
  FAILED: { label: "Payment failed", tone: "destructive" },
  REFUNDED: { label: "Refunded", tone: "muted" },
};

export function getPaymentStatusMeta(status: PaymentStatus): PaymentStatusMeta {
  return PAYMENT_STATUS_META[status];
}
