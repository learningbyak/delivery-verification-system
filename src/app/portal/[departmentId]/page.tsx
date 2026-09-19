import Link from "next/link";
import { createServerActionClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function PortalInvoicesPage({
  params,
}: {
  params: Promise<{ departmentId: string }>;
}) {
  const { departmentId } = await params;
  const supabase = await createServerActionClient();

  const { data: department } = await supabase
    .from("departments")
    .select("department_name")
    .eq("department_id", departmentId)
    .single();

  const { data: deptOrders, error } = await supabase
    .from("department_orders")
    .select("dept_order_id, status, upload_batches ( invoice_number, invoice_date )")
    .eq("department_id", departmentId)
    .order("created_at", { ascending: false });

  return (
    <main style={{ maxWidth: 420 }}>
      <p style={{ marginBottom: "0.5rem" }}>
        <Link href="/portal">← Departments</Link>
      </p>
      <h1 style={{ fontSize: "1.15rem" }}>{department?.department_name ?? "Invoices"}</h1>

      {error && <p style={{ color: "crimson" }}>{error.message}</p>}

      {deptOrders && deptOrders.length === 0 && (
        <p style={{ color: "#666" }}>No invoices for this department yet.</p>
      )}

      <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: "0.6rem", marginTop: "1rem" }}>
        {(deptOrders ?? []).map((row) => {
          const batch = Array.isArray(row.upload_batches) ? row.upload_batches[0] : row.upload_batches;
          const isLocked = row.status === "fully_received";

          return (
            <li key={row.dept_order_id}>
              {isLocked ? (
                <div
                  style={{
                    padding: "1rem",
                    border: "1px solid #ddd",
                    borderRadius: 8,
                    background: "#f5f5f5",
                    color: "#888",
                  }}
                >
                  <div>Invoice {batch?.invoice_number}</div>
                  <div style={{ fontSize: "0.85rem" }}>
                    {batch?.invoice_date ?? "no date"} — Fully received, locked
                  </div>
                </div>
              ) : (
                <Link
                  href={`/portal/${departmentId}/${row.dept_order_id}`}
                  style={{
                    display: "block",
                    padding: "1rem",
                    border: "1px solid #ddd",
                    borderRadius: 8,
                  }}
                >
                  <div style={{ fontSize: "1.05rem" }}>Invoice {batch?.invoice_number}</div>
                  <div style={{ fontSize: "0.85rem", color: "#666" }}>
                    {batch?.invoice_date ?? "no date"} — {row.status}
                  </div>
                </Link>
              )}
            </li>
          );
        })}
      </ul>
    </main>
  );
}
