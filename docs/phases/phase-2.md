# Phase 2 — Client Main Panel + PDF Ingestion

**Goal:** Client Main Panel can log in, upload a real invoice PDF, and see it become a structured, department-split, read-only status sheet. Admin can create Client Main Panel accounts (Option A — no self-service signup).

## What's built in this phase

- **PDF parser microservice** (`parser-service/`, Python/FastAPI/pdfplumber) — tuned specifically to the Loblaws DC invoice template, tested against the real sample invoice with counts validated against the invoice's own summary table (7 of 8 departments present in the sample; all match exactly). Network-isolated by design (no outbound calls), token-authenticated, size/timeout limits enforced.
- **2 new migrations:** `verify_org_secret_code()` (a narrow function letting the Client Main Panel login flow check an org's secret code before authentication, without loosening `organizations`' admin-only RLS), and the three ingestion tables (`upload_batches`, `department_orders`, `delivery_line_items`) with full RLS and two triggers that make delivery status tamper-resistant at the database level.
- **Admin capability:** create a Client Main Panel account for any org (email + auto-generated password), per the confirmed Option A decision.
- **Client Main Panel:** login (org name + secret code + email + password), upload page, dashboard listing invoices by department, and a read-only sheet view per department/invoice showing ordered vs. delivered quantities and status.

## Two real bugs found and fixed during this phase — worth knowing about

1. **bcrypt version incompatibility.** `bcryptjs` (used in Phase 1 for secret codes) produces `$2b$`-prefixed hashes by default. Tested directly: this Postgres/pgcrypto version does not correctly verify `$2b$` hashes — it silently produces garbage instead of erroring. Fixed by converting to `$2a$` at hash-generation time (same algorithm, compatible tag). **This was verified with a real hash against real Postgres, not assumed** — if you ever change the hashing library, re-verify this.
2. **A trigger that didn't actually prevent tampering.** The first version of the `line_status` trigger only fired on `UPDATE OF delivered_qty, ordered_qty`, meaning a direct write to `line_status` alone never triggered recomputation — the tampering attempt it was meant to stop actually succeeded silently. Caught by deliberately trying to tamper with a test row, not by reading the code. Fixed by firing the trigger on every `UPDATE`, unconditionally.

Both were caught by literally running the code against a real (locally-installed, temporary) PostgreSQL instance and a real FastAPI server — not by inspection alone. Same discipline going forward.

## Design decisions worth knowing about

- **Departments auto-match by `source_dept_code`, not by name.** If the same department code appears in a later upload, it links to the existing department rather than creating a duplicate — matching the confirmed decision.
- **`delivered_qty` is pre-filled from the supplier's own `DR Qty`** at upload time, per the confirmed decision — dock scans (Phase 3) will adjust it from there.
- **Re-uploads create a new version**, never overwrite (`upload_batches.version`, unique per org+invoice number).
- **Status is computed by database triggers, never trusted as an application-supplied value** — closing off the "manipulate delivery status" risk from the security assessment at the data layer, not just the API layer.
- **The org secret-code check at Client Main Panel login is a UX/identity-confirmation gate, not the actual authorization boundary.** The real boundary is RLS, keyed off each account's own `profiles.org_id` (set by Admin at account-creation time) — so even a mismatched org/code combo at login can't leak another org's data, though the login flow still checks for a match to avoid a confusing experience.

## Manual setup required in your Supabase project

1. Run `supabase/migrations/0005_verify_org_secret_code.sql`, then `0006_invoice_ingestion.sql`, in that order, via the SQL Editor (after Phase 1's 4 migrations, which should already be applied).

## Deploying the parser service

This is a second, separate deployable component — it does not run on Vercel alongside the Next.js app. Recommended: [Render.com](https://render.com) (free tier supports Docker deployments).

1. Push this repo to GitHub (already done, if you're following along from Phase 0/1).
2. In Render: **New → Web Service**, connect your GitHub repo, set the **root directory** to `parser-service`, and let it detect the `Dockerfile`.
3. Add an environment variable `PARSER_SERVICE_TOKEN` — generate a long random value (e.g. `openssl rand -hex 32` in your terminal) and use the same value in the main app's `PDF_PARSER_SERVICE_TOKEN`.
4. Once deployed, copy the service's URL into the main app's `PDF_PARSER_SERVICE_URL` (both locally in `.env.local` and in Vercel's project environment variables).

**Known limitation, honestly flagged:** free-tier hosting platforms often don't offer a way to fully block outbound network access at the infrastructure level, which the security assessment recommends for this service. This is deferred to Phase 6 hardening — for now, the service's own code never makes outbound calls on its own, which meaningfully reduces (but doesn't infrastructurally guarantee) the SSRF risk.

## Manual testing checklist

- [ ] Admin can create a Client Main Panel account from an org's page, and the credentials are shown exactly once
- [ ] Logging into `/client/login` with the wrong secret code fails with a generic error
- [ ] Logging in with the correct org/code/email/password succeeds and lands on `/client`
- [ ] Uploading the sample invoice PDF succeeds and creates 7 department sections (matching the sample file's real content)
- [ ] Each department's sheet shows the correct ordered/delivered quantities and status
- [ ] Re-uploading the same invoice creates a new version rather than failing or overwriting
- [ ] A Client Main Panel account for Org A cannot see Org B's invoices (test directly, e.g. by creating a second org and account)
- [ ] Uploading a non-PDF file, or a PDF over 20MB, is rejected with a clear error

## Exit criteria

- [ ] All items in the manual testing checklist confirmed
- [ ] `npm run typecheck`, `npm run lint`, `npm run check:rls`, `npm audit --audit-level=high` all pass
- [ ] `npm run build` succeeds
- [ ] Parser service tests pass (`cd parser-service && pytest`)
- [ ] Both new migrations applied to your real Supabase project
- [ ] Parser service deployed and reachable from the main app

Once these are checked, tell me and we'll move to Phase 3 (Client Portal + the barcode scanning core loop).
