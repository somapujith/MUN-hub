import {
  CircleDashedIcon,
  CircleDotIcon,
  CheckIcon,
  RotateCcwIcon,
  XCircleIcon,
  type LucideIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "cn";
import {
  getPaymentStatusMeta,
  getToneClassName,
} from "@/components/dashboard/registration-status";
import type { PaymentStatus } from "@/lib/db/schema-enums";

/**
 * Sibling of `registration-status-chip.tsx` for the OTHER enum on a
 * registration row: `payments.status`.
 *
 * Label + tone come from `getPaymentStatusMeta` in
 * `components/dashboard/registration-status.ts` rather than a second copy of
 * that table — the student dashboard already owns that mapping and the two
 * surfaces must not drift on what "PENDING" is called. Only the icon channel
 * is added here, which that module deliberately doesn't carry for payments.
 *
 * Same 3-channel encoding (colour + icon + label) as every other status chip
 * in the app, and the same "no payment row at all" case is handled by the
 * caller, not by inventing a fake status.
 */

const ICONS: Record<PaymentStatus, LucideIcon> = {
  CREATED: CircleDashedIcon,
  PENDING: CircleDotIcon,
  PAID: CheckIcon,
  FAILED: XCircleIcon,
  REFUNDED: RotateCcwIcon,
};

interface PaymentStatusChipProps {
  status: PaymentStatus;
  className?: string;
}

export function PaymentStatusChip({ status, className }: PaymentStatusChipProps) {
  const { label, tone } = getPaymentStatusMeta(status);
  const Icon = ICONS[status];

  return (
    <Badge variant="outline" className={cn(getToneClassName(tone), className)}>
      <Icon className="size-3" strokeWidth={1.75} />
      {label}
    </Badge>
  );
}
