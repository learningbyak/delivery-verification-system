# Delivery Verification System — Phased Development Plan

**Approach:** each phase produces something real and testable on its own — never a rewrite of a prior phase, only additions on top. Security controls tied to a specific phase's feature are built *in* that phase, not bolted on at the end (only the final cross-cutting hardening pass is separate, on purpose).

I'm not starting any phase yet — this is the roadmap. Tell me which phase to begin with.

---

## Phase 0 — Foundations
**Goal:** a secure, empty skeleton. No features yet.

- Repo setup, Next.js + TypeScript scaffold
- Supabase project provisioned; RLS **enabled by default on every table** from the first migration, even before those tables have real policies
- Secrets management in place (env vars, service-role key never touching client code) — verified, not assumed
- Basic CI: lint, type-check, dependency scanning (SCA) wired in from day one
- Deployment pipeline to a staging environment on Vercel

**Exit criteria:** an empty app deploys securely; no table exists without RLS turned on.

---

## Phase 1 — Admin Panel Core
**Goal:** Admin can create and manage organizations.

- Admin auth (email + password via Supabase Auth)
- `organizations` and `departments` tables + RLS policies (Section 6 of the security assessment)
- Admin CRUD: create org, set/rotate secret code (hashed), create/rename departments
- No client-facing login yet — Admin only

**Exit criteria:** Admin can create an org and departments; RLS verified to block any non-admin access, since Client roles don't exist yet to test against directly — verify via direct Supabase queries with a fake non-admin JWT.

---

## Phase 2 — Client Main Panel + PDF Ingestion
**Goal:** upload an invoice, see it become a structured, department-split sheet.

- Client Main Panel auth (org + secret code + individual username/password)
- PDF parser microservice (Python/FastAPI/pdfplumber) tuned to the Loblaws template, network-isolated from day one (Section 11)
- Upload endpoint → parses → creates `upload_batches`, `department_orders`, `delivery_line_items`
- Status sheet view (read-only at this stage — no scanning yet, so all lines show the supplier-reported baseline)
- RLS policies for the new tables, including the `EXISTS`-join pattern for line items

**Exit criteria:** a real sample invoice uploads correctly, splits into the right departments, and Client Main Panel for Org A cannot see Org B's uploads (tested directly, not assumed).

---

## Phase 3 — Client Portal + Core Scanning Loop
**Goal:** the actual product — scan a barcode, see delivered_qty update.

- Portal login (org + secret code), department selection, invoice-date list, name popup → `delivery_events`
- Camera-based scanning (`html5-qrcode`/ZXing fallback for Safari)
- `/api/portal/scan` built with its full validation posture from the start, not added later: row-level locking, quantity bounds checking, invoice-lock check, org/department-scoped barcode lookup, idempotency handling for duplicate/replayed scans
- Manual fallback entry, flagged distinctly in `scan_events`

**Exit criteria:** a scan reliably and correctly updates `delivered_qty`; concurrent-scan test (SEC-04) passes before this phase is considered done — this is the highest-risk endpoint in the system and gets tested before moving on, not after.

---

## Phase 4 — Real-Time + Export
**Goal:** the sheet updates live, and can leave the system safely.

- Supabase Realtime wired for Client Main Panel, RLS-filtered (Section 13), tested for cross-org leakage before shipping
- Excel export endpoint, with formula-injection sanitization built in immediately (Section 14) — never shipped without it
- Signed, expiring, org-scoped download URLs (Section 12)

**Exit criteria:** a scan on the Portal reflects on an open Client Main Panel sheet within a couple seconds with no manual refresh; an exported sheet is safe to open in Excel even with adversarial product-name content.

---

## Phase 5 — Admin Visibility + Locking Behavior
**Goal:** the two behaviors we specifically confirmed — cross-org live activity, and locking on completion.

- `scan_activity_log` + Admin's scoped/unscoped activity feed function (Section 13 of the architecture spec)
- Fully-received lock enforcement on `/api/portal/scan` (reject scans against locked invoices)
- Wrong-department scan detection + suggestion message, scoped strictly within the same org (never cross-org, per the security assessment)

**Exit criteria:** locked invoices genuinely reject scans; the wrong-department message appears correctly and never leaks another org's data while doing so.

---

## Phase 6 — Cross-Cutting Security Hardening
**Goal:** the pass that touches everything already built, rather than any one feature.

- Rate limiting across all endpoints (Section 18)
- Security headers + CSP (Section 17)
- Full logging/alerting implementation (Section 20)
- Re-run the full RLS policy set as an explicit audit, not just "it was written in earlier phases" — policies drift as tables evolve
- Run the SEC-01 through SEC-25 test plan in full against staging

**Exit criteria:** Section 24's production gate checklist, fully checked.

---

## Phase 7 — BYOD/PWA Polish
**Goal:** make the Portal genuinely pleasant and safe on personal phones.

- PWA install flow (`next-pwa`), offline queueing for poor warehouse connectivity
- Service worker cache policy explicitly excluding sensitive API responses (Section 16)
- Session timeout tuning based on real shift-length feedback
- Over-scan confirmation prompts, correction/undo capability for Client Main Panel (from the earlier "expert recommendations" list)

**Exit criteria:** a phone can go offline mid-scan and recover cleanly; nothing sensitive persists after the session ends.

---

## Phase 8 — Pre-Production Review
**Goal:** the actual go/no-go gate.

- Full code review against Section 21's format
- External or adversarial testing pass beyond the SEC test plan, if feasible
- Backup/recovery drill, not just configuration
- Final sign-off against every unchecked box in Section 24

**Exit criteria:** production deployment.

---

## Phase 9 — Future / Post-Launch (not blocking launch)

- Multi-supplier PDF parser support beyond the Loblaws template
- The privacy-isolation "switch" groundwork (per-tenant database migration path) if/when a large client needs it
- Admin activity feed scaling refinements if usage grows significantly

---

Tell me which phase to start with, and I'll build just that — nothing further ahead of it.
