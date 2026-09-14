import { NextResponse } from "next/server";
import {
  createServerActionClient,
  createServiceRoleClient,
} from "@/lib/supabase/server";

/**
 * This route uses the service-role client, which bypasses RLS
 * entirely. proxy.ts already blocks non-admin requests from reaching
 * this handler — but because service-role has no RLS backstop if that
 * check were ever wrong or bypassed, we explicitly re-verify the
 * caller is really an admin here too, using the RLS-respecting
 * client. This is not redundant the way it might look — it's the
 * ONLY backstop for this specific route, since RLS itself can't help
 * once service-role is in play.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ orgId: string }> }
) {
  const { orgId } = await params;

  const sessionClient = await createServerActionClient();
  const {
    data: { user },
  } = await sessionClient.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { data: profile } = await sessionClient
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (profile?.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  if (
    !body ||
    typeof body.email !== "string" ||
    typeof body.password !== "string" ||
    body.password.length < 12 ||
    Object.keys(body).length !== 2
  ) {
    return NextResponse.json(
      {
        error:
          "Expected { email: string, password: string } — password must be at least 12 characters",
      },
      { status: 400 }
    );
  }

  // Confirm the org actually exists before creating an account tied
  // to it (still via the RLS-respecting client — admin can read
  // organizations per Phase 1's policy, no need for service-role here).
  const { data: org } = await sessionClient
    .from("organizations")
    .select("org_id")
    .eq("org_id", orgId)
    .single();

  if (!org) {
    return NextResponse.json({ error: "Organization not found" }, { status: 404 });
  }

  const serviceClient = createServiceRoleClient();

  const { data: newUser, error: createUserError } =
    await serviceClient.auth.admin.createUser({
      email: body.email,
      password: body.password,
      email_confirm: true,
    });

  if (createUserError || !newUser.user) {
    if (createUserError?.code === "email_exists") {
      return NextResponse.json(
        { error: "An account with this email already exists" },
        { status: 409 }
      );
    }
    return NextResponse.json(
      { error: createUserError?.message ?? "Failed to create account" },
      { status: 500 }
    );
  }

  const { error: profileError } = await serviceClient.from("profiles").insert({
    id: newUser.user.id,
    role: "client_admin",
    org_id: orgId,
  });

  if (profileError) {
    // The auth user now exists without a profile — clean it up rather
    // than leaving an orphaned, unusable account behind.
    await serviceClient.auth.admin.deleteUser(newUser.user.id);
    return NextResponse.json(
      { error: "Failed to create account profile: " + profileError.message },
      { status: 500 }
    );
  }

  return NextResponse.json(
    { user: { id: newUser.user.id, email: body.email } },
    { status: 201 }
  );
}
