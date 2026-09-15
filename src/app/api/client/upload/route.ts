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

  // Entire ingestion — batch, department matching/creation, department
  // orders, all line items — happens in ONE Postgres function call,
  // which is one transaction. If anything fails anywhere inside it,
  // nothing is saved. Fixes a real bug: the previous version did this
  // as a sequence of separate inserts from application code, so a
  // failure partway through (e.g. the timeout bug fixed in migration
  // 0007) left earlier departments' data behind as an orphaned,
  // confusing partial upload. See migration 0008.
  const { data: batchId, error: ingestError } = await supabase.rpc(
    "ingest_parsed_invoice",
    {
      p_org_id: orgId,
      p_invoice_number: parseResult.invoice_number,
      p_invoice_date: parseInvoiceDate(parseResult.invoice_date_raw),
      p_uploaded_by: user.id,
      p_source_filename: file.name,
      p_departments: parseResult.departments,
    }
  );

  if (ingestError || !batchId) {
    return NextResponse.json(
      { error: "Failed to save invoice: " + ingestError?.message },
      { status: 500 }
    );
  }

  return NextResponse.json(
    {
      batch_id: batchId,
      invoice_number: parseResult.invoice_number,
      department_orders_created: parseResult.departments.length,
    },
    { status: 201 }
  );
}
