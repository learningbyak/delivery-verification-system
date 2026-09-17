import { notFound } from "next/navigation";
import Link from "next/link";
import { createServerActionClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const STATUS_COLORS: Record<string, string> = {
  pending: "#666",
  partial: "#b58900",
  fully_received: "#2a9d3f",
  over_received: "#c0392b",
};

export default async function ProductsPage({
  params,
}: {
  params: Promise<{ date: string; batchId: string; deptOrderId: string }>;
}) {
  const { date, batchId, deptOrderId } = await params;
  const supabase = await createServerActionClient();

  const { data: deptOrder } = await supabase
    .from("department_orders")
    .select(
      `dept_order_id, status, batch_id,
       departments ( department_name ),
       upload_batches ( invoice_number, invoice_date, source_filename )`
    )
    .eq("dept_order_id", deptOrderId)
    .single();

  // Belt-and-suspenders correctness check, on top of RLS: if this
  // department order doesn't actually belong to the batch in the URL,
  // treat it as not found rather than silently showing it — the URL
  // hierarchy itself is what guarantees no cross-invoice mixing here.
  if (!deptOrder || deptOrder.batch_id !== batchId) {
    notFound();
  }

  // Strictly scoped to this one department_order — the only way a
  // product row shows up here is if it belongs to exactly this
  // invoice + department combination.
  const { data: lineItems } = await supabase
    .from("delivery_line_items")
    .select(
      "line_item_id, barcode_value, article_number, description, pack_size, size_spec, ordered_qty, delivered_qty, received_qty, line_status"
    )
    .eq("dept_order_id", deptOrderId)
    .order("description");

  const dept = Array.isArray(deptOrder.departments) ? deptOrder.departments[0] : deptOrder.departments;
  const batch = Array.isArray(deptOrder.upload_batches) ? deptOrder.upload_batches[0] : deptOrder.upload_batches;

  return (
    <main style={{ maxWidth: 1000 }}>
      <p style={{ marginBottom: "0.5rem" }}>
        <Link href={`/client/${date}/${batchId}`}>← Departments for Invoice {batch?.invoice_number}</Link>
      </p>
      <h1 style={{ fontSize: "1.25rem" }}>
        {dept?.department_name} — Invoice {batch?.invoice_number}
      </h1>
      <p style={{ color: "#666" }}>
        {batch?.invoice_date ?? "no date"} · Overall status:{" "}
        <strong style={{ color: STATUS_COLORS[deptOrder.status] }}>{deptOrder.status}</strong>
      </p>

      <table style={{ width: "100%", borderCollapse: "collapse", marginTop: "1rem", fontSize: "0.9rem" }}>
        <thead>
          <tr style={{ background: "#f5f5f5", textAlign: "left" }}>
            <th style={{ padding: "0.5rem" }}>Barcode</th>
            <th style={{ padding: "0.5rem" }}>Description</th>
            <th style={{ padding: "0.5rem" }}>Size</th>
            <th style={{ padding: "0.5rem", textAlign: "right" }}>Ordered</th>
            <th style={{ padding: "0.5rem", textAlign: "right" }}>Delivered (invoice)</th>
            <th style={{ padding: "0.5rem", textAlign: "right" }}>Received (scanned)</th>
            <th style={{ padding: "0.5rem" }}>Status</th>
          </tr>
        </thead>
        <tbody>
          {(lineItems ?? []).map((item) => (
            <tr key={item.line_item_id} style={{ borderTop: "1px solid #eee" }}>
              <td style={{ padding: "0.5rem", fontFamily: "monospace" }}>{item.barcode_value}</td>
              <td style={{ padding: "0.5rem" }}>{item.description}</td>
              <td style={{ padding: "0.5rem", color: "#666" }}>
                {item.size_spec ?? item.pack_size ?? "—"}
              </td>
              <td style={{ padding: "0.5rem", textAlign: "right" }}>{item.ordered_qty}</td>
              <td style={{ padding: "0.5rem", textAlign: "right" }}>{item.delivered_qty}</td>
              <td style={{ padding: "0.5rem", textAlign: "right" }}>{item.received_qty}</td>
              <td style={{ padding: "0.5rem", color: STATUS_COLORS[item.line_status] }}>
                {item.line_status}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {(!lineItems || lineItems.length === 0) && (
        <p style={{ color: "#666", marginTop: "1rem" }}>No products found.</p>
      )}

      <p style={{ fontSize: "0.8rem", color: "#666", marginTop: "1rem" }}>
        <strong>Delivered (invoice)</strong> is what the supplier&apos;s paperwork claims.{" "}
        <strong>Received (scanned)</strong> only changes when an employee physically scans the
        item — it is never assumed from the invoice.
      </p>
    </main>
  );
}
