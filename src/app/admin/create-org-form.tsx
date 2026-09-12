"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function CreateOrgForm() {
  const router = useRouter();
  const [orgName, setOrgName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createdCode, setCreatedCode] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setCreatedCode(null);
    setLoading(true);

    const res = await fetch("/api/admin/orgs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ org_name: orgName }),
    });
    const body = await res.json();

    setLoading(false);

    if (!res.ok) {
      setError(body.error ?? "Something went wrong.");
      return;
    }

    setCreatedCode(body.secret_code);
    setOrgName("");
    router.refresh();
  }

  return (
    <div>
      <form onSubmit={handleSubmit} style={{ display: "flex", gap: "0.5rem" }}>
        <input
          type="text"
          placeholder="Organization name"
          required
          value={orgName}
          onChange={(e) => setOrgName(e.target.value)}
          style={{ padding: "0.5rem", flex: 1 }}
        />
        <button type="submit" disabled={loading} style={{ padding: "0.5rem 1rem" }}>
          {loading ? "Creating…" : "Create"}
        </button>
      </form>

      {error && <p style={{ color: "crimson" }}>{error}</p>}

      {createdCode && (
        <div
          role="alert"
          style={{
            marginTop: "0.75rem",
            padding: "0.75rem 1rem",
            background: "#fffbe6",
            border: "1px solid #e6c200",
            borderRadius: 6,
          }}
        >
          <strong>Secret code (shown once — copy it now):</strong>
          <div style={{ fontFamily: "monospace", fontSize: "1.1rem", marginTop: "0.25rem" }}>
            {createdCode}
          </div>
          <p style={{ fontSize: "0.85rem", color: "#666", margin: "0.5rem 0 0" }}>
            This code will not be shown again. If it is lost, rotate it from
            the organization&apos;s page to generate a new one.
          </p>
        </div>
      )}
    </div>
  );
}
