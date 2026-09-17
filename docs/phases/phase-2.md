# Phase 2 — Client Main Panel + PDF Ingestion

**Goal:** Client Main Panel can log in, upload a real invoice PDF, and see it become a structured, department-split, read-only status sheet. Admin can create Client Main Panel accounts (Option A — no self-service signup).

## What's built in this phase

- **PDF parser microservice** (`parser-service/`, Python/FastAPI/pdfplumber) — tuned specifically to the Loblaws DC invoice template, tested against the real sample invoice with counts validated against the invoice's own summary table (7 of 8 departments present in the sample; all match exactly). Network-isolated by design (no outbound calls), token-authenticated, size/timeout limits enforced.
- **2 new migrations:** `verify_org_secret_code()` (a narrow function letting the Client Main Panel login flow check an org's secret code before authentication, without loosening `organizations`' admin-only RLS), and the three ingestion tables (`upload_batches`, `department_orders`, `delivery_line_items`) with full RLS and two triggers that make delivery status tamper-resistant at the database level.
- **Admin capability:** create a Client Main Panel account for any org (email + auto-generated password), per the confirmed Option A decision.
- **Client Main Panel:** login (org name + secret code + email + password), upload page, dashboard listing invoices by department, and a read-only sheet view per department/invoice showing ordered vs. delivered quantities and status.

## Three real bugs found and fixed during this phase — worth knowing about

1. **bcrypt version incompatibility.** `bcryptjs` (used in Phase 1 for secret codes) produces `$2b$`-prefixed hashes by default. Tested directly: this Postgres/pgcrypto version does not correctly verify `$2b$` hashes — it silently produces garbage instead of erroring. Fixed by converting to `$2a$` at hash-generation time (same algorithm, compatible tag). **This was verified with a real hash against real Postgres, not assumed** — if you ever change the hashing library, re-verify this.
2. **A trigger that didn't actually prevent tampering.** The first version of the `line_status` trigger only fired on `UPDATE OF delivered_qty, ordered_qty`, meaning a direct write to `line_status` alone never triggered recomputation — the tampering attempt it was meant to stop actually succeeded silently. Caught by deliberately trying to tamper with a test row, not by reading the code. Fixed by firing the trigger on every `UPDATE`, unconditionally.
3. **A real production timeout on large invoices, found by you.** The `department_orders` status-rollup trigger was `FOR EACH ROW` — so uploading an invoice with 200+ line items in one department fired that many separate aggregate re-scans and separate `UPDATE`s within a single bulk `INSERT` statement, well beyond what a flat per-row cost should look like. Reproduced locally: the original trigger scaled superlinearly (214 rows: 27ms, 2000 rows: 778ms) — on Supabase's real infrastructure under real load, a large department exceeded the statement timeout and the whole upload failed. **Fixed in migration `0007`**: replaced the row-level trigger with statement-level triggers using transition tables, so a bulk insert recomputes each affected department order's status once per statement, not once per row — after the fix, 5000 rows takes 179ms (roughly linear scaling, confirmed by re-running the same benchmark). Tampering-resistance was re-verified to still hold after the fix.
4. **Partial data left behind when an upload failed, found by you.** The upload route wrote the batch, then each department, then each department's line items as *separate* sequential inserts from application code. If any step failed partway through (e.g. bug 3 above, or any other mid-upload failure), everything inserted *before* the failure stayed in the database — an incomplete, confusing partial upload, confirmed by a real screenshot. **Fixed in migration `0008`**: the entire ingestion now happens inside one Postgres function call (`ingest_parsed_invoice`), which is one transaction — verified directly by deliberately breaking an upload partway through and confirming that even the department that *would* have succeeded on its own left zero trace. The function is `SECURITY INVOKER` (not `DEFINER`), so RLS still applies to every insert inside it — also re-verified with a deliberate cross-org attempt, correctly rejected.
5. **Status showing "Fully Received" before any employee ever scanned anything, found by you.** The original design (a decision made and confirmed earlier in the project) pre-filled `delivered_qty` with the supplier's own claimed quantity (`DR Qty`) at upload time. In practice this meant the system could show a delivery as complete based purely on the supplier's paperwork, before any physical verification happened — defeating the actual purpose of the system. **Reversed in migration `0008`**: `delivered_qty` now starts at `0` for every line item, verified directly (status correctly shows `pending` immediately after upload, regardless of what the supplier claimed). `supplier_reported_qty` is still stored as a reference value to compare against actual scans in Phase 3 — it just no longer drives status on its own.
6. **PDF parsing itself too slow on free-tier hardware, found by you.** After fixing the network/cold-start timeout (bug 3's sibling issue, see the hotfix docs), a *different* timeout kept firing: `"PDF took too long to process"` — the parser's own internal processing timeout. Root cause: `pdfplumber` (the original parsing library) is pure Python and CPU-heavy; on Render's free tier (0.1 CPU — a tenth of a core), parsing the real sample invoice was slow enough to exceed the timeout, even though it took ~3.3 seconds on more typical hardware. **Fixed by switching to PyMuPDF**, a C-library-backed PDF reader: measured directly on the same file, pdfplumber took 3.27s, PyMuPDF took 0.047s — about 69x faster. Critically, PyMuPDF's `sort=True` text-extraction mode reproduces pdfplumber's line-grouping closely enough that **zero changes were needed to `parser.py`'s regex logic** — verified by re-running every existing test (all 8 pass) against the new extraction method before switching, plus a full end-to-end HTTP test (0.32s total round-trip, down from a 30s timeout).
7. **Terminology mismatch and missing size data, found by you.** The database called the invoice's own claimed quantity `supplier_reported_qty` and the scan-verified quantity `delivered_qty` — backwards from how the business actually talks about it ("delivered" = what the invoice claims, "received" = what a scan verified). **Fixed in migration `0009`**: renamed `supplier_reported_qty` → `delivered_qty` and the old `delivered_qty` → `received_qty`, verified directly that Postgres correctly carried the rename through every dependent check constraint, trigger, and the ingestion function (re-tested the full insert → simulated scan → status computation chain end to end). Also added `pack_size` and `size_spec` as real, displayed columns — the parser extracted this all along, it just was never surfaced. The Client Main Panel navigation was also rebuilt as a strict 4-level hierarchy (Invoice Date → Invoice Number → Department → Products), each level scoped only to what was selected above it — see §Navigation below.

Every one of these was caught by actually running the code against a real (locally-installed, temporary) PostgreSQL instance, a real FastAPI server, and real timing measurements — not by inspection alone. Same discipline going forward.

## Navigation structure (added after real-world use)

The Client Main Panel browses invoices as a strict 4-level hierarchy, each level scoped only to what was selected above it:

```
/client                                    → list of Invoice Dates
/client/[date]                             → Invoice Numbers for that date
/client/[date]/[batchId]                    → Departments for that invoice
/client/[date]/[batchId]/[deptOrderId]       → Products for that invoice + department
```

Every query at every level filters explicitly by the parent level's ID (date → `invoice_date`, invoice → `batch_id`, department → `dept_order_id`) — this is what guarantees no data mixes between different invoices or dates, on top of RLS's org-level isolation. The products table shows both `delivered_qty` (the invoice's claim) and `received_qty` (the scan-verified count) side by side, plus `size_spec`/`pack_size`, with a plain-language note explaining the difference between the two quantity columns.

## Design decisions worth knowing about

- **Departments auto-match by `source_dept_code`, not by name.** If the same department code appears in a later upload, it links to the existing department rather than creating a duplicate — matching the confirmed decision.
- **`delivered_qty` is pre-filled from the supplier's own `DR Qty`** at upload time, per the confirmed decision — dock scans (Phase 3) will adjust it from there.
- **Re-uploads create a new version**, never overwrite (`upload_batches.version`, unique per org+invoice number).
- **Status is computed by database triggers, never trusted as an application-supplied value** — closing off the "manipulate delivery status" risk from the security assessment at the data layer, not just the API layer.
- **The org secret-code check at Client Main Panel login is a UX/identity-confirmation gate, not the actual authorization boundary.** The real boundary is RLS, keyed off each account's own `profiles.org_id` (set by Admin at account-creation time) — so even a mismatched org/code combo at login can't leak another org's data, though the login flow still checks for a match to avoid a confusing experience.

## Manual setup required in your Supabase project

1. Run `supabase/migrations/0005_verify_org_secret_code.sql`, then `0006_invoice_ingestion.sql`, in that order, via the SQL Editor (after Phase 1's 4 migrations, which should already be applied).
2. Run `supabase/migrations/0007_fix_department_order_status_trigger_performance.sql` — fixes the large-invoice timeout bug described above.
3. Run `supabase/migrations/0008_atomic_ingestion_and_zero_start.sql` — fixes the partial-save-on-failure bug and the premature "Fully Received" status bug described above. Required regardless of which earlier migrations you'd already run.
4. Run `supabase/migrations/0009_rename_qty_columns_and_add_size.sql` — renames the quantity columns to match real-world terminology and adds product size columns. Required regardless of which earlier migrations you'd already run.

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
- [ ] Uploading a large invoice (200+ line items in one department) completes without a timeout error
- [ ] Every line item shows status "pending" immediately after upload, with delivered quantity 0 — regardless of what the supplier's invoice claims as delivered
- [ ] Deliberately uploading a file that will fail partway through leaves **zero** trace in the database — no orphaned batch, no orphaned department data (hard to test without engineering a failure; trust the migration 0008 test notes above, or ask me to help construct one against your real project if you want to verify it yourself)
- [ ] The Client Main Panel navigation follows Invoice Date → Invoice Number → Department → Products, in that order, and clicking through never shows data from a different invoice or date than the one selected
- [ ] The products sheet shows both "Delivered (invoice)" and "Received (scanned)" as separate columns, plus each product's size — and "Received" stays at 0 until Phase 3 scanning exists

## Exit criteria

- [ ] All items in the manual testing checklist confirmed
- [ ] `npm run typecheck`, `npm run lint`, `npm run check:rls`, `npm audit --audit-level=high` all pass
- [ ] `npm run build` succeeds
- [ ] Parser service tests pass (`cd parser-service && pytest`)
- [ ] Both new migrations applied to your real Supabase project
- [ ] Parser service deployed and reachable from the main app

Once these are checked, tell me and we'll move to Phase 3 (Client Portal + the barcode scanning core loop).
