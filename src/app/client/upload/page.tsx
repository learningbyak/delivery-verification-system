"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function UploadPage() {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return;

    setError(null);
    setSuccess(null);
    setLoading(true);

    const formData = new FormData();
    formData.append("file", file);

    const res = await fetch("/api/client/upload", {
      method: "POST",
      body: formData,
    });
    const body = await res.json();
    setLoading(false);

    if (!res.ok) {
      setError(body.error ?? "Upload failed.");
      return;
    }

    setSuccess(
      `Uploaded invoice ${body.invoice_number} — ${body.department_orders_created} department section(s) created.`
    );
    setFile(null);
    router.refresh();
  }

  return (
    <main style={{ maxWidth: 480 }}>
      <h1 style={{ fontSize: "1.25rem" }}>Upload Invoice</h1>
      <form onSubmit={handleSubmit} style={{ display: "grid", gap: "0.75rem", marginTop: "1rem" }}>
        <input
          type="file"
          accept="application/pdf"
          required
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
        <button type="submit" disabled={loading || !file} style={{ padding: "0.6rem" }}>
          {loading ? "Uploading and parsing…" : "Upload"}
        </button>
      </form>
      {error && <p style={{ color: "crimson" }}>{error}</p>}
      {success && <p style={{ color: "green" }}>{success}</p>}
    </main>
  );
}
