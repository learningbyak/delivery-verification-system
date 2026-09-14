import { notFound } from "next/navigation";
import { createServerActionClient } from "@/lib/supabase/server";
import DepartmentManager from "./department-manager";
import RotateSecretCode from "./rotate-secret-code";
import CreateClientAdminForm from "./create-client-admin-form";

// Same reasoning as /admin/page.tsx — session-scoped, RLS-filtered
// data must never be statically cached.
export const dynamic = "force-dynamic";

export default async function OrgDetailPage({
  params,
}: {
  params: Promise<{ orgId: string }>;
}) {
  const { orgId } = await params;
  const supabase = await createServerActionClient();

  const { data: org } = await supabase
    .from("organizations")
    .select("org_id, org_name, status, created_at")
    .eq("org_id", orgId)
    .single();

  if (!org) {
    notFound();
  }

  const { data: departments } = await supabase
    .from("departments")
    .select("department_id, department_name, source_dept_code, created_at")
    .eq("org_id", orgId)
    .order("department_name");

  return (
    <main style={{ display: "grid", gap: "2rem", maxWidth: 640 }}>
      <section>
        <h1 style={{ fontSize: "1.25rem" }}>{org.org_name}</h1>
        <p style={{ color: "#666" }}>Status: {org.status}</p>
        <RotateSecretCode orgId={org.org_id} />
      </section>

      <section>
        <h2 style={{ fontSize: "1.05rem" }}>Departments</h2>
        <DepartmentManager orgId={org.org_id} initialDepartments={departments ?? []} />
      </section>

      <section>
        <h2 style={{ fontSize: "1.05rem" }}>Client Main Panel access</h2>
        <p style={{ color: "#666", fontSize: "0.9rem" }}>
          Per Option A: only Admin can create these accounts — there is no
          self-service signup.
        </p>
        <CreateClientAdminForm orgId={org.org_id} />
      </section>
    </main>
  );
}
