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
