function formatDate(date: Date, withYear: boolean): string {
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    year: withYear ? "numeric" : undefined,
  }).format(date);
}

export function formatDateRange(start: Date | null, end: Date | null): string {
  if (!start) return "Dates TBA";
  if (!end || start.getTime() === end.getTime()) {
    return formatDate(start, true);
  }

  const sameYear = start.getFullYear() === end.getFullYear();
  return `${formatDate(start, !sameYear)} – ${formatDate(end, true)}`;
}
