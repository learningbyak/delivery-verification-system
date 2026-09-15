import { NextResponse } from "next/server";
import { createServerActionClient } from "@/lib/supabase/server";
import { parseInvoiceDate } from "@/lib/invoice-date";

// Vercel Hobby (free) plan defaults every serverless function to a
// 10-second timeout — far too short when the parser service is on
// Render's free tier, which spins down after 15 minutes idle and can
// take 30-60 seconds to wake back up on the next request (verified
// against Render's current published behavior, Sept 2026). Without
// this, the Vercel function was very likely dying while waiting for
// Render to finish waking up — before the PDF was ever actually
// parsed. 60 is the maximum allowed on Hobby via this config without
// enabling Fluid Compute (which allows up to 300s on Hobby, also
// free, if 60s still isn't enough in practice).
export const maxDuration = 60;

const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024;
// Leaves headroom under maxDuration for the rest of the request
// (auth checks, the database writes after parsing) rather than
// consuming the entire 60s budget on the parser call alone.
const PARSER_FETCH_TIMEOUT_MS = 50_000;

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
  //
  // On Render's free tier, the service may be asleep (spun down after
  // 15 minutes idle) and take 30-60s to wake up on this request. An
  // AbortController-based timeout here gives a clear, honest error
  // instead of an indefinite hang if something is genuinely broken —
  // distinct from a slow-but-working cold start, which this timeout
  // is set long enough to tolerate.
  const parserFormData = new FormData();
  parserFormData.append("file", file);

  const abortController = new AbortController();
  const timeoutId = setTimeout(() => abortController.abort(), PARSER_FETCH_TIMEOUT_MS);

  let parseResult: ParseResponse;
  try {
    let parserRes: Response;
    try {
      parserRes = await fetch(`${parserUrl}/parse`, {
        method: "POST",
        headers: { Authorization: `Bearer ${parserToken}` },
        body: parserFormData,
        signal: abortController.signal,
      });
    } catch (fetchError) {
      if (fetchError instanceof Error && fetchError.name === "AbortError") {
        return NextResponse.json(
          {
            error:
              "The PDF reader took too long to respond. If it's been a while since the " +
              "last upload, it may have been asleep and needed to wake up — please try " +
              "again in a moment.",
          },
          { status: 504 }
        );
      }
      throw fetchError;
    } finally {
      clearTimeout(timeoutId);
    }

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
