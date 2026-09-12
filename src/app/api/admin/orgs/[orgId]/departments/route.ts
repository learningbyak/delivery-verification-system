import { NextResponse } from "next/server";
import { createServerActionClient } from "@/lib/supabase/server";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ orgId: string }> }
) {
  const { orgId } = await params;
  const supabase = await createServerActionClient();

  const { data, error } = await supabase
    .from("departments")
    .select("department_id, org_id, department_name, source_dept_code, created_at")
    .eq("org_id", orgId)
    .order("department_name");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ departments: data });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ orgId: string }> }
) {
  const { orgId } = await params;
  const body = await request.json().catch(() => null);

  if (
    !body ||
    typeof body.department_name !== "string" ||
    body.department_name.trim().length < 1 ||
    Object.keys(body).length !== 1
  ) {
    return NextResponse.json(
      { error: "Expected { department_name: string } with no other fields" },
      { status: 400 }
    );
  }

  const supabase = await createServerActionClient();

  const { data, error } = await supabase
    .from("departments")
    .insert({ org_id: orgId, department_name: body.department_name.trim() })
    .select("department_id, org_id, department_name, source_dept_code, created_at")
    .single();

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json(
        { error: "A department with this name already exists in this org" },
        { status: 409 }
      );
    }
    if (error.code === "23503") {
      // Foreign key violation — org_id doesn't exist. RLS would also
      // block a cross-org write, but this specific error means the
      // org simply isn't real.
      return NextResponse.json({ error: "Organization not found" }, { status: 404 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ department: data }, { status: 201 });
}
