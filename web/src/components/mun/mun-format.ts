/**
 * Formatting + URL-safety helpers shared by the public MUN page sections.
 * Times render in the visitor's own timezone, like every other date on the
 * site (formatDateRange in components/shared/date-range.tsx).
 */

const dateTimeFormatter = new Intl.DateTimeFormat("en-IN", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

const dateFormatter = new Intl.DateTimeFormat("en-IN", {
  day: "numeric",
  month: "short",
  year: "numeric",
});

const utcDateFormatter = new Intl.DateTimeFormat("en-IN", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

const timeFormatter = new Intl.DateTimeFormat("en-IN", {
  hour: "numeric",
  minute: "2-digit",
});

const dayHeadingFormatter = new Intl.DateTimeFormat("en-IN", {
  weekday: "long",
  day: "numeric",
  month: "long",
});

export function formatDateTime(date: Date): string {
  return dateTimeFormatter.format(date);
}

/**
 * Registration windows are entered as plain dates and stored at UTC midnight,
 * so printing a time turned "3 Mar 2027" into "3 Mar 2027, 5:30 am" for an
 * Indian reader — a deadline nobody set. Dates that carry a real time of day
 * still show it.
 */
export function formatDateMaybeTime(date: Date): string {
  const midnightUtc =
    date.getUTCHours() === 0 &&
    date.getUTCMinutes() === 0 &&
    date.getUTCSeconds() === 0 &&
    date.getUTCMilliseconds() === 0;
  // Formatted in UTC: a date-only value read in a behind-UTC timezone would
  // otherwise print the day before.
  return midnightUtc ? utcDateFormatter.format(date) : dateTimeFormatter.format(date);
}

export function formatDate(date: Date): string {
  return dateFormatter.format(date);
}

const shortDateFormatter = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short" });

/** "20 Apr" — for compact card meta. */
export function formatShortDate(date: Date): string {
  return shortDateFormatter.format(date);
}

export function formatTime(date: Date): string {
  return timeFormatter.format(date);
}

export function formatDayHeading(date: Date): string {
  return dayHeadingFormatter.format(date);
}

/** Local calendar-day key (YYYY-MM-DD in the visitor's timezone) for grouping. */
export function localDayKey(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Organizer-supplied URLs are only ever rendered as links when they are
 * http(s) (or a same-origin path) — never `javascript:`/`data:` or anything
 * else a crafted value could smuggle into an href.
 */
export function safeLinkUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const trimmed = url.trim();
  if (trimmed.startsWith("/") && !trimmed.startsWith("//")) return trimmed;
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}

/** A website value typed without a scheme ("oxfordmun.org") is treated as https. */
export function safeWebsiteUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const trimmed = url.trim();
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return safeLinkUrl(trimmed);
  return safeLinkUrl(`https://${trimmed.replace(/^\/+/, "")}`);
}

export interface GalleryItems {
  photos: { id: string; url: string }[];
  sponsors: { id: string; url: string }[];
}

/** Gallery photos and sponsor logos with a linkable URL, in display order. */
export function galleryItems(
  media: { id: string; kind: string; url: string; displayOrder: number }[] | undefined,
): GalleryItems {
  const ordered = [...(media ?? [])].sort((a, b) => a.displayOrder - b.displayOrder);
  const pick = (kind: string) =>
    ordered.flatMap((item) => {
      const url = item.kind === kind ? safeLinkUrl(item.url) : null;
      return url ? [{ id: item.id, url }] : [];
    });
  return { photos: pick("GALLERY"), sponsors: pick("SPONSOR") };
}

/** Initials for an avatar fallback ("Aarav Mehta" → "AM"). */
export function initialsOf(name: string): string {
  // Only word-initial letters count: "Secretary-General (Demo)" used to come
  // out as "S(" because a parenthesised suffix counted as a name part.
  const parts = name
    .trim()
    .split(/\s+/)
    .map((part) => part.replace(/^[^\p{L}]+/u, ""))
    .filter((part) => /^\p{L}/u.test(part));
  const letters = parts.length > 1 ? [parts[0][0], parts[parts.length - 1][0]] : [parts[0]?.[0] ?? "?"];
  return letters.join("").toUpperCase();
}
