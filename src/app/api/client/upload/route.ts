import { NextResponse } from "next/server";
import { createServerActionClient } from "@/lib/supabase/server";
import { parseInvoiceDate } from "@/lib/invoice-date";

const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024;

type ParsedLineItem = {
  line_no: string;
  barcode_value: string;
  article_number: string;
  description: string;
  pack_size: string | null;
  size_spec: string | null;
  ordered_qty: number;
  supplier_reported_qty: number;
  err_code: string | null;
  raw_remainder: string;
};

type ParsedDepartment = {
  source_dept_code: string;
  department_name: string;
  line_items: ParsedLineItem[];
};

type ParseResponse = {
  invoice_number: string | null;
  invoice_date_raw: string | null;
  departments: ParsedDepartment[];
};

export async function POST(request: Request) {
  const supabase = await createServerActionClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, org_id")
    .eq("id", user.id)
    .single();

  if (profile?.role !== "client_admin" || !profile.org_id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const orgId = profile.org_id;

  const formData = await request.formData().catch(() => null);
  const file = formData?.get("file");
  if (!file || !(file instanceof File)) {
    return NextResponse.json({ error: "Expected a 'file' field" }, { status: 400 });
  }
  if (file.size > MAX_FILE_SIZE_BYTES) {
    return NextResponse.json({ error: "File too large" }, { status: 413 });
  }

  const parserUrl = process.env.PDF_PARSER_SERVICE_URL;
  const parserToken = process.env.PDF_PARSER_SERVICE_TOKEN;
  if (!parserUrl || !parserToken) {
    return NextResponse.json(
      { error: "PDF parser service is not configured" },
      { status: 503 }
    );
  }

  // Forward to the parser microservice. Server-to-server only — the
  // browser never talks to the parser directly.
  const parserFormData = new FormData();
  parserFormData.append("file", file);

  let parseResult: ParseResponse;
  try {
    const parserRes = await fetch(`${parserUrl}/parse`, {
      method: "POST",
      headers: { Authorization: `Bearer ${parserToken}` },
      body: parserFormData,
    });

    if (!parserRes.ok) {
      const body = await parserRes.json().catch(() => ({}));
      return NextResponse.json(
        { error: body.detail ?? "Failed to parse PDF" },
        { status: parserRes.status === 422 ? 422 : 502 }
      );
    }

    parseResult = await parserRes.json();
  } catch {
    return NextResponse.json(
      { error: "Could not reach the PDF parser service" },
      { status: 502 }
    );
  }

  if (!parseResult.invoice_number) {
    return NextResponse.json(
      { error: "Could not find an invoice number in this file" },
      { status: 422 }
    );
  }

  // Compute the next version for this org+invoice_number, per the
  // documented re-upload behavior (versioning, never overwriting —
  // see docs/architecture/spec.md Section 4.3).
  const { data: existingBatches } = await supabase
    .from("upload_batches")
    .select("version")
    .eq("org_id", orgId)
    .eq("invoice_number", parseResult.invoice_number)
    .order("version", { ascending: false })
    .limit(1);

  const nextVersion = (existingBatches?.[0]?.version ?? 0) + 1;

  const { data: batch, error: batchError } = await supabase
    .from("upload_batches")
    .insert({
      org_id: orgId,
      invoice_number: parseResult.invoice_number,
      invoice_date: parseInvoiceDate(parseResult.invoice_date_raw),
      uploaded_by: user.id,
      source_filename: file.name,
      version: nextVersion,
    })
    .select("batch_id")
    .single();

  if (batchError || !batch) {
    return NextResponse.json(
      { error: "Failed to create upload record: " + batchError?.message },
      { status: 500 }
    );
  }

  const departmentOrderIds: string[] = [];

  for (const dept of parseResult.departments) {
    // Match or create the department by its source code within this
    // org — per the confirmed decision that departments auto-match/
    // create from the PDF's own DEPARTMENT: sections.
    const { data: existingDept } = await supabase
      .from("departments")
      .select("department_id")
      .eq("org_id", orgId)
      .eq("source_dept_code", dept.source_dept_code)
      .maybeSingle();

    let departmentId = existingDept?.department_id as string | undefined;

    if (!departmentId) {
      const { data: newDept, error: deptError } = await supabase
        .from("departments")
        .insert({
          org_id: orgId,
          department_name: dept.department_name,
          source_dept_code: dept.source_dept_code,
        })
        .select("department_id")
        .single();

      if (deptError || !newDept) {
        return NextResponse.json(
          {
            error: `Failed to create department "${dept.department_name}": ${deptError?.message}`,
            batch_id: batch.batch_id,
          },
          { status: 500 }
        );
      }
      departmentId = newDept.department_id;
    }

    const { data: deptOrder, error: deptOrderError } = await supabase
      .from("department_orders")
      .insert({ batch_id: batch.batch_id, department_id: departmentId })
      .select("dept_order_id")
      .single();

    if (deptOrderError || !deptOrder) {
      return NextResponse.json(
        {
          error: `Failed to create department order for "${dept.department_name}": ${deptOrderError?.message}`,
          batch_id: batch.batch_id,
        },
        { status: 500 }
      );
    }
    departmentOrderIds.push(deptOrder.dept_order_id);

    const lineItemRows = dept.line_items.map((item) => ({
      dept_order_id: deptOrder.dept_order_id,
      row_data: item,
      barcode_value: item.barcode_value,
      article_number: item.article_number,
      description: item.description,
      ordered_qty: item.ordered_qty,
      supplier_reported_qty: item.supplier_reported_qty,
      // Pre-filled from the supplier's own reported quantity — the
      // confirmed baseline, refined later by actual dock scans (Phase 3).
      delivered_qty: item.supplier_reported_qty,
      err_code: item.err_code,
    }));

    if (lineItemRows.length > 0) {
      const { error: lineItemsError } = await supabase
        .from("delivery_line_items")
        .insert(lineItemRows);

      if (lineItemsError) {
        return NextResponse.json(
          {
            error: `Failed to save line items for "${dept.department_name}": ${lineItemsError.message}`,
            batch_id: batch.batch_id,
          },
          { status: 500 }
        );
      }
    }
  }

  return NextResponse.json(
    {
      batch_id: batch.batch_id,
      invoice_number: parseResult.invoice_number,
      department_orders_created: departmentOrderIds.length,
    },
    { status: 201 }
  );
}
