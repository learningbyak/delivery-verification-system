"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function ClientLoginPage() {
  const router = useRouter();
  const [orgName, setOrgName] = useState("");
  const [secretCode, setSecretCode] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const supabase = createClient();

    // Step 1: prove knowledge of this org's secret code, via a
    // narrow SECURITY DEFINER function that returns org_id or
    // nothing — see supabase/migrations/0005_verify_org_secret_code.sql.
    // Deliberately generic error message: never reveal whether the
    // org name exists vs. the code was wrong (enumeration resistance).
    const { data: verifiedOrgId, error: verifyError } = await supabase.rpc(
      "verify_org_secret_code",
      { p_org_name: orgName, p_secret_code: secretCode }
    );

    if (verifyError || !verifiedOrgId) {
      setLoading(false);
      setError("Invalid organization name or secret code.");
      return;
    }

    // Step 2: sign in with personal credentials.
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (signInError) {
      setLoading(false);
      setError("Invalid email or password.");
      return;
    }

    // Step 3: confirm this account is really a Client Main Panel
    // account for the org just verified. Not a hard security
    // requirement (RLS scopes their data via their own profile
    // regardless of what was typed here) — but catching a mismatch
    // here prevents a confusing "logged in, but this looks wrong"
    // experience rather than silently proceeding.
    const {
      data: { user },
    } = await supabase.auth.getUser();

    const { data: profile } = await supabase
      .from("profiles")
      .select("role, org_id")
      .eq("id", user?.id ?? "")
      .single();

    setLoading(false);

    if (profile?.role !== "client_admin" || profile.org_id !== verifiedOrgId) {
      await supabase.auth.signOut();
      setError(
        "This account is not a Client Main Panel account for this organization."
      );
      return;
    }

    router.push("/client");
    router.refresh();
  }

  return (
    <main style={{ fontFamily: "system-ui", maxWidth: 380, margin: "4rem auto" }}>
      <h1 style={{ fontSize: "1.25rem" }}>Client Main Panel Login</h1>
      <form onSubmit={handleSubmit} style={{ display: "grid", gap: "0.75rem" }}>
        <label>
          Organization name
          <input
            type="text"
            required
            value={orgName}
            onChange={(e) => setOrgName(e.target.value)}
            style={{ display: "block", width: "100%", padding: "0.5rem" }}
          />
        </label>
        <label>
          Secret code
          <input
            type="text"
            required
            value={secretCode}
            onChange={(e) => setSecretCode(e.target.value)}
            style={{ display: "block", width: "100%", padding: "0.5rem", fontFamily: "monospace" }}
          />
        </label>
        <label>
          Email
          <input
            type="email"
            required
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            style={{ display: "block", width: "100%", padding: "0.5rem" }}
          />
        </label>
        <label>
          Password
          <input
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            style={{ display: "block", width: "100%", padding: "0.5rem" }}
          />
        </label>
        {error && <p style={{ color: "crimson", margin: 0 }}>{error}</p>}
        <button type="submit" disabled={loading} style={{ padding: "0.6rem" }}>
          {loading ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </main>
  );
}
