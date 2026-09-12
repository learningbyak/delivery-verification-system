# Delivery Verification System

A multi-tenant web application for verifying grocery/retail deliveries against invoices — barcode scanning, live delivery-status tracking, and organization-scoped data isolation, built on Next.js and Supabase.

**Current status: Phase 1 of 9 — Admin Panel core.** See [`docs/phases/`](./docs/phases) for the full roadmap and exactly what is and isn't built yet.

---

## What this is

Three access levels, one codebase:

| Module | Who | What they do |
|---|---|---|
| **Admin Panel** | Internal operators | Manage every client organization, departments, and secret codes |
| **Client Main Panel** | A client's own manager | Manage their own organization only — upload invoices, view delivery status |
| **Client Portal** | Front-line dock staff | Log in with an org code, scan barcodes on a personal phone, no access to status data |

Every organization's data is isolated at the database level via PostgreSQL Row-Level Security — not just application-layer checks. See [`docs/security/`](./docs/security) for the full security assessment this project is built against.

## Tech stack

- **Framework:** Next.js 16 (App Router, TypeScript)
- **Database & Auth:** Supabase (PostgreSQL, Row-Level Security, Auth, Realtime, Storage)
- **Hosting:** Vercel
- **Secret handling:** bcrypt-hashed org secret codes, service-role key confined to one file, never bundled client-side

## Getting started

### Prerequisites

- Node.js 20+
- A free [Supabase](https://supabase.com) project
- A free [Vercel](https://vercel.com) account (for deployment)

### Local setup

```bash
git clone <your-repo-url>
cd delivery-verification-system
npm install
cp .env.example .env.local   # then fill in your Supabase project's keys
```

Run the SQL files in [`supabase/migrations/`](./supabase/migrations) against your Supabase project, in numeric order, via the Supabase SQL Editor.

Create your first Admin account:

```bash
npm run create-admin -- you@example.com "a-strong-password"
```

Start the dev server:

```bash
npm run dev
```

Visit `http://localhost:3000/admin/login`.

Full, from-scratch, beginner-friendly setup instructions (including creating GitHub/Supabase/Vercel accounts): see [`docs/setup/from-scratch.md`](./docs/setup/from-scratch.md).

## Available scripts

| Command | What it does |
|---|---|
| `npm run dev` | Start the local development server |
| `npm run build` | Production build |
| `npm run typecheck` | TypeScript type-checking |
| `npm run lint` | ESLint |
| `npm run check:rls` | Fails if any migration creates a table without enabling Row-Level Security |
| `npm run create-admin -- <email> <password>` | One-time bootstrap: creates the first Admin account |

All of the above (except `create-admin`, which is a local-only, one-time setup step) run automatically in CI on every push and pull request — see [`.github/workflows/ci.yml`](./.github/workflows/ci.yml).

## Project structure

```
src/
  app/
    admin/                Admin Panel pages (login, dashboard, org detail)
    api/admin/             Admin API routes
  lib/
    supabase/
      client.ts            Browser-safe Supabase client (anon key only)
      server.ts             Server-only client — the only file permitted
                             to reference the service-role key
    secret-code.ts          Org secret code generation + hashing
  proxy.ts                  Route protection for /admin and /api/admin
supabase/
  migrations/                SQL migrations — RLS required on every table,
                             enforced by scripts/check-rls.ts in CI
scripts/
  check-rls.ts               CI enforcement script (see above)
  create-admin.ts            One-time bootstrap script
docs/
  phases/                    Phase-by-phase scope and exit criteria
  upgrades/                  Step-by-step upgrade guide between each phase
  security/                  Pre-production security assessment
```

## Security

This project is built directly against a written security assessment covering multi-tenant isolation, authentication, API-by-API review, and a pre-production checklist — see [`docs/security/assessment.md`](./docs/security/assessment.md). The short version, enforced throughout: **every server-side operation derives its organization scope from the authenticated session, never from a client-supplied parameter** — and Row-Level Security is a second, independent backstop for that same rule, not a substitute for it.

## Roadmap

Built in phases, each one shippable and testable on its own — see [`docs/phases/`](./docs/phases) for the complete plan:

- [x] **Phase 0** — Foundations (secure empty skeleton, CI, RLS-by-default enforcement)
- [x] **Phase 1** — Admin Panel core (organizations, departments, real RLS policies)
- [ ] **Phase 2** — Client Main Panel auth + PDF invoice ingestion
- [ ] **Phase 3** — Client Portal + barcode scanning core loop
- [ ] **Phase 4** — Real-time updates + export
- [ ] **Phase 5** — Admin activity feed + invoice locking
- [ ] **Phase 6** — Security hardening pass (rate limiting, headers, logging)
- [ ] **Phase 7** — BYOD/PWA polish
- [ ] **Phase 8** — Pre-production review
- [ ] **Phase 9** — Post-launch (multi-supplier support, scaling)

## License

Private/proprietary — not yet licensed for external use.
