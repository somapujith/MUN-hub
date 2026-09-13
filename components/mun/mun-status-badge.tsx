import {
  PencilIcon,
  ArchiveIcon,
  UploadIcon,
  EyeIcon,
  FileCheckIcon,
  ShieldCheckIcon,
  ShieldIcon,
  RocketIcon,
  TriangleAlertIcon,
  XCircleIcon,
  CheckIcon,
  GlobeIcon,
  TicketIcon,
  LockIcon,
  RadioIcon,
  FlagIcon,
  HourglassIcon,
  ClipboardCheckIcon,
  BanIcon,
  type LucideIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "cn";
import { getStatusClassName, getStatusMeta, type MunStatus, type StatusIcon } from "@/lib/mun-status";

// New keys (shield/hourglass/clipboard-check/ban) added mechanically to
// unblock tsc after MunStatus gained 5 new values for the verification/
// confirmation trust layer — see lib/mun-status.ts's STATUS_META for the
// matching TODO. Icon choices are reasonable defaults, not a design pass.
const ICONS: Record<StatusIcon, LucideIcon> = {
  pencil: PencilIcon,
  archive: ArchiveIcon,
  upload: UploadIcon,
  eye: EyeIcon,
  "file-check": FileCheckIcon,
  "shield-check": ShieldCheckIcon,
  shield: ShieldIcon,
  rocket: RocketIcon,
  "alert-triangle": TriangleAlertIcon,
  "x-circle": XCircleIcon,
  check: CheckIcon,
  globe: GlobeIcon,
  ticket: TicketIcon,
  lock: LockIcon,
  radio: RadioIcon,
  flag: FlagIcon,
  hourglass: HourglassIcon,
  "clipboard-check": ClipboardCheckIcon,
  ban: BanIcon,
};

interface MunStatusBadgeProps {
  status: MunStatus;
  className?: string;
}

export function MunStatusBadge({ status, className }: MunStatusBadgeProps) {
  const { label, tone, icon } = getStatusMeta(status);
  const Icon = ICONS[icon];

  return (
    <Badge variant="outline" className={cn(getStatusClassName(tone), className)}>
      <Icon className="size-3" strokeWidth={1.75} />
      {label}
    </Badge>
  );
}
