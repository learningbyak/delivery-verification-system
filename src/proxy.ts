import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

/**
 * Protects every /admin/* route except /admin/login.
 *
 * (Next.js 16 renamed the "middleware" file convention to "proxy" —
 * this file was updated accordingly; same runtime behavior.)
 *
 * This is a server-side check, not a UI convenience — per the
 * security assessment: "frontend authorization is not a security
 * boundary." Even if this proxy were somehow skipped, every
 * individual API route and RLS policy independently re-verifies role
 * and org scope (defense in depth) — this file exists purely to
 * give unauthenticated/wrong-role users a clean redirect instead of a
 * confusing in-page error.
 */
export async function proxy(request: NextRequest) {
  const response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name) {
          return request.cookies.get(name)?.value;
        },
        set(name, value, options) {
          response.cookies.set({ name, value, ...options });
        },
        remove(name, options) {
          response.cookies.set({ name, value: "", ...options });
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const pathname = request.nextUrl.pathname;
  const isLoginPage = pathname === "/admin/login";
  const isApiRoute = pathname.startsWith("/api/admin");

  if (!user && !isLoginPage) {
    if (isApiRoute) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }
    return NextResponse.redirect(new URL("/admin/login", request.url));
  }

  if (user && !isLoginPage) {
    // Confirmed authenticated — now confirm they're actually an admin.
    // RLS's self_select_profile policy allows a user to read their own
    // row, so this query works under the anon+session client (no
    // service-role needed here).
    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();

    if (profile?.role !== "admin") {
      if (isApiRoute) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      return NextResponse.redirect(new URL("/admin/login", request.url));
    }
  }

  if (user && isLoginPage) {
    // Already logged in — no reason to show the login page again.
    return NextResponse.redirect(new URL("/admin", request.url));
  }

  return response;
}

export const config = {
  matcher: ["/admin/:path*", "/api/admin/:path*"],
};
