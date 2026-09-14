const MONTHS: Record<string, string> = {
  JAN: "01", FEB: "02", MAR: "03", APR: "04", MAY: "05", JUN: "06",
  JUL: "07", AUG: "08", SEP: "09", OCT: "10", NOV: "11", DEC: "12",
};

/**
 * Parses the Loblaws invoice date format, e.g. "30.AUG.2026", into
 * an ISO date string ("2026-08-30"). Returns null if the format
 * doesn't match rather than throwing — a date we can't parse
 * shouldn't block the whole upload, just leave invoice_date null.
 */
export function parseInvoiceDate(raw: string | null): string | null {
  if (!raw) return null;
  const match = /^(\d{1,2})\.([A-Z]{3})\.(\d{4})$/.exec(raw.trim());
  if (!match) return null;
  const [, day, monAbbr, year] = match;
  if (!day || !monAbbr || !year) return null;
  const month = MONTHS[monAbbr];
  if (!month) return null;
  return `${year}-${month}-${day.padStart(2, "0")}`;
}
