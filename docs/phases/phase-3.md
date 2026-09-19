# Phase 3 — Client Portal + Barcode Scanning Core Loop

**Goal:** staff can log in with org name + secret code, pick a department and an open invoice, enter their name, and scan barcodes on a personal phone — with `received_qty` updating live and every risk from the security assessment closed, verified for real.

## What's built in this phase

- **Migration `0010`:** the `portal` role, `delivery_events` (one per scanning session), `scan_events` (audit trail), and `process_scan` — the atomic, row-locking function that is the actual scanning engine.
- **Portal identity:** no individual login. A fresh Supabase anonymous auth session per login, narrowly upgraded to a `portal` profile by `create_portal_session` only after the org secret code is independently verified.
- **Full navigation:** Department → Invoice (open ones only, locked ones shown but disabled) → name entry → camera scanning, with a manual fallback for unreadable barcodes.
- **BYOD session security:** 30-minute idle auto-sign-out, secret code never persisted/autofilled, no individual identity stored beyond the session.

## This was tested against real concurrent load, not just logic review

Every risk called out in `docs/security/assessment.md`'s `/api/portal/scan` deep-dive was tested individually against a real, temporary PostgreSQL instance:

| Test | Result |
|---|---|
| Legitimate scan | ✅ Correctly updates `received_qty`, returns item description |
| **Cross-org attack** — Org B's portal session given Org A's real `event_id` | ✅ Rejected ("Invalid session"), zero data changed |
| Wrong department (same org) | ✅ Correct department-name suggestion returned |
| Barcode not found anywhere | ✅ Generic "not recognized," never distinguishes org existence |
| Negative / absurdly large quantity | ✅ Both rejected |
| Locked (fully received) invoice | ✅ Scan rejected, `received_qty` unchanged |
| Genuine duplicate (same idempotency key replayed) | ✅ Safely ignored, returns prior result, no double-count |
| **20 truly concurrent scans of the same barcode** | ✅ **Exactly 20 added, zero lost** — real background processes, not sequential requests |

### A real design correction made during testing

The first version of the duplicate-scan guard used a 2-second time window ("if this exact barcode was scanned in the last 2 seconds, reject it"). Testing caught that this would have **incorrectly blocked a very common, legitimate case**: an employee scanning several physical units of the same product back-to-back, which easily happens within a couple of seconds. Replaced with a client-generated idempotency key per physical scan action — a genuine network retry (same key) is safely ignored, but a new scan of another unit (new key) always counts. This is exactly the kind of thing that looks fine in code review and only breaks in real use — caught by testing the actual intended workflow, not just the attack case.

## Required manual setup in your Supabase project

1. **Run migration `0010_client_portal_scanning.sql`** via the SQL Editor, after all previous migrations.
2. **Enable Anonymous Sign-ins** — this is off by default in every Supabase project and the Portal login flow depends on it. Go to your Supabase Dashboard → **Authentication** → **Sign In / Providers** → enable **Anonymous Sign-ins**. Takes effect immediately, no redeploy needed.

## Known limitations, honestly flagged (candidates for Phase 6 hardening)

- **No CAPTCHA on the Portal login yet.** Since anonymous sign-in creates a real row in `auth.users` on every attempt, an automated bot hitting the login endpoint repeatedly could create many orphaned anonymous accounts (each with no profile, so no data access — not a security hole, but operational noise). Supabase recommends CAPTCHA protection for this; not yet implemented.
- **No automated cleanup job for orphaned anonymous sessions** — e.g. someone who starts the login flow but enters a wrong secret code leaves behind an anonymous `auth.users` row with no profile. Harmless (zero access, per the RLS verification above), but will accumulate over time.
- **Camera behavior could not be tested in this environment** — no real camera/browser available. The scanning UI is built correctly against `html5-qrcode`'s documented API (barcode formats explicitly configured for UPC/EAN/Code128, not just QR codes), but real-device testing across phone models and lighting conditions is still needed before full production trust.
- **Idle timeout (30 minutes)** is a starting value, not tuned to real shift patterns yet.

## Manual testing checklist

- [ ] Anonymous Sign-ins enabled in the Supabase Dashboard (see above) — without this, Portal login will fail with a 422 error
- [ ] Logging into the Portal with the correct org name + secret code succeeds
- [ ] Logging in with a wrong code fails with a generic error
- [ ] Department list shows only departments for your org
- [ ] Invoice list shows only open invoices as clickable; fully-received ones show as locked
- [ ] Entering a name and scanning updates `received_qty` on the Client Main Panel's sheet
- [ ] Scanning a barcode that belongs to a different department (same org) shows the wrong-department suggestion
- [ ] Scanning an unrecognized barcode shows a generic "not recognized" message
- [ ] The manual entry fallback works when camera scanning isn't available or a barcode won't read
- [ ] Leaving the Portal idle for 30+ minutes signs you out automatically

## Exit criteria

- [ ] All items in the manual testing checklist confirmed
- [ ] `npm run typecheck`, `npm run lint`, `npm run check:rls`, `npm audit --audit-level=high` all pass
- [ ] `npm run build` succeeds
- [ ] Migration `0010` applied to your real Supabase project
- [ ] Anonymous Sign-ins enabled in your real Supabase project
- [ ] Real-device camera testing done on at least one Android and one iPhone (Safari has historically been the trickiest browser for camera APIs)

Once these are checked, tell me and we'll move to Phase 4 (real-time updates + export).
