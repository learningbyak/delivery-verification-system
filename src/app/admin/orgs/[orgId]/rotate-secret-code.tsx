"use client";

import { useState } from "react";

export default function RotateSecretCode({ orgId }: { orgId: string }) {
  const [loading, setLoading] = useState(false);
  const [code, setCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleRotate() {
    if (
      code &&
      !confirm(
        "Generate a new secret code? The current code will stop working immediately."
      )
    ) {
      return;
    }
    setLoading(true);
    setError(null);

    const res = await fetch(`/api/admin/orgs/${orgId}/secret-code`, {
      method: "POST",
    });
    const body = await res.json();
    setLoading(false);

    if (!res.ok) {
      setError(body.error ?? "Something went wrong.");
      return;
    }
    setCode(body.secret_code);
  }

  return (
    <div style={{ marginTop: "0.75rem" }}>
      <button onClick={handleRotate} disabled={loading} style={{ padding: "0.5rem 1rem" }}>
        {loading ? "Generating…" : code ? "Generate new code" : "Generate secret code"}
      </button>

      {error && <p style={{ color: "crimson" }}>{error}</p>}

      {code && (
        <div
          role="alert"
          style={{
            marginTop: "0.75rem",
            padding: "0.75rem 1rem",
            background: "#fffbe6",
            border: "1px solid #e6c200",
            borderRadius: 6,
            maxWidth: 400,
          }}
        >
          <strong>Secret code (shown once — copy it now):</strong>
          <div style={{ fontFamily: "monospace", fontSize: "1.1rem", marginTop: "0.25rem" }}>
            {code}
          </div>
        </div>
      )}
    </div>
  );
}
