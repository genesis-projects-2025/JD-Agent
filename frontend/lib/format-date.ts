/**
 * format-date.ts
 *
 * Safe, hydration-mismatch-free date formatting helpers.
 *
 * Root cause of "A tree hydrated but some attributes didn't match" in Next.js:
 *   toLocaleDateString() / Intl.DateTimeFormat produce different output between
 *   the Node.js SSR environment (en-US ICU data) and the browser, causing React
 *   to warn about a hydration mismatch.
 *
 * Fix: always pass an explicit locale AND the `timeZone: "UTC"` option so both
 * environments produce identical output. Use these helpers everywhere instead of
 * calling `new Date().toLocaleDateString()` directly in JSX.
 */

/**
 * Format a date string as "Jan 6, 2026"
 */
export function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "—";
  try {
    return new Intl.DateTimeFormat("en-GB", {
      year: "numeric",
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    }).format(new Date(dateStr));
  } catch {
    return dateStr;
  }
}

/**
 * Format a date string as "6 Jan 2026, 10:30"
 */
export function formatDateTime(dateStr: string | null | undefined): string {
  if (!dateStr) return "—";
  try {
    return new Intl.DateTimeFormat("en-GB", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "UTC",
    }).format(new Date(dateStr));
  } catch {
    return dateStr;
  }
}

/**
 * Format a date string as "6 Jan"
 */
export function formatShortDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "—";
  try {
    return new Intl.DateTimeFormat("en-GB", {
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    }).format(new Date(dateStr));
  } catch {
    return dateStr;
  }
}
