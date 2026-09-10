/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Security headers (HSTS, CSP, Permissions-Policy, etc.) are intentionally
  // NOT configured here yet. They depend on the final set of external origins
  // (Supabase project URL, parser service) which don't exist until later
  // phases. Full header policy is added in Phase 6 — see
  // docs/security/production-gate.md.
};

module.exports = nextConfig;
