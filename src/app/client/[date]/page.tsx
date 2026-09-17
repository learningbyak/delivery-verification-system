import Link from "next/link";
import { createServerActionClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const NO_DATE_SLUG = "no-date";

export default async function InvoicesForDatePage({
  params,
}: {
  params: Promise<{ date: string }>;
}) {
  const { date } = await params;
  const supabase = await createServerActionClient();

  // Strictly scoped to this one date — .is()/.eq() below is what
  // guarantees no mixing with other dates' invoices, not just the UI
  // grouping. RLS (org scope) applies on top of this automatically.
  let query = supabase
    .from("upload_batches")
    .select("batch_id, invoice_number, version, source_filename, created_at")
    .order("created_at", { ascending: false });

  query = date === NO_DATE_SLUG ? query.is("invoice_date", null) : query.eq("invoice_date", date);

  const { data: batches, error } = await query;

  return (
    <main style={{ maxWidth: 560 }}>
      <p style={{ marginBottom: "0.5rem" }}>
        <Link href="/client">← All dates</Link>
      </p>
      <h1 style={{ fontSize: "1.25rem" }}>
        Invoices — {date === NO_DATE_SLUG ? "No date on file" : date}
      </h1>

      {error && <p style={{ color: "crimson" }}>{error.message}</p>}

      {batches && batches.length === 0 && (
        <p style={{ color: "#666", marginTop: "1rem" }}>No invoices found for this date.</p>
      )}

      <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: "0.5rem", marginTop: "1rem" }}>
        {(batches ?? []).map((batch) => (
          <li
            key={batch.batch_id}
            style={{ border: "1px solid #ddd", borderRadius: 6, padding: "0.75rem 1rem" }}
          >
            <Link href={`/client/${date}/${batch.batch_id}`}>
              Invoice {batch.invoice_number}
              {batch.version > 1 ? ` (version ${batch.version})` : ""}
            </Link>
            <div style={{ fontSize: "0.85rem", color: "#666" }}>{batch.source_filename}</div>
          </li>
        ))}
      </ul>
    </main>
  );
}
