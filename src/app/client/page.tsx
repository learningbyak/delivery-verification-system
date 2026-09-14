import Link from "next/link";
import { createServerActionClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function ClientDashboard() {
  const supabase = await createServerActionClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // RLS already scopes this to the caller's own org — no need to
  // filter by org_id explicitly here, but the join through
  // department_orders -> departments is what RLS itself checks.
  const { data: deptOrders, error } = await supabase
    .from("department_orders")
    .select(
      `dept_order_id, status, created_at,
       departments ( department_name ),
       upload_batches ( invoice_number, invoice_date, source_filename )`
    )
    .order("created_at", { ascending: false });

  return (
    <main style={{ display: "grid", gap: "1.5rem", maxWidth: 720 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1 style={{ fontSize: "1.25rem" }}>Invoices</h1>
        <Link href="/client/upload" style={{ padding: "0.5rem 1rem", border: "1px solid #ccc", borderRadius: 6 }}>
          Upload Invoice
        </Link>
      </div>

      {error && <p style={{ color: "crimson" }}>{error.message}</p>}

      {deptOrders && deptOrders.length === 0 && (
        <p style={{ color: "#666" }}>
          No invoices uploaded yet. User: {user?.email}
        </p>
      )}

      {deptOrders && deptOrders.length > 0 && (
        <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: "0.5rem" }}>
          {deptOrders.map((row) => {
            // Supabase's JS client types nested relations as arrays
            // even for a to-one join in some configurations — handle
            // both shapes defensively rather than assuming one.
            const dept = Array.isArray(row.departments) ? row.departments[0] : row.departments;
            const batch = Array.isArray(row.upload_batches) ? row.upload_batches[0] : row.upload_batches;

            return (
              <li
                key={row.dept_order_id}
                style={{
                  border: "1px solid #ddd",
                  borderRadius: 6,
                  padding: "0.75rem 1rem",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <div>
                  <Link href={`/client/orders/${row.dept_order_id}`}>
                    {dept?.department_name} — Invoice {batch?.invoice_number}
                  </Link>
                  <div style={{ fontSize: "0.85rem", color: "#666" }}>
                    {batch?.invoice_date ?? "no date"} · {row.status}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
