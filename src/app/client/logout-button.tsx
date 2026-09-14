"use client";

import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function ClientLogoutButton() {
  const router = useRouter();

  async function handleLogout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/client/login");
    router.refresh();
  }

  return (
    <button onClick={handleLogout} style={{ padding: "0.4rem 0.8rem" }}>
      Sign out
    </button>
  );
}
