"use client";

import { useState } from "react";

function generateStrongPassword(): string {
  const chars =
    "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%";
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => chars[b % chars.length]).join("");
}

export default function CreateClientAdminForm({ orgId }: { orgId: string }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState(generateStrongPassword());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ email: string; password: string } | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const res = await fetch(`/api/admin/orgs/${orgId}/users`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const body = await res.json();
    setLoading(false);

    if (!res.ok) {
      setError(body.error ?? "Something went wrong.");
      return;
    }

    setCreated({ email, password });
    setEmail("");
    setPassword(generateStrongPassword());
  }

  return (
    <div>
      <form onSubmit={handleSubmit} style={{ display: "grid", gap: "0.5rem", maxWidth: 360 }}>
        <label>
          Email
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            style={{ display: "block", width: "100%", padding: "0.5rem" }}
          />
        </label>
        <label>
          Password (auto-generated, editable)
          <input
            type="text"
            required
            minLength={12}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            style={{ display: "block", width: "100%", padding: "0.5rem", fontFamily: "monospace" }}
          />
        </label>
        <button type="submit" disabled={loading} style={{ padding: "0.5rem 1rem" }}>
          {loading ? "Creating…" : "Create Client Main Panel account"}
        </button>
      </form>

      {error && <p style={{ color: "crimson" }}>{error}</p>}

      {created && (
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
          <strong>Account created — share these credentials with the client now:</strong>
          <div style={{ marginTop: "0.5rem" }}>
            <div>Email: <code>{created.email}</code></div>
            <div>Password: <code>{created.password}</code></div>
          </div>
          <p style={{ fontSize: "0.85rem", color: "#666", margin: "0.5rem 0 0" }}>
            This password is not stored anywhere retrievable — if lost, you&apos;ll
            need to reset it via Supabase directly (a proper reset flow arrives
            in a later phase).
          </p>
        </div>
      )}
    </div>
  );
}
