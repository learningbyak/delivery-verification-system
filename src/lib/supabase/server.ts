import "server-only";
/**
 * Server-only Supabase client.
 *
 * The `import "server-only"` above is not decorative — it causes a build
 * failure if any client component ever imports this file, even
 * transitively. This is the ONLY module in the codebase permitted to
 * reference SUPABASE_SERVICE_ROLE_KEY.
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
 * Not implemented yet on purpose — Phase 0 has no trusted server jobs
 * that need it. When a real use case exists (e.g. Phase 2's PDF
 * ingestion writer), implement it here with a comment explaining
 * exactly why RLS must be bypassed for that specific operation, and
 * keep the scope as narrow as possible.
 */
export function createServiceRoleClient(): never {
  throw new Error(
    "Service-role client not implemented in Phase 0 — see comment above " +
      "createServiceRoleClient in src/lib/supabase/server.ts before adding it."
  );
}
