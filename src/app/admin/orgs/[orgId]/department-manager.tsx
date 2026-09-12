"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Department = {
  department_id: string;
  department_name: string;
  source_dept_code: string | null;
  created_at: string;
};

export default function DepartmentManager({
  orgId,
  initialDepartments,
}: {
  orgId: string;
  initialDepartments: Department[];
}) {
  const router = useRouter();
  const [newName, setNewName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const res = await fetch(`/api/admin/orgs/${orgId}/departments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ department_name: newName }),
    });
    const body = await res.json();
    setLoading(false);

    if (!res.ok) {
      setError(body.error ?? "Something went wrong.");
      return;
    }

    setNewName("");
    router.refresh();
  }

  async function handleRename(deptId: string, currentName: string) {
    const nextName = prompt("New department name:", currentName);
    if (!nextName || nextName.trim() === currentName) return;

    const res = await fetch(`/api/admin/departments/${deptId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ department_name: nextName.trim() }),
    });

    if (!res.ok) {
      const body = await res.json();
      alert(body.error ?? "Rename failed.");
      return;
    }
    router.refresh();
  }

  async function handleDelete(deptId: string, name: string) {
    if (!confirm(`Delete "${name}"? This cannot be undone.`)) return;

    const res = await fetch(`/api/admin/departments/${deptId}`, {
      method: "DELETE",
    });

    if (!res.ok) {
      const body = await res.json();
      alert(body.error ?? "Delete failed.");
      return;
    }
    router.refresh();
  }

  return (
    <div>
      {initialDepartments.length === 0 && (
        <p style={{ color: "#666" }}>No departments yet — add one below.</p>
      )}
      {initialDepartments.length > 0 && (
        <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: "0.5rem" }}>
          {initialDepartments.map((dept) => (
            <li
              key={dept.department_id}
              style={{
                border: "1px solid #ddd",
                borderRadius: 6,
                padding: "0.5rem 1rem",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <span>{dept.department_name}</span>
              <span style={{ display: "flex", gap: "0.5rem" }}>
                <button
                  onClick={() => handleRename(dept.department_id, dept.department_name)}
                  style={{ padding: "0.25rem 0.6rem" }}
                >
                  Rename
                </button>
                <button
                  onClick={() => handleDelete(dept.department_id, dept.department_name)}
                  style={{ padding: "0.25rem 0.6rem" }}
                >
                  Delete
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={handleAdd} style={{ display: "flex", gap: "0.5rem", marginTop: "1rem" }}>
        <input
          type="text"
          placeholder="New department name"
          required
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          style={{ padding: "0.5rem", flex: 1 }}
        />
        <button type="submit" disabled={loading} style={{ padding: "0.5rem 1rem" }}>
          {loading ? "Adding…" : "Add department"}
        </button>
      </form>
      {error && <p style={{ color: "crimson" }}>{error}</p>}
    </div>
  );
}
