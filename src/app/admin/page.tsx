import Link from "next/link";
import { createServerActionClient } from "@/lib/supabase/server";
import CreateOrgForm from "./create-org-form";

// This page reads session-scoped, RLS-filtered data — it must be
// rendered fresh on every request, never statically cached. Without
// this, Next.js could attempt to prerender it once and serve stale
// or (worse) cross-session data.
export const dynamic = "force-dynamic";

export default async function AdminDashboard() {
  const supabase = await createServerActionClient();

  const { data: organizations, error } = await supabase
    .from("organizations")
    .select("org_id, org_name, status, created_at")
    .order("created_at", { ascending: false });

  return (
    <main style={{ display: "grid", gap: "2rem", maxWidth: 640 }}>
      <section>
        <h1 style={{ fontSize: "1.25rem" }}>Organizations</h1>
        {error && <p style={{ color: "crimson" }}>{error.message}</p>}
        {organizations && organizations.length === 0 && (
          <p style={{ color: "#666" }}>No organizations yet — create one below.</p>
        )}
        {organizations && organizations.length > 0 && (
          <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: "0.5rem" }}>
            {organizations.map((org) => (
              <li
                key={org.org_id}
                style={{
                  border: "1px solid #ddd",
                  borderRadius: 6,
                  padding: "0.75rem 1rem",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <div>
                  <Link href={`/admin/orgs/${org.org_id}`}>{org.org_name}</Link>
                  <div style={{ fontSize: "0.85rem", color: "#666" }}>
                    {org.status}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 style={{ fontSize: "1.05rem" }}>Create organization</h2>
        <CreateOrgForm />
      </section>
    </main>
  );
}
