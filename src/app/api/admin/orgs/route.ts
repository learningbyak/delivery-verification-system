import { NextResponse } from "next/server";
import { createServerActionClient } from "@/lib/supabase/server";
import { generateSecretCode, hashSecretCode } from "@/lib/secret-code";

/**
 * Note on authorization: middleware.ts already blocks non-admin
 * requests from reaching this handler at all. The query below is
 * still scoped through the RLS-respecting client (not service-role),
 * so even if middleware were ever misconfigured, the database's own
 * admin-only policy (migration 0003) is the real backstop — this is
 * the two-independent-layers pattern from the security assessment,
 * not a single point of trust.
 */

export async function GET() {
  const supabase = await createServerActionClient();

  const { data, error } = await supabase
    .from("organizations")
    .select("org_id, org_name, status, created_at")
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ organizations: data });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);

  // Strict schema check — reject unknown/extra fields rather than
  // silently accepting them (mass-assignment protection, per the
  // security assessment's API review).
  if (
    !body ||
    typeof body.org_name !== "string" ||
    body.org_name.trim().length < 2 ||
    Object.keys(body).length !== 1
  ) {
    return NextResponse.json(
      { error: "Expected { org_name: string } with no other fields" },
      { status: 400 }
    );
  }

  const orgName = body.org_name.trim();
  const plaintextCode = generateSecretCode();
  const secretCodeHash = await hashSecretCode(plaintextCode);

  const supabase = await createServerActionClient();

  const { data, error } = await supabase
    .from("organizations")
    .insert({ org_name: orgName, secret_code_hash: secretCodeHash })
    .select("org_id, org_name, status, created_at")
    .single();

  if (error) {
    // Postgres unique_violation on org_name
    if (error.code === "23505") {
      return NextResponse.json(
        { error: "An organization with this name already exists" },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // The plaintext code is returned exactly once, here, and never
  // stored or logged anywhere in plaintext — the Admin must copy it
  // now or rotate to get a new one later.
  return NextResponse.json(
    { organization: data, secret_code: plaintextCode },
    { status: 201 }
  );
}
