import { NextResponse } from "next/server";
import { createServerActionClient } from "@/lib/supabase/server";

const ALLOWED_STATUS = ["active", "suspended"];

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ orgId: string }> }
) {
  const { orgId } = await params;
  const body = await request.json().catch(() => null);

  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  // Allow-list exactly the fields this endpoint may change — never
  // pass the raw body through to the database (mass-assignment
  // protection). org_id, secret_code_hash etc. are never settable here.
  const update: { org_name?: string; status?: string } = {};

  if ("org_name" in body) {
    if (typeof body.org_name !== "string" || body.org_name.trim().length < 2) {
      return NextResponse.json({ error: "Invalid org_name" }, { status: 400 });
    }
    update.org_name = body.org_name.trim();
  }

  if ("status" in body) {
    if (!ALLOWED_STATUS.includes(body.status)) {
      return NextResponse.json(
        { error: `status must be one of: ${ALLOWED_STATUS.join(", ")}` },
        { status: 400 }
      );
    }
    update.status = body.status;
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json(
      { error: "Provide at least one of: org_name, status" },
      { status: 400 }
    );
  }

  const supabase = await createServerActionClient();

  const { data, error } = await supabase
    .from("organizations")
    .update(update)
    .eq("org_id", orgId)
    .select("org_id, org_name, status, created_at")
    .single();

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json(
        { error: "An organization with this name already exists" },
        { status: 409 }
      );
    }
    // No row matched — either it doesn't exist, or RLS silently
    // filtered it out. Both cases return the same 404, never
    // distinguishing which, per the IDOR-prevention pattern in the
    // security assessment.
    return NextResponse.json({ error: "Organization not found" }, { status: 404 });
  }

  return NextResponse.json({ organization: data });
}
