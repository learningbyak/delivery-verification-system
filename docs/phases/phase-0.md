# Phase 0 — Foundations

**Goal:** a secure, empty skeleton. No features yet.

## What's built in this phase

- Next.js 14 (App Router) + TypeScript scaffold
- Supabase client split into two files with hard boundaries:
  - `src/lib/supabase/client.ts` — browser-safe, anon key only
  - `src/lib/supabase/server.ts` — server-only (`import "server-only"` enforced), the *only* place the service-role key is ever allowed
- ESLint rule that errors if any client component imports the server-only Supabase module
- `.env.example` with an explicit **safe vs. never-expose** split, matching the Security Assessment's Section 19
- `.gitignore` ensuring real `.env*` files are never committed
- RLS-by-default enforcement: `supabase/migrations/README.md` sets the rule, `scripts/check-rls.ts` enforces it in CI — a migration that creates a table without enabling RLS in the same file fails the build
- CI pipeline (`.github/workflows/ci.yml`): type-check, lint, the RLS check, and `npm audit` as a baseline dependency scan
- A placeholder page confirming the app runs

## What's deliberately NOT built yet

- No authentication (Phase 1)
- No real database tables (Phase 1 onward — this phase only sets up the *rule* that tables must ship with RLS)
- No security headers/CSP (Phase 6 — depends on external origins that don't exist yet)
- No rate limiting (Phase 6)
- No PDF parser service (Phase 2)
- No SAST tooling wired in yet (visible placeholder in CI, filled in Phase 6)

## Manual steps you'll need to do (require account access I don't have)

I can't create accounts or provision cloud resources on your behalf. Before Phase 1 can start for real, you'll need to:

1. **Create a Supabase project** (supabase.com) — note the project URL and anon key
2. Copy `.env.example` to `.env.local` and fill in:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY` (from Supabase project settings — treat this like a password)
3. **Create a GitHub repo** and push this code — the CI workflow activates automatically on push/PR
4. **Connect the repo to Vercel** for deployment — Vercel will need the same env vars added in its project settings (not committed to the repo)
5. Confirm in the Supabase dashboard that RLS enforcement is respected for the anon key — there's nothing to test yet since no tables exist, but worth confirming the project-level settings are as expected before Phase 1 adds real data

## Exit criteria

- [ ] `npm run typecheck`, `npm run lint`, and `npm run check:rls` all pass locally
- [ ] CI pipeline passes on a real push to GitHub
- [ ] App deploys successfully to a Vercel staging environment
- [ ] `.env.local` is populated from a real Supabase project and the app runs against it locally without errors
- [ ] Confirmed: no table exists anywhere without RLS enabled (trivially true right now — zero tables exist)

Once these are checked, tell me and we'll move to Phase 1 (Admin Panel core: organizations + departments, with real RLS policies).
