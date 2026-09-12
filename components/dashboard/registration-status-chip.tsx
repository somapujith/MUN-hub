import {
  CheckIcon,
  CreditCardIcon,
  HourglassIcon,
  RotateCcwIcon,
  UserCheckIcon,
  UserXIcon,
  XCircleIcon,
  type LucideIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "cn";
import {
  getRegistrationStatusMeta,
  getToneClassName,
  type RegistrationStatusIcon,
} from "@/components/dashboard/registration-status";
import type { RegistrationStatus } from "@/lib/db/schema-enums";

const ICONS: Record<RegistrationStatusIcon, LucideIcon> = {
  hourglass: HourglassIcon,
  "credit-card": CreditCardIcon,
  check: CheckIcon,
  "x-circle": XCircleIcon,
  "rotate-ccw": RotateCcwIcon,
  "user-check": UserCheckIcon,
  "user-x": UserXIcon,
};

interface RegistrationStatusChipProps {
  status: RegistrationStatus;
  className?: string;
}

/**
 * 3-channel status encoding (colour + icon + label) so the chip survives both
 * colour-blindness and a greyscale print — same convention as
 * `components/mun/mun-status-badge.tsx`.
 */
export function RegistrationStatusChip({
  status,
  className,
}: RegistrationStatusChipProps) {
  const { label, tone, icon } = getRegistrationStatusMeta(status);
  const Icon = ICONS[icon];

  return (
    <Badge variant="outline" className={cn(getToneClassName(tone), className)}>
      <Icon className="size-3" strokeWidth={1.75} />
      {label}
    </Badge>
  );
}
