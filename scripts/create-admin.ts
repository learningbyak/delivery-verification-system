/**
 * One-time bootstrap: creates the first Admin account.
 *
 * WHY THIS NEEDS THE SERVICE-ROLE KEY:
 * Every other admin action in this app goes through RLS as the
 * authenticated admin user (see src/lib/supabase/server.ts). But the
 * *very first* admin can't exist yet to authenticate as — there's a
 * chicken-and-egg problem: inserting a profiles row with role='admin'
 * requires current_user_role() = 'admin' to already be true (see
 * migration 0002), which is impossible before any admin exists.
 *
 * This script is the one, narrow, intentional exception: it runs
 * locally (never as part of the deployed app, never exposed as an API
 * route), uses the service-role key to bypass RLS for exactly two
 * inserts, and is meant to be run once per environment.
 *
 * Usage:
 *   npx tsx scripts/create-admin.ts your@email.com "a-strong-password"
 */
import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

async function main() {
  const [email, password] = process.argv.slice(2);

  if (!email || !password) {
    console.error('Usage: npx tsx scripts/create-admin.ts <email> "<password>"');
    process.exit(1);
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    console.error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local"
    );
    process.exit(1);
  }

  // Service-role client — deliberately created only here, never
  // exported from a shared module, so it can't accidentally get
  // imported into app code. See src/lib/supabase/server.ts for the
  // rule this script is the sanctioned exception to.
  const supabase = createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  console.log(`Creating auth user for ${email}...`);
  const { data: userData, error: userError } =
    await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });

  if (userError || !userData.user) {
    console.error("Failed to create auth user:", userError?.message);
    process.exit(1);
  }

  console.log(`Creating admin profile for user ${userData.user.id}...`);
  const { error: profileError } = await supabase.from("profiles").insert({
    id: userData.user.id,
    role: "admin",
    org_id: null,
  });

  if (profileError) {
    console.error("Failed to create admin profile:", profileError.message);
    console.error(
      "The auth user was created but has no admin profile — you may " +
        "need to clean it up manually in the Supabase dashboard before retrying."
    );
    process.exit(1);
  }

  console.log("\n✅ Admin account created.");
  console.log(`   Email: ${email}`);
  console.log("   You can now log in at /admin/login with this email and password.");
}

main();
