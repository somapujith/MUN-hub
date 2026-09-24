/**
 * Minimal CSV-from-rows helper, RFC 4180-ish: any field containing a comma,
 * double quote, or line break gets wrapped in double quotes with internal
 * quotes doubled. Used for client-side exports of data TanStack Query has
 * already loaded in full (no new backend endpoint) — see the admin Analytics
 * page for the first caller.
 */

function escapeCsvField(value: unknown): string {
  if (value === null || value === undefined) return "";
  const str = String(value);
  if (/[",\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/** Builds a full CSV document (header row + data rows) as a single string. */
export function rowsToCsv(headers: string[], rows: (string | number | null | undefined)[][]): string {
  return [headers, ...rows].map((row) => row.map(escapeCsvField).join(",")).join("\r\n");
}

/**
 * Triggers a browser download of `content` as `filename`. A UTF-8 BOM is
 * prepended so Excel on Windows — the realistic consumer for an admin CSV
 * export — renders non-ASCII characters correctly instead of mojibake.
 */
export function downloadCsv(filename: string, content: string): void {
  const blob = new Blob(["﻿", content], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
