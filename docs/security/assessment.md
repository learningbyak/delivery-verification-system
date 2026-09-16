# Delivery Verification System — Pre-Production Security Assessment

**Role:** Senior Application Security Engineer / Security Architect / Threat Model Review
**Scope:** Full-stack review of the Admin Panel, Client Main Panel, and Client Portal (PWA), covering Next.js, Supabase (Postgres/Auth/RLS/Realtime/Storage), the Python PDF parser, and the barcode-scanning workflow.
**Posture:** Nothing is assumed secure by default. RLS, HTTPS, and auth are treated as claims to verify, not facts.

---

## 1. Executive Security Summary

The architecture (org-scoped Postgres with RLS, JWT-based role separation, an isolated PDF parser, BYOD camera scanning) is a reasonable *shape* for a secure multi-tenant system — but the shape alone guarantees nothing. The system's entire security model rests on one property: **every server-side operation must derive `org_id` from a trusted, authenticated identity — never from a client-supplied parameter.** Every serious risk in this assessment is a variation of that single principle being violated somewhere.

**Verdict: NOT production-ready as currently specified.** No CRITICAL-severity gap has been *disproven* because no implementation has been code-reviewed yet — this document defines what must be true before that verdict can change. Section 24 is the gate.

**Top 3 risks if built naively:**
1. **Cross-tenant IDOR** — any endpoint that trusts a client-supplied `org_id`, `department_id`, or `line_item_id` without a server-side ownership check lets one org read or write another's data.
2. **Client Portal identity gap** — `role: "portal"` with no personal identity means a stolen secret code grants durable, hard-to-attribute write access (barcode scans) to an entire org's delivery data.
3. **Barcode scan race conditions** — concurrent scans against the same line item without row-level locking or an idempotency key can corrupt `delivered_qty`, silently breaking the entire premise of the product (accurate delivery status).

---

## 2. Architecture Security Assessment

| Component | Security role | Risk if misconfigured |
|---|---|---|
| Next.js API routes | Primary trust boundary — every authorization decision must be re-verified here, never trusted from the client | Becomes a pass-through proxy to Supabase with no real authorization |
| Supabase Postgres + RLS | Second, independent trust boundary | If RLS policies are permissive or missing, app-layer bugs become full data breaches |
| Supabase Auth | Identity issuance | Weak session/token config undermines every downstream check |
| Supabase Realtime | Live data channel — often overlooked as an authz surface | Row-level filters not enforced on subscriptions = side-channel data leak |
| Supabase Storage | Holds original PDFs | Predictable paths + public bucket = cross-tenant document leak |
| Python FastAPI parser | Processes untrusted file content | If reachable from the internet or given broad network access, becomes an SSRF/RCE pivot point |
| Vercel edge | Public entry point | Must not leak secrets via `NEXT_PUBLIC_*`, source maps, or error responses |

**Key principle to enforce everywhere:** two independent authorization layers (application code + RLS) that must **both** agree — never rely on either alone. This is defense in depth: an app-layer bug should be caught by RLS, and an RLS misconfiguration should be caught by app-layer checks. Treat any endpoint where only one of the two exists as unfinished.

---

## 3. Threat Model

**Assets:** org data (invoices, line items, delivery status), secret codes, user credentials, JWTs, uploaded PDFs, scan history/audit trail, Supabase service-role key, parser service.

**Trust boundaries:** Internet ↔ Vercel edge · Next.js app ↔ Supabase · Next.js app ↔ PDF parser · Browser ↔ Next.js (client-controlled input) · Org A's session ↔ Org B's data.

| Actor | Primary threats | Key vulnerability if unmitigated | Core mitigation |
|---|---|---|---|
| A. Unauthenticated internet user | Probing public endpoints, brute-forcing org name/secret code, scraping | Guessable org names, no rate limiting on login | Rate limit + generic error messages + org-name enumeration resistance |
| B. Normal Client Portal user | Accidental cross-department/invoice actions, session left open on shared/lost device | Session outlives the shift; no personal identity to trace misuse | Short session TTL, mandatory name capture per session, no credential persistence |
| C. Client Main Panel user | Attempting to view/edit data outside their own org | Client-supplied `org_id` trusted directly | Server derives `org_id` from JWT, never from request body/query |
| D. Client administrator | Privilege misuse within their own org (still bounded correctly) | Overly broad role granting cross-department actions unintentionally | Department-level scoping within `client_admin`, not just org-level |
| E. System (Admin Panel) administrator | Compromise of this account is the highest-impact single event in the system | Full cross-org access, so credential theft = total breach | MFA mandatory, tightly logged, ideally IP-allowlisted |
| F. Malicious authenticated user (any role) | Parameter tampering, IDOR probing, replay, mass assignment | Any endpoint trusting client-supplied IDs or extra JSON fields | Strict input schemas (allow-list fields), server-derived scoping on every query |
| G. Compromised client account | Attacker now has legitimate `org_id` — the question is whether they can pivot to *other* orgs | Any shared infrastructure (e.g., a misconfigured RLS `USING (true)`) turns one compromise into all-tenant compromise | RLS as an independent backstop, so one org's compromise is contained to that org |
| H. Malicious PDF/file uploader | Malformed PDF designed to crash/exploit the PDF parsing library (PyMuPDF), decompression bombs, oversized files | Parser service with no resource limits or sandboxing | Size/time/memory limits, sandboxed parser, no network egress from parser |
| I. Attacker controlling a BYOD phone | Stolen/lost phone with an active or cached session | Persisted secret code or long-lived session token in browser storage | No persistence of secret code, short session TTL, no sensitive data cached by the service worker |
| J. Compromised third-party dependency | Supply-chain attack via an npm/PyPI package | Unpinned/unaudited dependencies with excessive permissions | Dependency pinning, SCA scanning, least-privilege service credentials |

**Deepest-priority actor: G (compromised client account).** The entire multi-tenant security model should be designed assuming this *will* happen to some org eventually — the question the architecture must answer is "does that compromise stay contained to one org?" Every other threat is secondary to getting that containment right.

---

## 4. Attack Surface

**Public/unauthenticated entry points:** `/api/auth/*` (all four login endpoints), any static assets, PWA manifest/service worker.

**Authenticated entry points:** every other route in Section 7's table — all must independently re-verify identity and scope on every request (no implicit trust from a prior request in the same session).

**Client-controlled values requiring server-side re-validation everywhere they appear:** `org_id`, `department_id`, `dept_order_id`, `line_item_id`, `batch_id`, `event_id`, `scan_id`, `barcode_value`, `scanned_qty`, uploaded filenames, uploaded file content, any pagination `cursor`.

**Server-controlled values that must never be settable by the client:** `org_id` (once bound to a session), `role`, `delivered_qty` (only ever changed via the scan-processing logic, never a direct field write), `line_status`, timestamps, `secret_code_hash`.

---

## 5. Multi-Tenant Security Assessment (Highest Priority)

**Assume every ID in a request is malicious.** The only safe pattern:

```
Authenticated request
   → extract identity from verified JWT (not request body)
   → look up org_id bound to that identity server-side
   → for the specific resource requested, query:
        SELECT ... WHERE resource.org_id = <server-derived org_id>
        AND resource.id = <client-supplied id>
   → if zero rows returned, treat as 404 (not 403 — don't confirm existence)
   → only then perform the operation
```

**Never** do this:
```ts
// INSECURE — trusts the client
const { orgId } = req.body;
const data = await db.query('SELECT * FROM department_orders WHERE org_id = $1', [orgId]);
```

**Always** do this:
```ts
// SECURE — org_id comes from the verified session, not the request
const orgId = session.org_id; // derived server-side from JWT, never from req.body/query
const deptOrderId = req.params.deptOrderId; // client-supplied, treated as untrusted
const data = await db.query(
  'SELECT * FROM department_orders WHERE dept_order_id = $1 AND org_id = $2',
  [deptOrderId, orgId]
);
if (data.rowCount === 0) return res.status(404).end(); // don't leak existence across orgs
```

This exact pattern must be applied to **every** foreign-key relationship in the schema — `department_id`, `dept_order_id`, `line_item_id`, `event_id` all need their *ownership chain* verified back to the session's `org_id`, not just their own existence. A `line_item_id` that exists but belongs to another org must fail identically to one that doesn't exist at all.

---

## 6. Supabase Row-Level Security

**Do not accept "RLS is enabled" as sufficient — verify the actual policies.** A table with RLS enabled but a policy of `USING (true)` is equivalent to no RLS at all, and this is a common real-world misconfiguration.

**Trusted JWT claims:** `org_id` and `role`, both set at token issuance server-side — never accept an `org_id` claim that could be influenced by client-submitted data at signup/login time. `org_id` must be looked up server-side from the organization the credentials actually belong to.

Representative policies (Postgres/Supabase syntax):

```sql
-- organizations: no direct client access at all except Admin
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;

CREATE POLICY admin_full_access ON organizations
  FOR ALL
  USING (auth.jwt() ->> 'role' = 'admin');

-- departments: org-scoped read for client_admin/portal, write for client_admin+admin only
ALTER TABLE departments ENABLE ROW LEVEL SECURITY;

CREATE POLICY org_scoped_select ON departments
  FOR SELECT
  USING (
    auth.jwt() ->> 'role' = 'admin'
    OR org_id = (auth.jwt() ->> 'org_id')::uuid
  );

CREATE POLICY org_scoped_write ON departments
  FOR INSERT WITH CHECK (
    auth.jwt() ->> 'role' IN ('admin','client_admin')
    AND (auth.jwt() ->> 'role' = 'admin' OR org_id = (auth.jwt() ->> 'org_id')::uuid)
  );

CREATE POLICY org_scoped_update ON departments
  FOR UPDATE
  USING (
    auth.jwt() ->> 'role' IN ('admin','client_admin')
    AND (auth.jwt() ->> 'role' = 'admin' OR org_id = (auth.jwt() ->> 'org_id')::uuid)
  )
  WITH CHECK (
    -- prevents an UPDATE from moving a row into another org
    org_id = (auth.jwt() ->> 'org_id')::uuid OR auth.jwt() ->> 'role' = 'admin'
  );

-- delivery_line_items: joins up through department_orders -> departments to enforce org scope,
-- since this table has no direct org_id column
ALTER TABLE delivery_line_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY org_scoped_via_join ON delivery_line_items
  FOR SELECT
  USING (
    auth.jwt() ->> 'role' = 'admin'
    OR EXISTS (
      SELECT 1 FROM department_orders do
      JOIN departments d ON d.department_id = do.department_id
      WHERE do.dept_order_id = delivery_line_items.dept_order_id
        AND d.org_id = (auth.jwt() ->> 'org_id')::uuid
    )
  );
-- Apply the same EXISTS-join pattern to scan_events and delivery_events (both join through
-- dept_order_id / line_item_id back to departments.org_id). Tables with no direct org_id
-- column are exactly where cross-tenant leaks hide — never skip the join just because
-- writing the policy is more work.
```

**Answering the specific verification questions requested:**

| # | Question | Answer |
|---|---|---|
| 1–4 | Who can SELECT/INSERT/UPDATE/DELETE | Per-table, per-role policies as above — never a blanket `FOR ALL USING (true)` |
| 5 | Trusted JWT claims | `role`, `org_id` — both set at issuance, never derived from request payloads |
| 6 | How is `org_id` obtained | Looked up server-side against the authenticated identity at login, embedded in the issued JWT |
| 7 | Can users modify `org_id` | No — `org_id` is a JWT claim, not a client-editable field; RLS `WITH CHECK` also blocks any UPDATE that would change a row's `org_id` |
| 8 | Insert into another org | Blocked by `WITH CHECK` clauses tying inserted `org_id` to the JWT claim |
| 9 | Update another org's records | Blocked by `USING` + `WITH CHECK` together |
| 10 | Infer data via joins | This is the dangerous one — every table without a direct `org_id` column (line items, scan events) needs the `EXISTS`-join pattern above, or joins silently bypass isolation |
| 11 | Can Realtime bypass isolation | Only if RLS is skipped for Realtime specifically — see Section 12 |
| 12 | Can service-role bypass RLS | Yes, by design — service-role is meant for trusted server-side code only |
| 13 | Is service-role exposed client-side | Must be verified as **never** present in any `NEXT_PUBLIC_*` variable, bundle, or API response — this is a common, severe misconfiguration |

**Dangerous patterns to explicitly reject in code review:**
- `USING (true)` on any table containing tenant data
- Policies that check `role` but not `org_id` (permits cross-org access for a correctly-authenticated user)
- Any RLS policy relying on a client-suppliable header/claim not actually verified by Supabase Auth
- Using the service-role key anywhere reachable from the browser (bypasses RLS entirely)

---

## 7. Authentication Assessment

| Flow | Identity established | Key risks | Required controls |
|---|---|---|---|
| Admin (email + password) | Individual, org_id = null | Highest blast radius if compromised | MFA **mandatory**, aggressive rate limiting, IP allowlist if feasible, alert on every login |
| Client Main Panel (org + secret code + username + password) | Individual within one org | Secret code is a shared org-wide secret — weaker than a personal password | Secret code hashed (never plaintext), high entropy, rotation capability, rate limiting on both factors |
| Client Portal (org + secret code only) | **No personal identity** — see below | Stolen code = durable, hard-to-attribute access | Short session TTL, mandatory name capture (already in design) logged per scan, no persistence |

**On `role: "portal", org_id: X` with no personal identity:** this is an accepted design tradeoff (per the product spec), but it means the *system* cannot cryptographically distinguish one staff member from another — only the self-reported name captured at session start can. This has a direct security consequence: **the self-reported name must never be treated as an authorization signal, only an audit-trail/attribution signal.** Abuse detection therefore has to work at the *session and org* level, not the individual level:
- Rate-limit scans per session (a human can't physically scan faster than X/minute — flag outliers)
- Alert on sessions with abnormal scan volume, or scans occurring outside plausible shift hours
- Alert on repeated failed logins against one org's secret code (signals brute-force or a leaked code)
- Any single scan session should be time-boxed; a session open for 12+ hours is itself a signal worth flagging

**Cross-cutting controls required, all flows:**
- Rate limiting + exponential backoff on every login endpoint (Section 17)
- Generic error messages — never reveal "org not found" vs "wrong code" separately (enables enumeration)
- Secure, `HttpOnly`, `Secure`, `SameSite=Strict` (or `Lax` if cross-site flows are needed) cookies for session tokens
- Session revocation capability (e.g., Client Main Panel can force-rotate the secret code, immediately invalidating all active Portal sessions for that org)
- CSRF protection on any cookie-authenticated state-changing request (Section 7's per-endpoint table)

---

## 8. Authorization Assessment (Role Matrix)

| Action | Admin | Client Main Panel | Client Portal |
|---|:---:|:---:|:---:|
| Manage any org | ✅ | ❌ | ❌ |
| Manage own org (departments, secret code) | ✅ | ✅ (own org only) | ❌ |
| Upload invoices | ✅ (any org) | ✅ (own org only) | ❌ |
| View status sheets | ✅ (any org) | ✅ (own org only) | ❌ |
| Export sheets | ✅ (any org) | ✅ (own org only) | ❌ |
| Scan barcodes | ✅ (any org, testing) | ❌ | ✅ (own org, own department session) |
| View cross-org activity feed | ✅ | ❌ | ❌ |

Every cell above must be enforced **twice**: once in application middleware (reject the request before it reaches business logic) and once in RLS (reject the query even if middleware has a bug). Treat any endpoint where only one layer exists as an open finding.

---

## 9. API-by-API Security Assessment

**Baseline applied to every endpoint below unless noted otherwise:** HTTPS only, session required, `org_id` server-derived, strict input schema validation (reject unknown fields — prevents mass assignment), structured error responses that don't leak internals, request logged.

| Endpoint | Auth / Role | Org scope check | Key risks | Rate limit |
|---|---|---|---|---|
| `POST /api/auth/admin/login` | None (public) | N/A | Brute force, credential stuffing | 5/min per IP, lockout after repeated failures |
| `POST /api/auth/client-admin/login` | None (public) | N/A | Brute force on secret code + password | 5/min per IP + per org_name |
| `POST /api/auth/portal/login` | None (public) | N/A | Secret-code brute force, org enumeration | 5/min per IP + per org_name, generic errors |
| `POST /api/auth/portal/session` | Portal session | Department must belong to session's org | Selecting another org's department | Standard |
| `GET/POST/PATCH /api/orgs*` | Admin only | N/A (admin is cross-org by design) | Any non-admin reaching this = critical finding | Standard + audit-logged (privileged) |
| `GET/POST/PATCH/DELETE /api/departments/:deptId` | Admin or Client Main Panel | `deptId` must resolve to caller's `org_id` (or admin) | IDOR if `deptId` ownership unchecked | Standard |
| `GET /api/departments/:deptId/orders` | Admin or Client Main Panel | Same as above | IDOR | Standard |
| `GET /api/department-orders/:deptOrderId` | Admin or Client Main Panel | Ownership chain check (§5) | IDOR, information disclosure | Standard |

**Deep-dive: the four flagged endpoints**

**`POST /api/orgs/:orgId/upload`**
- Auth: Admin (any org) or Client Main Panel (own org only — `orgId` in path must equal session `org_id` unless admin)
- Risks: cross-org upload (writing into another org's departments), malicious PDF (Section 11), oversized payloads, filename injection into storage paths
- Mitigations: reject if `orgId` ≠ session org (non-admin), enforce file size/type limits before the file ever reaches the parser, generate the storage path server-side (never from the client-supplied filename), scan/validate parser output before any DB write, wrap the whole ingestion in a transaction so a partial parse never leaves a half-written invoice
- Expected errors: `403` (wrong org, non-admin), `413` (too large), `422` (not a valid PDF / parse failure)

**`POST /api/portal/scan`**
- Auth: active Portal session only
- Risks: this is the highest-value abuse target in the system — arbitrary `barcode_value`, tampered `scanned_qty` (negative, huge, or fractional), replay of the same scan, reused `event_id` across sessions, `line_item_id` from another org/department, scanning a locked invoice, race conditions inflating `delivered_qty`
- Required server-side validation (all of these, not a subset):
  - `event_id` must belong to the authenticated Portal session and be unexpired
  - The resolved `dept_order_id` (via the event) must not be `fully_received` — reject with a clear "locked" response, matching the product's confirmed lock behavior
  - `barcode_value` lookup is scoped to line items under that session's `dept_order_id` only — a match in another org must be structurally impossible to reach, not just unlikely (the cross-department "wrong department" suggestion feature must search within the *same org* only, never across orgs)
  - `scanned_qty` must be a positive integer within a sane bound (e.g., reject anything wildly larger than `ordered_qty` — flag rather than silently applying)
  - Every accepted scan is applied as an atomic transaction: `UPDATE delivery_line_items SET delivered_qty = delivered_qty + $qty WHERE line_item_id = $id AND dept_order_id = $do FOR UPDATE` (row-level lock) — never a read-then-write from application code, which races
  - Idempotency: accept an optional client-generated idempotency key per physical scan action so a network retry can't double-count; at minimum, detect and reject implausibly rapid duplicate scans of the identical barcode within the same session (sub-second repeats)
- Expected errors: `403` (session/org mismatch), `404` (barcode not found — see below), `409` (invoice locked, or idempotency conflict)
- On "not found," return the same response whether the item exists in another org or doesn't exist anywhere — never let the response distinguish "wrong org" from "doesn't exist," or the endpoint becomes an org-enumeration oracle

**`POST /api/portal/scan/manual`**
- Same validation posture as `/scan`, plus: since this path exists specifically for damaged/unreadable barcodes, it's more attractive for abuse (a malicious user could always claim "the barcode didn't scan" and manually select any product). Recommend flagging manual entries distinctly in `scan_events` (e.g., a `method` column: `camera` vs `manual`) so the Client Main Panel can review manual entries with extra scrutiny, and consider a per-session cap on manual-entry ratio as an anomaly signal.

**`GET /api/department-orders/:deptOrderId/export`**
- Auth: Admin or Client Main Panel, ownership chain enforced identically to the view endpoint
- Risks: cross-org export (same IDOR pattern), formula injection in the generated spreadsheet (Section 13), resource exhaustion from exporting a very large sheet repeatedly
- Mitigations: same ownership check as §5, sanitize every cell value before writing (Section 13), rate-limit export requests per user, and generate the file server-side into a private, expiring, org-scoped storage path — never construct a public/guessable download URL

---

## 10. Database & Constraint-Level Security

Application code will have bugs. Constraints are the backstop that prevents those bugs from producing invalid or exploitable data:

```sql
-- Quantities can never go negative, regardless of application logic
ALTER TABLE delivery_line_items
  ADD CONSTRAINT ordered_qty_nonnegative CHECK (ordered_qty >= 0),
  ADD CONSTRAINT delivered_qty_nonnegative CHECK (delivered_qty >= 0);

-- scanned_qty on an individual scan must be positive (no negative-quantity manipulation)
ALTER TABLE scan_events
  ADD CONSTRAINT scanned_qty_positive CHECK (scanned_qty > 0);

-- Foreign keys enforced everywhere with explicit ON DELETE behavior — prefer RESTRICT
-- or a soft-delete pattern over CASCADE for anything with audit/financial relevance,
-- so a department deletion can never silently wipe out delivery/scan history.
ALTER TABLE delivery_line_items
  ADD CONSTRAINT fk_dept_order FOREIGN KEY (dept_order_id)
  REFERENCES department_orders(dept_order_id) ON DELETE RESTRICT;

-- Status must be one of the defined enum values only — already true if using a Postgres
-- ENUM type rather than free text, which also closes off a class of injection-adjacent bugs
```

**Additional recommendations:**
- **No hard deletes on `scan_events` or `scan_activity_log` ever** — these are the audit trail; only soft-delete/archive, and restrict even that to Admin
- **JSONB `row_data` column:** validate structure/size at write time (reject absurdly large or deeply nested payloads) to prevent it becoming a storage-exhaustion or query-performance vector
- **Indexes** on every FK used in an ownership-chain join (`department_orders.department_id`, `delivery_line_items.dept_order_id`, `delivery_line_items.barcode_value`) — RLS policies using `EXISTS` joins get expensive fast without them
- **Status transitions:** enforce `fully_received` as a one-way, application-controlled transition (never client-settable directly) — a `CHECK` constraint alone can't express "can only move forward," so this needs a trigger or application-transaction-level enforcement

---

## 11. PDF Upload & Parser Security

| Control | Requirement |
|---|---|
| Max file size | Enforce (e.g., 20MB) at the Next.js upload handler, before the file is ever forwarded to the parser |
| Request/parser timeout | Hard timeout (e.g., 30s) — kill the parse job rather than let a malicious PDF hang the service |
| Memory/CPU limits | Run the parser in a resource-capped container (cgroup limits) so one malicious file can't exhaust the host |
| Filename policy | Never use the client-supplied filename for any storage path or shell command — generate a server-side UUID filename; store the original name only as metadata, sanitized for display |
| MIME/content validation | Verify actual file content (magic bytes) is a PDF, not just the declared `Content-Type` header, which is trivially spoofable |
| Network isolation | **The parser service must have no outbound network access at all** beyond what's strictly needed to write results back to Supabase — this closes off SSRF entirely as an attack class, since a malicious PDF can't make the parser fetch anything |
| Service auth | Next.js ↔ parser communication authenticated with a shared secret/service token, not left open on an internal network with no auth |
| Storage isolation | Uploaded originals stored under an org-scoped path (e.g., `orgs/{org_id}/uploads/{uuid}.pdf`), never a flat/shared directory |
| Malware scanning | Run uploaded files through a scanning step (e.g., ClamAV) before they're treated as trusted, even though they're invoices, not typically malware vectors — cheap insurance |
| Error handling | Parser failures return a generic "could not process file" to the client; detailed parser errors/stack traces are logged server-side only, never returned to the browser |

---

## 12. Supabase Storage Security

- Buckets holding invoice PDFs must be **private**, never public
- All access via **short-lived signed URLs** generated server-side after the same ownership check as Section 5 — never a permanent/public object URL
- Storage paths must be unguessable and org-scoped (`orgs/{org_id}/...`), and access must be verified against the requester's `org_id` even though the path itself contains it — a predictable path is not a security boundary on its own, only a convenience
- Verify deleted files are actually removed (or intentionally retained under a documented retention policy) — don't let "deleted" invoices remain silently downloadable via a previously-issued signed URL past its intended lifetime

---

## 13. Realtime Security

Supabase Realtime subscriptions must be filtered by the **same RLS policies** as regular queries — verify this is actually configured, since Realtime has historically been a place teams forget to apply the tenant-isolation policies they wrote for normal queries.

- Client Main Panel subscribes only to rows where `org_id` matches their session — enforced at the database/RLS level, not by the client simply "choosing" to filter on the right `org_id` in its subscription request (a malicious client could subscribe unfiltered)
- Admin's cross-org activity feed subscription is the **one intentional exception** — it must use a distinct, explicitly-audited policy path (e.g., only the `scan_activity_log` table, only for `role = admin`), not a general bypass
- Verify a Client Portal session cannot subscribe to Realtime channels at all, or if it can, that it's scoped at minimum to its own `org_id` and ideally its own `dept_order_id` — Portal sessions have no business seeing another department's live activity

---

## 14. Export Security (Formula/Spreadsheet Injection)

Any user-controlled value written into a generated Excel file is a formula-injection risk if it begins with `=`, `+`, `-`, `@`, tab, or carriage return — Excel/Sheets will interpret it as a formula when opened.

**Cells at risk in this system:** product `Description` and any other free-text field pulled from `row_data` (originally from the supplier PDF, but still untrusted input as far as the export step is concerned), the `staff_name` field, and the org/department names if ever user-renamable.

**Mitigation:** before writing any string cell, if it starts with one of the risk characters, prefix it with a single quote (`'`) or a leading space, which forces spreadsheet applications to treat it as literal text rather than a formula. Apply this as a blanket sanitization step in the export function — not selectively per-field, since it's cheap and the cost of missing one field is real.

---

## 15. Client-Side Security

**Frontend authorization is not a security boundary.** Every check described in Sections 5–9 must be enforced server-side regardless of what the UI shows or hides. Route guards, disabled buttons, and conditional rendering are UX conveniences only.

Checklist:
- No `dangerouslySetInnerHTML` with unsanitized data anywhere (product descriptions and other PDF-derived text are untrusted and must be escaped/sanitized before rendering)
- No JWT, session token, secret code, or service-role key ever written to `localStorage`/`sessionStorage` — session tokens belong in `HttpOnly` cookies, inaccessible to JS (mitigates XSS-driven token theft)
- Audit every `NEXT_PUBLIC_*` environment variable — only the Supabase anon/public key and non-sensitive config belong there; the service-role key must never carry that prefix
- Disable source maps in production builds, or ensure they don't leak internal logic/comments that aid an attacker
- Error messages shown to the user are generic; detailed errors go to server-side logs only

---

## 16. PWA / BYOD Security

- **Never persist the secret code** — no autofill, no "remember me," no storage in IndexedDB/localStorage/service-worker cache
- Session TTL: short (e.g., end-of-shift, or a fixed inactivity window such as 30–60 minutes) — matches the earlier BYOD decision that sessions shouldn't outlive a shift on a personally-owned device
- Service worker cache must **not** cache API responses containing order data, product lists, or scan history beyond what's needed for the current active session — a lost/sold phone shouldn't retain a browsable cache of delivery data
- Explicitly exclude sensitive routes/API responses from any offline-cache strategy (`next-pwa`/Workbox `runtimeCaching` config should deny-list `/api/portal/*` responses beyond the current session)
- No push notifications carrying sensitive content (order details, quantities) — a locked-screen notification preview is a disclosure risk on a shared/lost device
- Advise (in onboarding/training, not code) against browser extensions with broad page-access permissions on the device used for scanning, since they can read page content including session state

---

## 17. Security Headers (Next.js)

```js
// next.config.js
const securityHeaders = [
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(self), microphone=(), geolocation=()' }, // camera needed for scanning
  { key: 'X-Frame-Options', value: 'DENY' },
  {
    key: 'Content-Security-Policy',
    value: [
      "default-src 'self'",
      "script-src 'self'",
      "connect-src 'self' https://*.supabase.co wss://*.supabase.co",
      "img-src 'self' data: https://*.supabase.co",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join('; '),
  },
];

module.exports = {
  async headers() {
    return [
      { source: '/(.*)', headers: securityHeaders },
      {
        source: '/api/(.*)',
        headers: [{ key: 'Cache-Control', value: 'no-store' }], // never cache API responses
      },
    ];
  },
};
```

`camera=(self)` is required (not blocked) since the Client Portal's core function depends on camera access for scanning — worth calling out explicitly so it isn't accidentally locked down during hardening. `X-XSS-Protection` is intentionally omitted — it's deprecated and can introduce its own bugs in modern browsers; CSP is the modern replacement.

---

## 18. Rate Limiting & Abuse Prevention

| Endpoint/action | Suggested limit | Enforced at |
|---|---|---|
| Admin login | 5/min per IP, lockout after 10 failures/hour | Auth layer / edge |
| Client/Portal login | 5/min per IP + per org_name combination | Auth layer / edge |
| Secret-code attempts specifically | Separate, stricter counter from password attempts (it's a weaker secret) | Auth layer |
| Barcode scans | Generous but bounded (e.g., 60/min per session) — high enough not to interrupt legitimate fast scanning, low enough to catch scripted abuse | Application layer |
| Manual scans | Lower than camera scans (they're inherently more abuse-prone, Section 9) | Application layer |
| PDF uploads | Low (e.g., 10/hour per org) — uploads are infrequent, bulk/rapid uploads are anomalous | Application layer |
| Export requests | Moderate (e.g., 20/hour per user) | Application layer |
| General API requests | Broad ceiling per session as a DoS backstop | CDN/WAF (Vercel edge) if available, else application middleware |
| Realtime connections | Cap concurrent subscriptions per session | Supabase config |

**Never rely on client-side rate limiting** — it's trivially bypassed by any direct API client. Enforce at the edge/WAF where available (cheapest to absorb abusive traffic before it reaches the app), backed by application-layer limits as the authoritative source of truth.

---

## 19. Secrets Management

| Secret | Safe in browser? | Notes |
|---|:---:|---|
| Supabase anon/public key | ✅ Yes | Designed to be public; RLS is what actually protects data, not this key's secrecy |
| Supabase **service-role** key | ❌ **Never** | Full RLS bypass — must exist only in server-side environment variables, never `NEXT_PUBLIC_*`, never in any client bundle or API response |
| Database direct credentials | ❌ Never | Server-side only, ideally not used at all in favor of the Supabase client |
| JWT signing secret | ❌ Never | Server-side/Supabase-managed only |
| PDF parser service token | ❌ Never | Server-to-server only |
| Storage credentials | ❌ Never (beyond signed URLs, which are intentionally time-limited and scoped) | |
| Vercel deployment credentials | ❌ Never | CI/CD environment only |

**Storage/rotation:** all server-side secrets in a proper secrets manager or the hosting platform's encrypted environment variable store (never committed to source control, never in `.env` files tracked by git). Rotate the service-role key and any long-lived tokens on a defined schedule and immediately upon any suspected exposure (including an accidental commit, even if quickly reverted — assume it was seen).

---

## 20. Logging & Auditing

**Log (server-side, tamper-evident, ideally append-only/shipped off-host):**
- Every authentication attempt, success and failure, across all three flows
- Session creation and termination (including Portal `DeliveryEvent` creation)
- Every permission/role change, department CRUD, secret-code regeneration
- Every upload, export, and download, with the acting identity and org
- Every manual scan entry specifically (higher scrutiny per Section 9)
- Every rejected authorization check (attempted cross-org access) — these are your earliest breach-attempt signal
- Every RLS policy denial, if Supabase exposes this (valuable signal that app-layer and DB-layer checks disagree)
- All Admin Panel actions, given the account's blast radius

**Never log:** passwords, secret codes (plaintext or hashed), session tokens, JWTs, refresh tokens, or full request bodies that might contain any of the above.

**Alerting priorities:** repeated failed logins against one org (brute force), any successful cross-org access attempt that RLS blocked (indicates an app-layer bug being actively probed), abnormal scan volume/velocity in a single session, exports at unusual volume/frequency, any Admin login from an unrecognized location/device.

---

## 21. Security Test Plan

| Test ID | Scenario | Expected secure behavior | Severity if it fails |
|---|---|---|---|
| SEC-01 | Org A's Client Main Panel requests `/api/department-orders/:id` for an Org B invoice | 404, no data returned | CRITICAL |
| SEC-02 | Client Portal session for Dept X submits a scan with a `line_item_id` from Dept Y (same org) | Rejected — scan scoped to the session's own open invoice only | HIGH |
| SEC-03 | Client Portal session for Org A submits a barcode that only exists in Org B | Generic "not recognized," never a cross-org match/suggestion | CRITICAL |
| SEC-04 | Two simultaneous scan requests for the same `line_item_id` | `delivered_qty` increments correctly by both amounts, no lost update (row-level locking verified) | HIGH |
| SEC-05 | Replay an identical scan request twice in rapid succession | Second is detected/rejected as a likely duplicate, not silently double-counted | MEDIUM |
| SEC-06 | Submit `scanned_qty: -50` | Rejected by validation before it reaches the database | HIGH |
| SEC-07 | Submit `scanned_qty: 999999999` | Rejected or flagged, not silently applied | MEDIUM |
| SEC-08 | Attempt a scan against a `fully_received` invoice | Rejected with a locked-invoice response | HIGH |
| SEC-09 | Client Main Panel PATCHes a department with a `department_id` belonging to another org | 404/403, no modification | CRITICAL |
| SEC-10 | Attacker crafts a JWT with a modified `org_id` claim (signature invalid) | Rejected at token verification, request never reaches business logic | CRITICAL |
| SEC-11 | Query Supabase directly (bypassing the app) using the anon key for another org's row | RLS denies the row | CRITICAL |
| SEC-12 | Search the client bundle / network responses for the service-role key | Not found anywhere | CRITICAL |
| SEC-13 | Upload a PDF disguised with a `.pdf` extension but non-PDF magic bytes | Rejected at content validation | HIGH |
| SEC-14 | Upload an oversized PDF | Rejected before parsing begins | MEDIUM |
| SEC-15 | Upload a PDF crafted to be maximally slow/expensive to parse | Parser times out and fails gracefully, doesn't hang the service | HIGH |
| SEC-16 | Attempt to reach an internal/private network address via the parser (SSRF probe) | Impossible — parser has no outbound network access | CRITICAL |
| SEC-17 | Request a Storage object path guessed/constructed for another org | Denied — no valid signed URL, path-guessing alone is insufficient | CRITICAL |
| SEC-18 | Subscribe to Realtime without an appropriate org-scoped filter | No cross-org rows delivered | CRITICAL |
| SEC-19 | Inject `=CMD|'/c calc'!A1`-style content into an exportable field, then export | Value is neutralized (leading quote/space), not executable on open | HIGH |
| SEC-20 | Submit a `<script>` payload as a product description (via a crafted PDF) and view it in the UI | Rendered as inert text, not executed | HIGH |
| SEC-21 | Submit a cross-site request to a state-changing endpoint from an external origin using an authenticated cookie | Rejected (CSRF protection / `SameSite` cookie) | HIGH |
| SEC-22 | Brute-force the login endpoint at high velocity | Rate-limited/locked well before credential space is meaningfully covered | HIGH |
| SEC-23 | Send extra/unexpected JSON fields in a request body (e.g., `{ ..., role: "admin" }`) | Ignored/rejected by strict schema validation, not silently applied (mass assignment) | HIGH |
| SEC-24 | Attempt to view another org's export via a previously-seen download URL after the org's session ended | URL expired / access denied | HIGH |
| SEC-25 | Portal session left idle beyond the inactivity window, then a scan is attempted | Session expired, re-authentication required | MEDIUM |

*(Only execute these against systems you're authorized to test — this plan assumes it's run against your own staging environment.)*

---

## 22. Secure Architecture

```
Internet
   |
   v
Vercel edge (TLS termination, basic WAF/rate-limit if available)
   |
   v
Next.js application
   |-- Authentication middleware (verifies JWT, rejects if invalid)
   |-- Authorization middleware (derives org_id/role from verified identity only)
   |
   v
   +------------------------------+
   |                              |
   v                              v
Supabase                     PDF parser service (isolated, no outbound network)
 |-- Postgres + RLS                |
 |-- Storage + signed URLs         v
 |-- Realtime (RLS-filtered)  Validated, structured output only
 |-- Auth                          |
   ^                               |
   |___________ transactional DB write ___________|
                        |
                        v
              Realtime notification
           (RLS-filtered to org scope)
```

**Trust boundaries, explicitly:** (1) Internet → Vercel edge — untrusted until authenticated. (2) Next.js → Supabase — authenticated but still subject to RLS as an independent check. (3) Next.js → parser — authenticated service-to-service, one-directional data flow, parser has no ability to initiate outbound calls elsewhere. (4) Any org's session → any other org's data — must be structurally impossible, not merely unlikely, enforced at both the app layer and the database layer independently.

---

## 23. Security Priority

**Top 10 Security Risks (highest impact first):**
1. Cross-tenant data access via unchecked client-supplied IDs (IDOR/BOLA)
2. Missing or permissive RLS policies (`USING (true)`, or joins that skip org scoping)
3. Service-role key exposed client-side
4. Barcode scan race conditions corrupting delivery quantities
5. Client Portal session/identity gap enabling hard-to-attribute abuse
6. PDF parser reachable for SSRF or resource-exhaustion attacks
7. Formula injection in exported spreadsheets
8. Missing rate limiting enabling brute force on secret codes
9. Realtime subscriptions bypassing tenant isolation
10. XSS via unsanitized PDF-derived content (product descriptions) rendered in the UI

**Top 10 Security Controls to Implement First:**
1. Server-derived `org_id` on every single query — no exceptions (Section 5)
2. Full RLS policy set across all nine tables, independently tested (Section 6)
3. Confirm service-role key never reaches the client, in code and in CI (Section 19)
4. Row-level locking / transactional scan processing (Section 9, 11)
5. Rate limiting on all auth endpoints and the scan endpoint (Section 18)
6. PDF parser network isolation + resource limits (Section 11)
7. Export sanitization for formula injection (Section 14)
8. Realtime RLS verification, explicitly tested (Section 13)
9. Security headers + CSP (Section 17)
10. Structured logging + alerting on cross-org denial attempts (Section 20)

---

## 24. Production Security Gate

Do not deploy to production until every item below is checked, tested, and evidenced — not just implemented:

```
[ ] Multi-tenant isolation tested (SEC-01, 09, 11)
[ ] RLS policies written for all 9 tables and independently tested
[ ] Service-role key confirmed absent from all client-side code/bundles/responses
[ ] All three authentication flows tested (including rate limiting)
[ ] Authorization matrix (Section 8) enforced and tested per role
[ ] IDOR/BOLA test suite passed (SEC-01, 02, 03, 09)
[ ] Portal secret-code protections implemented (hashing, rate limit, no persistence)
[ ] Rate limiting implemented on every endpoint in Section 18
[ ] Session handling: TTL, revocation, secure cookies all verified
[ ] PDF parser isolated (no outbound network) and resource-limited
[ ] File upload size/type/timeout limits implemented and tested
[ ] Storage policies tested — no cross-org path access possible
[ ] Realtime authorization tested (SEC-18)
[ ] Barcode/quantity manipulation tests passed (SEC-03, 06, 07, 08)
[ ] Race-condition test passed under concurrent load (SEC-04)
[ ] Security headers configured and verified in production response headers
[ ] All secrets confirmed in a proper secrets manager, none in source control
[ ] Dependency scanning (SCA) enabled in CI
[ ] Static analysis (SAST) enabled in CI
[ ] Dynamic testing (DAST) run against staging
[ ] Logging enabled for all events in Section 20
[ ] Alerting configured for the priorities in Section 20
[ ] Backup and recovery tested (not just configured)
[ ] A real penetration test completed against staging, findings remediated
```

**No CRITICAL-severity finding from Section 23 may remain open at deployment.** HIGH findings should have a documented remediation timeline; none should be silently deferred.

---

## 25. Closing Note

This assessment is a specification for what "secure" means for this system — it is not a substitute for an actual code review once implementation exists, nor for a real penetration test before launch. The single highest-leverage thing to get right, if only one thing gets built correctly first, is Section 5's authorization pattern: server-derived `org_id`, verified ownership chains, RLS as an independent backstop. Nearly every other finding in this document is a specific instance of that pattern being skipped somewhere.
