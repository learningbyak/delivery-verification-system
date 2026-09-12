import nextConfig from "eslint-config-next";

// Note: we deliberately do NOT add a custom no-restricted-imports rule
// for src/lib/supabase/server.ts here. An ESLint rule blocking that
// import path by name would also block its legitimate server-side
// usage (API routes, server components), which is wrong — it can't
// tell "used from a Server Component" apart from "used from a Client
// Component" just by import path.
//
// Instead, src/lib/supabase/server.ts relies on the `server-only`
// package + Next.js's client/server boundary. Verified directly
// against compiled build output (see that file's docstring): a bad
// import from a client component does NOT reach the browser bundle,
// but it also does NOT reliably fail the build with a loud error —
// Next.js 16 silently tree-shook it out in testing instead. Treat
// that as a silent safeguard, not a loud one; correct usage (only
// from Server Components/Route Handlers) is enforced by code review,
// not tooling, for now.

const eslintConfig = [...nextConfig];

export default eslintConfig;
