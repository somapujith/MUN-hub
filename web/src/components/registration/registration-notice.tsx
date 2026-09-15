import type * as React from "react";
import {
  CircleAlertIcon,
  CircleCheckIcon,
  InfoIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { cn } from "cn";

type NoticeTone = "neutral" | "success" | "warning" | "error";

interface RegistrationNoticeProps {
  tone: NoticeTone;
  title: string;
  message: string;
  /** Optional supplementary block (e.g. a receipt/reference panel). */
  detail?: React.ReactNode;
  /** Recovery actions — always give the user somewhere to go. */
  children?: React.ReactNode;
}

/**
 * Terminal-state panel for the registration flow (closed / sold out / payment
 * failed / confirmed).
 *
 * Tone is carried by a glyph plus a dedicated `-text` token, never by color
 * alone — and the surface stays a soft tint rather than a saturated fill so
 * body copy keeps its contrast.
 */
const toneConfig: Record<
  NoticeTone,
  { Icon: React.ComponentType<{ className?: string }>; surface: string; text: string }
> = {
  neutral: {
    Icon: InfoIcon,
    surface: "border-border bg-surface-soft",
    text: "text-ink",
  },
  success: {
    Icon: CircleCheckIcon,
    surface: "border-success/30 bg-success/8",
    text: "text-success-text",
  },
  warning: {
    Icon: TriangleAlertIcon,
    surface: "border-warning/40 bg-warning/12",
    text: "text-warning-text",
  },
  error: {
    Icon: CircleAlertIcon,
    surface: "border-destructive/30 bg-destructive/8",
    text: "text-destructive-text",
  },
};

export function RegistrationNotice({
  tone,
  title,
  message,
  detail,
  children,
}: RegistrationNoticeProps) {
  const { Icon, surface, text } = toneConfig[tone];

  return (
    <section
      className={cn("flex flex-col gap-md rounded-md border p-lg sm:p-xl", surface)}
      role={tone === "error" ? "alert" : undefined}
    >
      <div className="flex items-start gap-sm">
        <Icon className={cn("mt-0.5 size-5 shrink-0", text)} aria-hidden />
        <div className="flex flex-col gap-xs">
          <h2 className={cn("font-display text-title-lg", text)}>{title}</h2>
          <p className="max-w-prose text-body-md text-body">{message}</p>
        </div>
      </div>

      {detail}

      {children && <div className="flex flex-wrap items-center gap-sm">{children}</div>}
    </section>
  );
}
