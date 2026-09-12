import { NextResponse } from "next/server";
import { createServerActionClient } from "@/lib/supabase/server";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ deptId: string }> }
) {
  const { deptId } = await params;
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
    .update({ department_name: body.department_name.trim() })
    .eq("department_id", deptId)
    .select("department_id, org_id, department_name, source_dept_code, created_at")
    .single();

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json(
        { error: "A department with this name already exists in this org" },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: "Department not found" }, { status: 404 });
  }

  return NextResponse.json({ department: data });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ deptId: string }> }
) {
  const { deptId } = await params;
  const supabase = await createServerActionClient();

  const { error, count } = await supabase
    .from("departments")
    .delete({ count: "exact" })
    .eq("department_id", deptId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (count === 0) {
    return NextResponse.json({ error: "Department not found" }, { status: 404 });
  }

  return NextResponse.json({ deleted: true });
}
