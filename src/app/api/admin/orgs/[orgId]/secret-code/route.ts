import { NextResponse } from "next/server";
import { createServerActionClient } from "@/lib/supabase/server";
import { generateSecretCode, hashSecretCode } from "@/lib/secret-code";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ orgId: string }> }
) {
  const { orgId } = await params;

  const plaintextCode = generateSecretCode();
  const secretCodeHash = await hashSecretCode(plaintextCode);

  const supabase = await createServerActionClient();

  const { data, error } = await supabase
    .from("organizations")
    .update({ secret_code_hash: secretCodeHash })
    .eq("org_id", orgId)
    .select("org_id, org_name")
    .single();

  if (error) {
    return NextResponse.json({ error: "Organization not found" }, { status: 404 });
  }

  // Rotating the code immediately invalidates every previously-issued
  // Client Portal session for this org (once Phase 3 implements
  // Portal auth) — this is the intended, documented behavior for
  // revoking a leaked code.
  return NextResponse.json({
    organization: data,
    secret_code: plaintextCode,
  });
}
