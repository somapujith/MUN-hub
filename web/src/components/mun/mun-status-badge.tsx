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
  /**
   * Delegate-facing surfaces (marketplace cards, the public MUN page) say what
   * a visitor can do, not where the MUN sits in our pipeline: a published MUN
   * whose registration hasn't opened is "Not yet open", not "Live". The
   * organizer and admin consoles keep the pipeline wording.
   */
  audience?: "internal" | "public";
}

/** Public overrides for statuses whose internal label would mislead a delegate. */
const PUBLIC_LABELS: Partial<Record<MunStatus, { label: string; icon: StatusIcon }>> = {
  PUBLISHED: { label: "Not yet open", icon: "hourglass" },
};

export function MunStatusBadge({ status, className, audience = "internal" }: MunStatusBadgeProps) {
  const meta = getStatusMeta(status);
  const override = audience === "public" ? PUBLIC_LABELS[status] : undefined;
  const { label, icon } = { label: override?.label ?? meta.label, icon: override?.icon ?? meta.icon };
  const tone = meta.tone;
  const Icon = ICONS[icon];

  return (
    <Badge variant="outline" className={cn(getStatusClassName(tone), className)}>
      <Icon className="size-3" strokeWidth={1.75} />
      {label}
    </Badge>
  );
}
