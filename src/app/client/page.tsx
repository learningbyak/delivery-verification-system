import Link from "next/link";
import { createServerActionClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

// URL segment for invoices whose date couldn't be parsed from the
// PDF — grouped separately rather than dropped, so nothing uploaded
// ever silently disappears from navigation.
const NO_DATE_SLUG = "no-date";

export default async function InvoiceDatesPage() {
  const supabase = await createServerActionClient();

  // RLS scopes this to the caller's own org automatically — see
  // migration 0006's select_upload_batches policy.
  const { data: batches, error } = await supabase
    .from("upload_batches")
    .select("invoice_date")
    .order("invoice_date", { ascending: false, nullsFirst: false });

  const dateCounts = new Map<string, number>();
  for (const b of batches ?? []) {
    const key = b.invoice_date ?? NO_DATE_SLUG;
    dateCounts.set(key, (dateCounts.get(key) ?? 0) + 1);
  }

  return (
    <main style={{ maxWidth: 480 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1 style={{ fontSize: "1.25rem" }}>Invoice Dates</h1>
        <Link href="/client/upload" style={{ padding: "0.5rem 1rem", border: "1px solid #ccc", borderRadius: 6 }}>
          Upload Invoice
        </Link>
      </div>

      {error && <p style={{ color: "crimson" }}>{error.message}</p>}

      {dateCounts.size === 0 && (
        <p style={{ color: "#666", marginTop: "1rem" }}>No invoices uploaded yet.</p>
      )}

      <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: "0.5rem", marginTop: "1rem" }}>
        {[...dateCounts.entries()].map(([dateKey, count]) => (
          <li
            key={dateKey}
            style={{ border: "1px solid #ddd", borderRadius: 6, padding: "0.75rem 1rem" }}
          >
            <Link href={`/client/${dateKey}`}>
              {dateKey === NO_DATE_SLUG ? "No date on file" : dateKey}
            </Link>
            <span style={{ color: "#666", fontSize: "0.85rem" }}>
              {" "}
              — {count} invoice{count === 1 ? "" : "s"}
            </span>
          </li>
        ))}
      </ul>
    </main>
  );
}
