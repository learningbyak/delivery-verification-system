import Link from "next/link";
import { createServerActionClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function PortalDepartmentsPage() {
  const supabase = await createServerActionClient();

  const { data: departments, error } = await supabase
    .from("departments")
    .select("department_id, department_name")
    .order("department_name");

  return (
    <main style={{ maxWidth: 420 }}>
      <h1 style={{ fontSize: "1.15rem" }}>Select a Department</h1>

      {error && <p style={{ color: "crimson" }}>{error.message}</p>}

      {departments && departments.length === 0 && (
        <p style={{ color: "#666" }}>No departments set up yet.</p>
      )}

      <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: "0.6rem", marginTop: "1rem" }}>
        {(departments ?? []).map((dept) => (
          <li key={dept.department_id}>
            <Link
              href={`/portal/${dept.department_id}`}
              style={{
                display: "block",
                padding: "1rem",
                border: "1px solid #ddd",
                borderRadius: 8,
                fontSize: "1.05rem",
                textAlign: "center",
              }}
            >
              {dept.department_name}
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
