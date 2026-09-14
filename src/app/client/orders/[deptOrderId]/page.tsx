import { notFound } from "next/navigation";
import { createServerActionClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const STATUS_COLORS: Record<string, string> = {
  pending: "#666",
  partial: "#b58900",
  fully_received: "#2a9d3f",
  over_received: "#c0392b",
};

export default async function DepartmentOrderPage({
  params,
}: {
  params: Promise<{ deptOrderId: string }>;
}) {
  const { deptOrderId } = await params;
  const supabase = await createServerActionClient();

  const { data: deptOrder } = await supabase
    .from("department_orders")
    .select(
      `dept_order_id, status,
       departments ( department_name ),
       upload_batches ( invoice_number, invoice_date, source_filename )`
    )
    .eq("dept_order_id", deptOrderId)
    .single();

  if (!deptOrder) {
    notFound();
  }

  const { data: lineItems } = await supabase
    .from("delivery_line_items")
    .select(
      "line_item_id, barcode_value, article_number, description, ordered_qty, supplier_reported_qty, delivered_qty, err_code, line_status"
    )
    .eq("dept_order_id", deptOrderId)
    .order("description");

  const dept = Array.isArray(deptOrder.departments) ? deptOrder.departments[0] : deptOrder.departments;
  const batch = Array.isArray(deptOrder.upload_batches) ? deptOrder.upload_batches[0] : deptOrder.upload_batches;

  return (
    <main style={{ maxWidth: 900 }}>
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
            <th style={{ padding: "0.5rem", textAlign: "right" }}>Ordered</th>
            <th style={{ padding: "0.5rem", textAlign: "right" }}>Delivered</th>
            <th style={{ padding: "0.5rem" }}>Status</th>
          </tr>
        </thead>
        <tbody>
          {(lineItems ?? []).map((item) => (
            <tr key={item.line_item_id} style={{ borderTop: "1px solid #eee" }}>
              <td style={{ padding: "0.5rem", fontFamily: "monospace" }}>{item.barcode_value}</td>
              <td style={{ padding: "0.5rem" }}>{item.description}</td>
              <td style={{ padding: "0.5rem", textAlign: "right" }}>{item.ordered_qty}</td>
              <td style={{ padding: "0.5rem", textAlign: "right" }}>{item.delivered_qty}</td>
              <td style={{ padding: "0.5rem", color: STATUS_COLORS[item.line_status] }}>
                {item.line_status}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {(!lineItems || lineItems.length === 0) && (
        <p style={{ color: "#666", marginTop: "1rem" }}>No line items found.</p>
      )}
    </main>
  );
}
