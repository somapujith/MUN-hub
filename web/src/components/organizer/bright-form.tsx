import type { ReactNode } from "react";

// Form styling for the bright organizer pages (OrganizerBrightShell): fixed
// colors, no theme tokens, so they stay light in dark mode.

export const BRIGHT_INPUT_CLASS =
  "h-12 w-full rounded-lg border border-[#d7d7de] bg-white px-4 text-[15px] text-[#121212] outline-none transition-colors placeholder:text-[#9a9aa2] focus:border-[#121212] aria-invalid:border-[#c4320a]";

export const BRIGHT_TEXTAREA_CLASS =
  "min-h-32 w-full resize-y rounded-lg border border-[#d7d7de] bg-white px-4 py-3 text-[15px] text-[#121212] outline-none transition-colors placeholder:text-[#9a9aa2] focus:border-[#121212]";

export const BRIGHT_PRIMARY_BUTTON_CLASS =
  "inline-flex h-12 items-center justify-center rounded-lg bg-[#121212] px-6 text-[15px] font-semibold text-white transition-colors hover:bg-[#2a2a2e] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#121212] disabled:cursor-not-allowed disabled:bg-[#d4d4d8] disabled:text-[#77777e]";

export function BrightField({
  id,
  label,
  hint,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="text-[14px] text-[#5b5b63]">
        {label}
      </label>
      {children}
      {hint ? <p className="text-[13px] text-[#8a8a92]">{hint}</p> : null}
    </div>
  );
}

export const DATE_INPUT_FORMAT = /^\d{4}-\d{2}-\d{2}$/;
export const WEBSITE_FORMAT = /^https?:\/\/[^\s.]+\.\S+$/i;
