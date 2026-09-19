import { NextResponse } from "next/server";
import { createServerActionClient } from "@/lib/supabase/server";

/**
 * Deliberately thin. All real validation and the row-level locking
 * that prevents race conditions live in the process_scan Postgres
 * function (migration 0010), tested directly with a genuine
 * concurrent-request test — see docs/phases/phase-3.md. This route's
 * only job is: confirm the caller is authenticated, validate the
 * request shape, and forward to the RPC.
 */
export async function POST(request: Request) {
  const supabase = await createServerActionClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);

  if (
    !body ||
    typeof body.event_id !== "string" ||
    typeof body.barcode_value !== "string" ||
    typeof body.idempotency_key !== "string" ||
    (body.scanned_qty !== undefined && typeof body.scanned_qty !== "number") ||
    (body.method !== undefined && body.method !== "camera" && body.method !== "manual")
  ) {
    return NextResponse.json(
      {
        error:
          "Expected { event_id, barcode_value, idempotency_key, scanned_qty?, method? }",
      },
      { status: 400 }
    );
  }

  const { data, error } = await supabase.rpc("process_scan", {
    p_event_id: body.event_id,
    p_barcode_value: body.barcode_value,
    p_idempotency_key: body.idempotency_key,
    p_scanned_qty: body.scanned_qty ?? 1,
    p_method: body.method ?? "camera",
  });

  if (error) {
    return NextResponse.json({ result: "error", message: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}
