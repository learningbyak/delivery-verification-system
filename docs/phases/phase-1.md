# Phase 1 — Admin Panel Core

**Goal:** Admin can log in, create organizations, rotate their secret codes, and manage departments. Real RLS policies, enforced and tested. No client-facing login yet.

## What's built in this phase

- **Database:** 4 migrations — `organizations`, `profiles` (links a Supabase Auth user to a role + org), RLS-checking helper functions (`current_user_role()`, `current_user_org_id()`), and `departments`. Every table's RLS policies are admin-scoped (departments also pre-account for `client_admin`, arriving in Phase 2).
- **Auth:** Supabase Auth email/password for Admin. A `proxy.ts` (Next.js 16's renamed `middleware.ts`) protects every `/admin/*` page and `/api/admin/*` route server-side — redirecting/blocking non-admins before they reach any page or handler.
- **Bootstrap script:** `npm run create-admin -- you@email.com "password"` — the one sanctioned use of the service-role key in this phase, since the first admin can't exist yet to authenticate as.
- **Admin UI:** login page, dashboard (create/list organizations, one-time secret code display), org detail page (rename/suspend org, rotate secret code, full department CRUD).
- **API routes:** all under `/api/admin/*`, each independently re-verifying authorization via RLS (not just trusting `proxy.ts`) — defense in depth, per the security assessment.

## Design decisions worth knowing about

- **Role/org lookup via a `profiles` table + SQL helper functions, not custom JWT claims.** The alternative (embedding `role`/`org_id` directly in the JWT) requires configuring a "Custom Access Token Hook" in the Supabase Dashboard — an extra manual, account-level step. The `profiles` table approach is fully expressible in SQL migrations, so it's testable and reproducible without touching the Dashboard. Tradeoff: one extra query per request (looking up the profile) instead of reading a JWT claim directly — acceptable at this scale.
- **Secret codes are hashed with bcrypt, generated from an unambiguous character set** (no `0/O`, `1/I/l`) since these get read aloud or typed on a phone.
- **A documented, verified limitation:** `server.ts`'s docstring explains that Next.js 16 does *not* reliably produce a loud build error if a client component ever imports the server-only Supabase client — it gets silently excluded from the browser bundle instead (verified directly against compiled output). Safe outcome, but a silent safeguard, not a loud one. Worth remembering in every future phase that touches this boundary.

## Database setup — do this in your Supabase project

Since I can't run migrations against your actual Supabase project, run these yourself:

1. In your Supabase project dashboard, go to **SQL Editor**.
2. Open each file in `supabase/migrations/`, **in order** (`0001_...` through `0004_...`), and run its contents — one file per query, in sequence. Confirm each succeeds before running the next.
3. Create your first Admin account by running, in your terminal (with `.env.local` filled in):
   ```bash
   npm run create-admin -- you@email.com "a-strong-password"
   ```
4. Go to `/admin/login` on your running app and log in with that email/password.

## Manual testing checklist

- [ ] Visiting `/admin` while logged out redirects to `/admin/login`
- [ ] Logging in with the admin account created by the bootstrap script succeeds and lands on `/admin`
- [ ] Creating an organization shows a one-time secret code, and that code is **not** visible anywhere after refreshing the page
- [ ] Creating a second organization with the same name is rejected (unique constraint)
- [ ] Adding, renaming, and deleting a department all work and persist after a page refresh
- [ ] Rotating an org's secret code generates a new one-time code
- [ ] Directly querying `organizations` or `departments` in the Supabase SQL editor **as the anon role** (not your own logged-in session) returns zero rows — confirms RLS is actually denying access, not just the app UI hiding it

## Exit criteria

- [ ] `npm run typecheck`, `npm run lint`, `npm run check:rls`, and `npm audit --audit-level=high` all pass
- [ ] `npm run build` succeeds
- [ ] All four migrations applied successfully to your real Supabase project, in order
- [ ] First admin account created via the bootstrap script and confirmed working
- [ ] Every item in the manual testing checklist above confirmed by hand

Once these are checked, tell me and we'll move to Phase 2 (Client Main Panel auth + PDF ingestion).
