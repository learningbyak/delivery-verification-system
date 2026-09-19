"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function PortalLoginPage() {
  const router = useRouter();
  const [orgName, setOrgName] = useState("");
  const [secretCode, setSecretCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const supabase = createClient();

    // Portal has no individual login identity (per the confirmed
    // design) — a fresh anonymous Supabase Auth session stands in for
    // "this device, this shift." Nothing about the person is stored;
    // create_portal_session then attaches org scope to this session,
    // only after independently verifying the secret code.
    const { error: anonError } = await supabase.auth.signInAnonymously();
    if (anonError) {
      setLoading(false);
      setError("Could not start a session. Please try again.");
      return;
    }

    const { data: orgId, error: sessionError } = await supabase.rpc(
      "create_portal_session",
      { p_org_name: orgName, p_secret_code: secretCode }
    );

    setLoading(false);

    if (sessionError || !orgId) {
      // Clean up the now-orphaned anonymous session rather than
      // leaving it sitting around with no profile attached.
      await supabase.auth.signOut();
      setError("Invalid organization name or secret code.");
      return;
    }

    router.push("/portal");
    router.refresh();
  }

  return (
    <main style={{ fontFamily: "system-ui", maxWidth: 360, margin: "4rem auto", padding: "0 1rem" }}>
      <h1 style={{ fontSize: "1.25rem" }}>Delivery Scanning</h1>
      <form onSubmit={handleSubmit} style={{ display: "grid", gap: "0.75rem" }}>
        <label>
          Organization name
          <input
            type="text"
            required
            autoComplete="off"
            value={orgName}
            onChange={(e) => setOrgName(e.target.value)}
            style={{ display: "block", width: "100%", padding: "0.7rem", fontSize: "1rem" }}
          />
        </label>
        <label>
          Secret code
          <input
            type="text"
            required
            autoComplete="off"
            // Never remembered/autofilled — a BYOD device shouldn't
            // retain this beyond the active session.
            value={secretCode}
            onChange={(e) => setSecretCode(e.target.value)}
            style={{ display: "block", width: "100%", padding: "0.7rem", fontSize: "1rem", fontFamily: "monospace" }}
          />
        </label>
        {error && <p style={{ color: "crimson", margin: 0 }}>{error}</p>}
        <button type="submit" disabled={loading} style={{ padding: "0.8rem", fontSize: "1rem" }}>
          {loading ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </main>
  );
}
