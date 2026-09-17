import { notFound } from "next/navigation";
import Link from "next/link";
import { createServerActionClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function DepartmentsForInvoicePage({
  params,
}: {
  params: Promise<{ date: string; batchId: string }>;
}) {
  const { date, batchId } = await params;
  const supabase = await createServerActionClient();

  const { data: batch } = await supabase
    .from("upload_batches")
    .select("batch_id, invoice_number, invoice_date")
    .eq("batch_id", batchId)
    .single();

  if (!batch) {
    notFound();
  }

  // Strictly scoped to this one invoice (batch_id) — the only way a
  // department_order shows up here is if it belongs to exactly this
  // batch. No cross-invoice mixing possible at this query level.
  const { data: deptOrders, error } = await supabase
    .from("department_orders")
    .select("dept_order_id, status, departments ( department_name )")
    .eq("batch_id", batchId)
    .order("created_at");

  return (
    <main style={{ maxWidth: 560 }}>
      <p style={{ marginBottom: "0.5rem" }}>
        <Link href={`/client/${date}`}>← Invoices for {date === "no-date" ? "no date on file" : date}</Link>
      </p>
      <h1 style={{ fontSize: "1.25rem" }}>Departments — Invoice {batch.invoice_number}</h1>

      {error && <p style={{ color: "crimson" }}>{error.message}</p>}

      <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: "0.5rem", marginTop: "1rem" }}>
        {(deptOrders ?? []).map((row) => {
          const dept = Array.isArray(row.departments) ? row.departments[0] : row.departments;
          return (
            <li
              key={row.dept_order_id}
              style={{ border: "1px solid #ddd", borderRadius: 6, padding: "0.75rem 1rem" }}
            >
              <Link href={`/client/${date}/${batchId}/${row.dept_order_id}`}>
                {dept?.department_name}
              </Link>
              <span style={{ color: "#666", fontSize: "0.85rem" }}> — {row.status}</span>
            </li>
          );
        })}
      </ul>
    </main>
  );
}
