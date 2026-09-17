# Delivery Verification System — Architecture & Data Model

**Status:** Draft v3 — all core decisions confirmed, ready to build
**Purpose:** Confirm the data model, roles, and workflows before implementation begins

---

## 1. System Overview

A multi-tenant web application with three access levels:

| Module | Who uses it | Core purpose |
|---|---|---|
| **Admin Panel** | You / your ops team | Manage all client organizations, upload data for any org, full visibility |
| **Client Main Panel** | Client's own admin/manager | Manage their own org only: departments, uploads, status sheets |
| **Client Portal** | Client's front-line staff (receiving dock) | Log in with org name + secret code, scan barcodes, no access to status data |

**Key principle:** every piece of data belongs to exactly one client organization. No client can ever see another client's data. The Admin can see everything.

---

## 2. Roles & Permissions

| Capability | Admin | Client Main Panel (Client Admin) | Client Portal (staff) |
|---|:---:|:---:|:---:|
| Create/edit client organizations | ✅ | ❌ | ❌ |
| Set/reset an org's secret code | ✅ | ✅ (own org only) | ❌ |
| Create/edit departments | ✅ | ✅ (own org only) | ❌ |
| Upload delivery/invoice files | ✅ (any org) | ✅ (own org only) | ❌ |
| View raw uploaded sheet | ✅ | ✅ (own org only) | ❌ |
| View delivery status sheet | ✅ | ✅ (own org only) | ❌ |
| Scan barcodes / update delivery | ✅ (any org, for testing) | ✅ | ✅ |
| View other clients' data | ✅ | ❌ | ❌ |

**Login & navigation model (Client Portal):**
1. Org name + secret code
2. List of **departments** for that org
3. List of **invoice dates** for that department (open, not-yet-fully-received invoices only)
4. **Name popup** — required before scanning
5. Device **camera opens in-browser** for barcode scanning
6. Identical pattern across every department — no department-specific variation

**Login model (all roles):**
- **Admin:** standard email + password (or SSO later), one shared admin team.
- **Client Main Panel:** same org name + secret code as Client Portal, but flagged as an **admin-level user** for that org — plus ideally an individual username/password layered on top (see §7, Security).
- **Client Portal:** org name + secret code only — lightweight, shared login, name captured per session instead of individual accounts.

---

## 3. Core Data Model

### 3.1 Entities

Based on the real sample invoice, one uploaded PDF is not a single flat table — it's **one invoice spanning multiple departments**, each with its own line items and its own subtotal. The schema below reflects that directly, plus the decisions confirmed in §8.

```
Organization
 ├── Department (many per org — auto-created/matched from PDF department names)
 ├── User (Client Main Panel users, belongs to one org)
 ├── UploadBatch (one per PDF/file uploaded — holds invoice-level info)
 │     └── DepartmentOrder (one per department section found in that invoice)
 │           └── DeliveryLineItem (one per product row within that department)
 │                 └── ScanEvent (one per barcode scan against that line item)
 ├── DeliveryEvent (one per physical truck arrival — captures actual date + staff name)
 └── SecretCode (current active code, with history)
```

**Why the extra `DepartmentOrder` layer:** your sample invoice has ONE invoice number (6516202419) containing EIGHT departments (Liquor, Baby, Grocery, Natural Foods, OTC, HBA, HMR, Deli), each with its own line items and subtotal. A single upload needs to fan out into multiple department-scoped record sets, not one. `DepartmentOrder` is what lets the Client Main Panel view one department's sheet without seeing another's, even though both came from the same uploaded file.

### 3.2 Table-level detail

**Organization**
| Field | Type | Notes |
|---|---|---|
| org_id | UUID (PK) | |
| org_name | string, unique | Used at login |
| secret_code_hash | string | Hashed, never stored plain (see §7) |
| status | enum | active / suspended |
| created_at | timestamp | |

**Department**
| Field | Type | Notes |
|---|---|---|
| department_id | UUID (PK) | |
| org_id | FK → Organization | |
| department_name | string | Unique within org |
| source_dept_code | string, nullable | The code from the PDF (e.g. `1021`), stored so future uploads auto-match to this department by code, not just by name text |

**User** (Client Main Panel only — Client Portal has no individual user rows)
| Field | Type | Notes |
|---|---|---|
| user_id | UUID (PK) | |
| org_id | FK → Organization | |
| role | enum | `client_admin` (or `admin` for internal Admin Panel users, org_id = null) |
| email / username | string | |
| password_hash | string | |

**UploadBatch** — one row per PDF/file uploaded
| Field | Type | Notes |
|---|---|---|
| batch_id | UUID (PK) | |
| org_id | FK → Organization | |
| invoice_number | string | The supplier's invoice number (e.g. `6516202419`) — this is the **Order ID** that should persist if a delivery splits across multiple physical arrivals |
| invoice_date | date | Parsed directly from the PDF (e.g. `30.AUG.2026`) |
| uploaded_by | FK → User (or Admin) | |
| source_filename | string | Original filename, for reference |
| column_schema | JSON | Ordered list of original column names per department table, preserved exactly as uploaded |
| created_at | timestamp | |

**DepartmentOrder** — one per department section detected within the uploaded invoice
| Field | Type | Notes |
|---|---|---|
| dept_order_id | UUID (PK) | |
| batch_id | FK → UploadBatch | |
| department_id | FK → Department | Matched/created from the PDF's `DEPARTMENT: 1021 Grocery` header |
| status | enum | pending / partially_received / fully_received |

**DeliveryLineItem** — one row per product row within a department section

> **Terminology, finalized in Phase 2 after real-world use:** `delivered_qty` means what the *invoice* claims was delivered (the supplier's own `DR Qty` column). `received_qty` means what an *employee scan* actually verified. This is the opposite of an earlier internal naming (`supplier_reported_qty` / `delivered_qty`) that caused real confusion — renamed via migration `0009` to match how the business actually talks about it.

| Field | Type | Notes |
|---|---|---|
| line_item_id | UUID (PK) | |
| dept_order_id | FK → DepartmentOrder | |
| row_data | JSON | The full original row exactly as printed — every column preserved, nothing dropped |
| barcode_value | string | Extracted from the `UPC Code` column, indexed for fast scan lookup |
| pack_size | string | e.g. `"20"` — from the invoice's Pack Size column |
| size_spec | string | e.g. `"20x410.000G"` — from the invoice's Size column, displayed alongside pack_size |
| ordered_qty | number | From `Ord Qty` |
| delivered_qty | number | From `DR Qty` — what the **supplier claims** they shipped (not verified by your staff) |
| received_qty | number | Starts at **zero**, only ever changed by an actual employee scan (Phase 3) — never inferred from the invoice |
| err_code | string, nullable | From `Err Code` (e.g. `092`, `260`) — supplier's own shortage reason, kept for reference |
| line_status | enum | pending / partial / fully_received / over_received — computed from `received_qty` vs `ordered_qty` (see §6) |

**DeliveryEvent** — one per scanning session (created when staff select an invoice date + enter their name)
| Field | Type | Notes |
|---|---|---|
| event_id | UUID (PK) | |
| dept_order_id | FK → DepartmentOrder | The specific open invoice being scanned against — selected from the invoice-date list, not manually dated |
| staff_name | string | Entered via the popup before scanning is allowed |
| started_at | timestamp | |

> **Change from earlier draft:** the "actual delivery date, entered manually" field has been removed. Per your latest instruction, the system uses **only the invoice date already on file** — staff select which open invoice they're scanning against from a list, they don't enter a new date themselves.

**ScanEvent** — audit trail, one row per scan (never overwritten, so history is preserved)
| Field | Type | Notes |
|---|---|---|
| scan_id | UUID (PK) | |
| line_item_id | FK → DeliveryLineItem | |
| event_id | FK → DeliveryEvent | Links the scan to a specific truck arrival + staff name |
| scanned_qty | number | Usually 1, or entered manually |
| scanned_at | timestamp | |

### 3.3 Why row_data is stored as flexible JSON, not fixed columns

Your requirement — *"preserve the same columns and rows from the original file"* — plus the real sample invoice having ~14 columns (UPC Code, Article Number, Description, Pack Size, Ord Qty, DR Qty, Err Code, Unit Cost, Extended Cost, Tax, Retail Price, GPM%, PR) means the system shouldn't assume a fixed schema. Storing each row as JSON:

- Preserves every original column and value, in order, exactly as printed
- Lets the status sheet render `row_data` + one extra computed **Delivery Status** column, matching your requirement exactly
- Handles the fact that different suppliers (not just different clients) may format invoices differently, without a database migration each time

---

## 4. Upload & Ingestion Flow

### 4.1 Supported format

**PDF, confirmed.** The sample is a computer-generated, template-based invoice (Loblaws DC format) — consistent structure invoice-to-invoice, which is the case where rule-based extraction (no AI needed) works reliably. That said, this format is more involved than a simple flat table, and the parser needs to specifically handle:

- **Multi-department sections** within one invoice, each with its own header (`DEPARTMENT: 1021 Grocery`) and its own subtotal row (`Department Total`) — subtotal rows must be excluded from line items, not read as products
- **Repeated column headers on every page** (the table header reprints every time the PDF paginates) — these repeats must be recognized and skipped, not parsed as data rows
- **Multi-line product descriptions** — some `Description` values wrap onto two lines within a cell (e.g. "COORS SELTZ SLUSHIE MIXER / 12PK") and need to be merged back into one logical row
- **Trailing summary sections** (`INVOICE SUMMARY BY DEPARTMENT`, `SHORT SUMMARY`) — these use a completely different table layout and must be excluded from line-item parsing. The `SHORT SUMMARY` section is still useful, though — it explains *why* specific items were short (matched by Article Number), and can be stored as supplementary notes attached to the relevant line items rather than discarded
- **Numbers formatted with commas** (e.g. `Line No.` shown as `2,660`) — needs numeric parsing before storage

None of this requires AI — it's deterministic parsing logic specific to this invoice template. If a different supplier's invoice uses a meaningfully different layout later, that template would need its own parsing rules (or a fallback to AI extraction for that supplier only).

### 4.2 Upload steps (Admin or Client Main Panel)

1. User selects **Organization** (Admin only — Client Main Panel is locked to their own org).
2. User uploads the PDF. No manual department selection needed — the departments come from the invoice itself.
3. System parses the invoice: extracts `invoice_number`, `invoice_date`, then walks each `DEPARTMENT:` section, creating one `DepartmentOrder` per section and matching/creating the corresponding `Department` record by its source code (e.g. `1021`).
4. For each line item: `barcode_value` = UPC Code, `ordered_qty` = Ord Qty, `supplier_reported_qty` = DR Qty, and `delivered_qty` **starts at zero** — see the Phase 2 revision note below (§8, decision 7).
5. The new sheets are immediately visible to the Client Main Panel (and Admin) for that org, split by department — not visible to Client Portal users.

### 4.3 Handling re-uploads / corrections

Worth deciding: if a corrected file for the same invoice number is uploaded again, should it **replace** the previous batch, or create a **new version** alongside it (with the old one archived)? Recommend versioning rather than overwrite, so scan history is never lost.

---

## 5. Delivery Flow (Client Portal)

1. Staff logs in with **org name + secret code**.
2. Staff selects **Department**.
3. Staff sees a **list of invoice dates** for that department — pulled directly from `invoice_date` on each open (`not fully_received`) `DepartmentOrder`. **Locked (`fully_received`) invoices are either hidden or clearly shown as locked** — see step 9.
4. Staff selects the relevant invoice date → popup requires **entering their name** → creates a `DeliveryEvent` linked to that specific `DepartmentOrder`.
5. Staff opens their device **camera in-browser** and scans a barcode.
6. System looks up `barcode_value` against `DeliveryLineItem` rows within that selected `DepartmentOrder` only.
7. On match:
   - Creates a `ScanEvent`, linked to the current `DeliveryEvent`
   - Increments `delivered_qty` on the line item (starting from its supplier-reported baseline)
   - Recalculates `line_status`
   - **Updates the Client Main Panel's sheet immediately** (see §12, Real-Time Updates) — this is the "directly reflect on the sheet" behavior you described
   - Shows on-screen confirmation to staff (item name, running count) — **no visibility into ordered totals, supplier-reported quantities, or other lines**
8. On no match within the selected `DepartmentOrder`: the system searches the **same barcode across every other department in the org** before giving up:
   - **Found elsewhere:** *"You have scanned a wrong product for [Selected Department]. Suggestion: this product may belong to [Suggested Department]."* Staff can switch department/invoice without re-logging in, and re-scan.
   - **Not found anywhere in the org:** "barcode not recognized" message, with a manual fallback to search/select the product (for damaged/unreadable barcodes).
9. **Locked invoices:** once a `DepartmentOrder` reaches `fully_received`, it is **locked** — no further scans are accepted against it. Staff attempting to select it see a clear "this invoice is fully received and locked" message before the camera opens. This matches your confirmation that completed invoices should stop accepting scans, while remaining exportable by the Client Main Panel (§6).

**Cross-delivery tracking:** because line items live under `DepartmentOrder` (tied to the invoice number) and stay in the "open" list until fully received, a second physical truck arriving later against the same invoice just shows up again in the same invoice-date list — staff pick it, scan, and `delivered_qty` keeps accumulating from wherever it was. The Client Main Panel always sees one merged, cumulative sheet per invoice/department.

---

## 6. Delivery Status Column — Computation Logic

For each `DeliveryLineItem`:

| Condition | line_status |
|---|---|
| `received_qty == 0` | Pending |
| `0 < received_qty < ordered_qty` | Partial |
| `received_qty == ordered_qty` | Fully Received |
| `received_qty > ordered_qty` | Over-received (flagged for review) |

**Revised during Phase 2, after real-world testing:** `received_qty` (renamed from an earlier `delivered_qty`) never starts pre-filled from the supplier's claim. It starts at zero for every line, so every line shows "Pending" immediately after upload, regardless of what the supplier's invoice claims. The invoice's own number is stored separately as `delivered_qty` (renamed from an earlier `supplier_reported_qty`) — useful for comparing against what staff actually scan — but it no longer drives status on its own. The original pre-fill design turned out to defeat the actual purpose of the system: it let the system report a delivery as complete based purely on the supplier's paperwork, before any physical verification occurred. See `docs/phases/phase-2.md` and migrations `0008`/`0009` for the full reasoning and the fix.

For the whole `DepartmentOrder` (sheet-level status, shown to Client Main Panel):
- **Pending** — no lines confirmed yet
- **Partially Received** — some lines complete, not all
- **Fully Received** — all lines at 100% — **this triggers the lock described in §5, step 9**: no further scans accepted against this invoice. The Client Main Panel can still open and **export it as a sheet at any time** after locking — locking only blocks new scans, not viewing/exporting.

This matches your requirement: *"how many products have been delivered, how many are still pending, and the overall delivery status."*

---

## 7. Security Considerations

- **Secret codes** should be hashed at rest (never stored in plain text), same as a password — even though it's shared across a team, a leak would expose every department's delivery data for that org.
- **Tenant isolation**: every database query must be scoped by `org_id` — enforced at the database layer via Postgres Row-Level Security (RLS), not just trusted from application code. This is also what makes the future privacy-isolation switch in §11 realistic later.
- **Rate limiting** on the login endpoint, since org name + secret code is a shared-secret model and more guessable than individual passwords.
- Recommend **secret code rotation** capability for Client Main Panel (e.g., if a departing employee had it).
- Consider whether Client Portal sessions should auto-expire (e.g., end of shift) given it's a shared/kiosk-style login.
- **BYOD-specific (personal phones, per §8 decision 13):** since staff use their own devices, not company-controlled ones, sessions should **not persist indefinitely** — auto-expire at end of shift or after a period of inactivity, so a phone lost or sold later doesn't retain standing access. The org's secret code should never be auto-saved/remembered by the browser on a personal device; require re-entry each session rather than a "stay logged in" option.
- **No sensitive data cached on-device** beyond what's needed for the current scanning session — since the phone isn't owned or managed by the organization, avoid persisting order data, product lists, or scan history locally beyond the active session.

---

## 8. Decisions Confirmed

| # | Decision | Resolution |
|---|---|---|
| 1 | Client Main Panel vs Client Admin | Same role — confirmed |
| 2 | Backorder / partial delivery tracking | Solved via `DepartmentOrder` + `DeliveryEvent` — one cumulative sheet per invoice/department across multiple truck arrivals |
| 3 | Client Portal staff identity | Not anonymous — name entered via popup after department selection, before scanning is allowed; captured on `DeliveryEvent` |
| 4 | Client Main Panel CRUD | Full CRUD on departments confirmed, including rename |
| 5 | Delivery date | **Revised:** only `invoice_date` (from PDF) is used — staff select from a list of existing invoice dates rather than entering a new date (see §5) |
| 6 | Department mapping | Auto-created/matched directly from the PDF's own `DEPARTMENT:` sections, keyed by source department code |
| 7 | Supplier's DR Qty vs dock scans | **Revised in Phase 2** — `received_qty` (the scan-driven field) starts at zero, never pre-filled from the supplier's claim; only real dock scans (Phase 3) increment it. The invoice's own claimed quantity is stored as `delivered_qty`, retained as a reference/comparison value only. See migrations `0008` and `0009` (the latter also renamed the fields to their final names). |
| 8 | File format | PDF, confirmed — Loblaws DC invoice template, consistent structure, rule-based extraction (no AI needed) |
| 9 | Wrong-department/invoice scans | System refuses the scan and searches other departments for a match, suggesting the correct one if found (§5, step 8) |
| 10 | Fully Received invoices | Locked from further scans once complete; remains viewable/exportable by Client Main Panel at any time (§5, step 9; §6) |
| 11 | Re-upload behavior | **Versioning** — a re-upload of the same invoice number creates a new version, old one archived; scan history never overwritten (§4.3) |
| 12 | Admin visibility into scans | Admin sees **live scan activity across all orgs today**, built via a dedicated, scalable activity-feed design so this keeps working smoothly at large scale — see §13 |
| 13 | Device type for scanning | **Personal phones (BYOD)** — no dedicated/company-issued hardware. This shapes several details in §7 and §10 below. |

## 9. Remaining Open Items — Build Notes (Not Blocking)

1. **Article Number is not always unique** — in the sample, article `21107622` appears twice under different UPCs with different costs (different lot/pricing). Barcode (`UPC Code`) will be the primary match key for scans, which sidesteps this — just flagging it so it's not a surprise later.
2. **Other suppliers** — this schema and parser are built against the Loblaws DC template specifically. If departments will also receive invoices from other suppliers with different layouts, each new layout needs its own parsing rules added over time (or an AI-extraction fallback for lower-volume/one-off suppliers).

---

## 10. Camera-Based Scanning — Technical Notes

Your requirement is in-browser camera scanning (no dedicated USB hardware) — this is a meaningful shift from the original grocery-store plan and has its own considerations:

- **Confirmed: personal phones (BYOD), not company-issued devices** (§8, decision 13) — this makes cross-device/cross-browser reliability more important than it would be with a controlled device fleet, since you can't standardize on one phone model or browser version.
- **Detection method:** the native `BarcodeDetector` Web API works in Chrome/Edge/Android but is **not supported in Safari/iOS** — a significant share of personal phones. A JS library fallback (e.g. `ZXing-js` or `html5-qrcode`) is required, not optional, for full coverage — without it, iPhone-using staff simply couldn't scan.
- **HTTPS required:** camera access in-browser only works over HTTPS — not a concern in production, but matters for local testing setup.
- **Lighting/angle sensitivity:** camera-based scanning is generally less forgiving than a dedicated laser/CCD scanner, and personal phone cameras vary widely in quality — expect a slightly higher rate of failed scans in poor warehouse lighting, more so on older/budget phones. The manual fallback (search/select product) becomes more important here, not just a nice-to-have.
- **Recommend building as a PWA** (installable web app) — gives staff a home-screen icon and a more native feel without needing app-store deployment or MDM (mobile device management) enrollment, which wouldn't be realistic on personal phones anyway.
- **No app-store distribution needed** — since it's a PWA accessed via URL, there's no app review process, no per-device installation step for you to manage, and updates roll out instantly to everyone the next time they open it. This is one of the practical upsides of the BYOD + web-app approach.

## 11. Multi-Tenancy & Future Scaling (Privacy Isolation Switch)

Per your note about eventually isolating specific clients into their own database for privacy at scale:

- **Today:** single shared database, every table scoped by `org_id`, enforced with **Postgres Row-Level Security (RLS)** — Supabase supports this natively. This means tenant isolation is enforced at the database layer itself, not just trusted application code — a meaningful security upgrade on its own, independent of future scaling plans.
- **Application layer discipline:** as long as all data access goes through an `org_id`-aware layer (not scattered raw queries), "isolating" a specific large client later is a **data migration task**, not an application rewrite — export that org's rows, stand up a dedicated database/schema, repoint that tenant's requests.
- **Recommendation:** build this discipline in from day one, even while everyone shares one database — it costs little now and avoids a painful retrofit later.

## 12. Real-Time Sheet Updates

Your requirement that a scan should "directly reflect on the sheet" needs a live-update mechanism, not just a save-and-manually-refresh pattern:

- **Recommended:** Supabase Realtime — it can push database changes directly to the Client Main Panel's open browser tab the moment a `ScanEvent` lands, with minimal custom infrastructure (this pairs naturally with the Supabase database recommendation below).
- **Alternative:** custom WebSocket/Server-Sent Events layer if you move away from Supabase — more setup work, same end result.
- Either way, this is a core requirement, not a polish item — worth building in from the first working version rather than bolting on later.

---

## 13. Admin Live Activity Feed — Scalable Design

Right now, Admin sees live scan activity across every org — confirmed. To make sure this stays fast and simple as the client count grows, it's built as its own decoupled piece rather than a query against the core scanning tables:

**A dedicated `ScanActivityLog` table**, written at the same moment a scan happens — separate from the core `ScanEvent` audit trail used for corrections/history (§3.2):

| Field | Type | Notes |
|---|---|---|
| activity_id | UUID (PK) | |
| org_id | FK → Organization | Indexed |
| org_name | string | Denormalized — avoids a join just to render the feed |
| department_name | string | Denormalized |
| product_name | string | Denormalized |
| staff_name | string | |
| scanned_at | timestamp | Indexed: `(org_id, scanned_at DESC)` and `(scanned_at DESC)` |

This is what the Admin dashboard reads — never the raw `ScanEvent`/`DeliveryLineItem` tables directly. A flat, purpose-indexed table stays fast regardless of how many orgs or how much scan history accumulates.

**One function, scoped by an optional parameter:**
```
getScanActivity(orgId?: string, cursor?, limit = 50)
```
- No `orgId` → Admin's cross-org feed
- Specific `orgId` → same function, scoped to one org (reusable later if Client Main Panel ever wants their own live feed too)

One implementation, not a separate "admin version" that drifts out of sync over time.

**Real-time delivery:** Admin subscribes unscoped; Client Main Panel subscribes scoped to their `org_id` — same Supabase Realtime mechanism from §12, just a different filter, no separate infrastructure.

**Pagination from day one:** cursor-based by `scanned_at`, not "load everything" — stays fast at 50 scans or 5 million.

**Connection to the future privacy switch (§11):** because Admin's visibility is a *query scope*, not hardcoded logic, isolating a large client later is a business decision, not a re-engineering effort — stop writing that org into the shared `ScanActivityLog`, or fan the admin query out across databases if that org gets its own. Core scanning logic doesn't change either way.

---

## 14. Suggested Tech Stack

| Layer | Recommendation | Why |
|---|---|---|
| Frontend | React (or Next.js) | Three distinct panels as route-guarded sections of one app |
| Backend | Node.js (Express/Fastify) or Python (FastAPI) | Either fits; FastAPI slightly favored if file-parsing logic (pandas) stays server-side |
| Database | PostgreSQL | Relational integrity for org/department/user, JSONB column for flexible `row_data` |
| File parsing | `openpyxl`/`pandas` (Python) or `xlsx`/`papaparse` (Node) | Both ecosystems handle CSV/XLSX well |
| Auth | JWT sessions, org-scoped middleware on every request | Enforces tenant isolation at the code level |
| Hosting | Any standard cloud host (Render, Railway, AWS, etc.) | No unusual infrastructure needs at this scale |

---

## 15. Suggested Build Order (once confirmed)

1. Core schema + Admin Panel (org/department CRUD, secret code management), RLS-based tenant isolation from the start
2. PDF ingestion for the Loblaws template (multi-department parsing, header/subtotal handling, description merging) — tested against multiple real sample invoices, not just one
3. Status sheet view (Client Main Panel), grouped by department, one merged cumulative sheet per invoice, live-updating
4. Client Portal login → department → invoice-date list → name popup
5. In-browser camera scanning → barcode match → delivered_qty update → status recalculation → real-time push to Client Main Panel (the core loop)
6. Manual fallback for failed/unreadable scans
7. Polish: re-upload/versioning, Admin monitoring view, secret code rotation, Short Summary reason display

---

## 16. Expert Recommendations — Things Worth Adding

A few things not explicitly requested but worth strongly considering, based on how systems like this tend to fail in practice:

- **Offline/poor-connectivity handling** — warehouse and dock WiFi is often patchy. If a scan happens with no connection, it should queue locally on the device and sync once reconnected, rather than silently failing. This matters more here than in a typical web app, precisely because staff are on the move with mobile devices.
- **Over-scan protection** — if `delivered_qty` would meaningfully exceed `ordered_qty` (e.g., scanning the same case twice by accident), show a confirmation prompt rather than silently incrementing. Prevents fat-finger errors from corrupting the status sheet.
- **Correction/undo capability** — staff *will* mis-scan occasionally. Client Main Panel should be able to view the `ScanEvent` audit trail for a line item and remove/adjust an erroneous scan, rather than the data being permanently stuck wrong.
- **Notifications** — an optional alert to Client Main Panel when an invoice becomes Fully Received, or when an Over-received flag appears, so they don't have to manually check every sheet to know something needs attention.
- **Multi-supplier roadmap** — this parser is built for the Loblaws template specifically. If departments receive invoices from other suppliers later, plan for either template-specific parsers per supplier or an AI-extraction fallback for lower-volume ones, rather than assuming one parser covers everything indefinitely.

## 17. Open Doubts / Questions Worth Resolving

Honest open items I don't have enough information to resolve on my own yet:

1. **Duplicate UPCs within one invoice** — rare but seen in similar real invoices: the same UPC appearing on two separate lines (e.g., a promotional bundle vs. the single unit). Barcode-based matching handles the common case fine, but worth knowing this exists as a low-probability edge case to test for.

---

**Status:** All core decisions confirmed (§8). Remaining items (§9, §17) are minor/non-blocking. Ready to move into building the working prototype whenever you give the go-ahead.
