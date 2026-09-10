/**
 * Browser-safe Supabase client.
 *
 * SECURITY: this file must NEVER import or reference
 * SUPABASE_SERVICE_ROLE_KEY. Only NEXT_PUBLIC_* variables are permitted
 * here, because this module is bundled into client-side JavaScript.
 * The service-role key belongs exclusively in
 * `src/lib/supabase/server.ts`, which must never be imported from a
 * "use client" component.
 *
 * RLS is what actually protects data when this client is used — the
 * anon key is intentionally public and safe to ship to the browser.
 */
import { createBrowserClient } from "@supabase/ssr";

export function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY. " +
        "Check your .env.local against .env.example."
    );
  }

  return createBrowserClient(url, anonKey);
}
