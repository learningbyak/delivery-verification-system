"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

// After ~8 seconds, most likely the PDF reader was asleep (it spins
// down after 15 minutes unused on its current free hosting tier) and
// is now waking up — worth telling the person that rather than
// leaving them staring at a spinner wondering if it's broken.
const SLOW_UPLOAD_HINT_MS = 8_000;

export default function UploadPage() {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [showSlowHint, setShowSlowHint] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    if (!loading) return;
    const timer = setTimeout(() => setShowSlowHint(true), SLOW_UPLOAD_HINT_MS);
    return () => clearTimeout(timer);
  }, [loading]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return;

    setError(null);
    setSuccess(null);
    setShowSlowHint(false);
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
      {loading && showSlowHint && (
        <p style={{ color: "#666", fontSize: "0.9rem" }}>
          Still working — if the PDF reader hasn&apos;t been used in a while, it can
          take up to a minute to wake up. No need to refresh, it&apos;s still going.
        </p>
      )}
      {error && <p style={{ color: "crimson" }}>{error}</p>}
      {success && <p style={{ color: "green" }}>{success}</p>}
    </main>
  );
}
