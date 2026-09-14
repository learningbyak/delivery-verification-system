import "server-only";
/**
 * Server-only Supabase client.
 *
 * SECURITY: this is the ONLY module in the codebase permitted to
 * reference SUPABASE_SERVICE_ROLE_KEY.
 *
 * The `import "server-only"` above, combined with Next.js's
 * client/server component boundary, causes code from this module to
 * be excluded from client-side JavaScript bundles — this was verified
 * directly against real compiled build output, not assumed. However:
 * it is NOT guaranteed to produce a loud build ERROR if a client
 * component imports this file. In testing against Next.js 16, a
 * deliberate bad import was silently tree-shaken out of the client
 * bundle rather than failing the build. The safety property that
 * actually matters — service-role-adjacent code never reaching the
 * browser — held either way, but treat this as a silent safeguard,
 * not a loud one. Don't rely on "the build will tell me" as the only
 * defense; code review and keeping this file's usage confined to
 * Server Components and Route Handlers are the primary defenses.
 *
 * SECURITY RULES for anyone extending this file in a later phase:
 *   1. Never export the service-role client for use in code that runs
 *      per-request on behalf of an end user's own actions — that path
 *      should use the RLS-respecting client (createServerActionClient
 *      below), not this one, so a bug can't silently bypass RLS.
 *   2. The service-role client is for trusted, narrowly-scoped
 *      server-side jobs only (e.g. the PDF ingestion write, or
 *      cross-org Admin queries that are *intentionally* unscoped) —
 *      never as a default/convenience client.
 *   3. createServerActionClient() is async (Next.js 15+ requires
 *      awaiting cookies()) — every call site must `await` it.
 */
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

/**
 * RLS-respecting server client. Use this for nearly everything —
 * it authenticates as the actual signed-in user, so Postgres RLS
 * policies apply exactly as they would for that user.
 */
export async function createServerActionClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error("Missing Supabase public env vars — check .env.example.");
  }

  // Next.js 15+ made cookies() async — this function is now async too.
  // Every call site must be updated to `await createServerActionClient()`.
  const cookieStore = await cookies();

  return createServerClient(url, anonKey, {
    cookies: {
      get(name: string) {
        return cookieStore.get(name)?.value;
      },
      set(name: string, value: string, options: CookieOptions) {
        cookieStore.set({ name, value, ...options });
      },
      remove(name: string, options: CookieOptions) {
        cookieStore.set({ name, value: "", ...options });
      },
    },
  });
}

/**
 * Service-role client. Bypasses RLS entirely.
 *
 * Implemented in Phase 2 for exactly one real use case: Admin creating
 * a Client Main Panel account (POST /api/admin/orgs/:orgId/users).
 * This needs to create a Supabase Auth user via the admin API, which
 * requires service-role — there's no RLS-respecting way to create
 * another person's auth credentials.
 *
 * Callers of this function MUST independently verify the caller is an
 * admin BEFORE calling it — this client has no awareness of who's
 * asking, since bypassing RLS means Postgres can't enforce that for
 * you. In this codebase, that check happens in proxy.ts (blocks
 * non-admin requests to /api/admin/* before they're even routed) AND
 * again explicitly inside each route handler that uses this client —
 * defense in depth, per docs/security/assessment.md.
 */
export function createServiceRoleClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY."
    );
  }

  return createSupabaseClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
