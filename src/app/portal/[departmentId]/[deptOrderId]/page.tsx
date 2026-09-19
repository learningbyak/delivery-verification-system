import { notFound } from "next/navigation";
import Link from "next/link";
import { createServerActionClient } from "@/lib/supabase/server";
import ScanClient from "./scan-client";

export const dynamic = "force-dynamic";

export default async function PortalScanPage({
  params,
}: {
  params: Promise<{ departmentId: string; deptOrderId: string }>;
}) {
  const { departmentId, deptOrderId } = await params;
  const supabase = await createServerActionClient();

  const { data: deptOrder } = await supabase
    .from("department_orders")
    .select("dept_order_id, status, department_id, upload_batches ( invoice_number )")
    .eq("dept_order_id", deptOrderId)
    .single();

  // Belt-and-suspenders: the invoice list page already hides/disables
  // locked invoices as links, but someone could still navigate here
  // directly by URL — re-check server-side rather than trust the UI.
  if (!deptOrder || deptOrder.department_id !== departmentId) {
    notFound();
  }

  const batch = Array.isArray(deptOrder.upload_batches) ? deptOrder.upload_batches[0] : deptOrder.upload_batches;

  if (deptOrder.status === "fully_received") {
    return (
      <main style={{ maxWidth: 420 }}>
        <p style={{ marginBottom: "0.5rem" }}>
          <Link href={`/portal/${departmentId}`}>← Invoices</Link>
        </p>
        <div style={{ padding: "1.5rem", border: "1px solid #ddd", borderRadius: 8, textAlign: "center" }}>
          <p style={{ fontSize: "1.05rem" }}>Invoice {batch?.invoice_number}</p>
          <p style={{ color: "#666" }}>This invoice is fully received and locked. No further scans are accepted.</p>
        </div>
      </main>
    );
  }

  return (
    <ScanClient
      departmentId={departmentId}
      deptOrderId={deptOrderId}
      invoiceNumber={batch?.invoice_number ?? ""}
    />
  );
}
