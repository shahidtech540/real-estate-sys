import { env } from "./config";

/**
 * Dates and time zones — `ARCHITECTURE.md` §12.7, `AGENTS.md` §5.8.
 *
 * "Today" is a calendar day in `Asia/Karachi`, never the server's local zone.
 * Business dates are `DATE` columns and travel as `YYYY-MM-DD`; event timestamps
 * are `timestamptz` and travel as ISO-8601 UTC with milliseconds (`API.md` §1.8).
 */

export function businessTimeZone(): string {
  return env().PKT_TZ;
}

/** `YYYY-MM-DD` for the given instant in the business time zone. */
export function toDateOnly(
  instant: Date,
  timeZone: string = businessTimeZone(),
): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);
  const pick = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${pick("year")}-${pick("month")}-${pick("day")}`;
}

/** `DD-MMM-YYYY` for display (`DESIGN.md` §4.2); never localized. */
export function formatDateOnly(dateOnly: string): string {
  const [year, month, day] = dateOnly.split("-").map(Number);
  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  const name = months[month - 1];
  if (!year || !name || !day)
    throw new Error(`Invalid date-only value: ${dateOnly}`);
  return `${String(day).padStart(2, "0")}-${name}-${year}`;
}

/** ISO-8601 UTC with milliseconds — `API.md` §1.9 `Instant`. */
export function toInstant(date: Date): string {
  return date.toISOString();
}

/** Parses a `DATE` column (returned by Prisma as midnight UTC) into `YYYY-MM-DD`. */
export function dateColumnToWire(value: Date): string {
  return value.toISOString().slice(0, 10);
}
