-- Phase 3: Client Portal + barcode scanning core loop.
--
-- Portal sessions have no individual Supabase Auth user created by an
-- Admin (unlike admin/client_admin) — a person just proves they know
-- an org's secret code. We still want a real, RLS-capable identity
-- for each session rather than bypassing RLS entirely, so the flow
-- is:
--   1. Browser calls supabase.auth.signInAnonymously() (a real
--      Supabase Auth feature — creates a real, if identity-less,
--      auth.users row and a real session/JWT).
--   2. Browser calls create_portal_session(org_name, secret_code) —
--      verifies the code, and if valid, attaches a 'portal' profile
--      (role + org_id) to that anonymous session.
-- From that point on, current_user_role()/current_user_org_id() work
-- normally for this session, same as any other role.

-- ── Allow 'portal' as a profile role ────────────────────────────

ALTER TABLE profiles DROP CONSTRAINT admin_has_no_org_client_admin_requires_org;
ALTER TABLE profiles DROP CONSTRAINT profiles_role_check;

ALTER TABLE profiles ADD CONSTRAINT profiles_role_check
  CHECK (role IN ('admin', 'client_admin', 'portal'));

ALTER TABLE profiles ADD CONSTRAINT admin_has_no_org_others_require_org CHECK (
  (role = 'admin' AND org_id IS NULL) OR
  (role IN ('client_admin', 'portal') AND org_id IS NOT NULL)
);

-- ── create_portal_session ────────────────────────────────────────
--
-- SECURITY DEFINER, narrowly scoped: the only thing this function is
-- allowed to do is attach a 'portal' profile to the CALLING user's
-- own anonymous session (auth.uid()), and only after independently
-- verifying the org secret code — reusing verify_org_secret_code
-- rather than duplicating that check. A caller cannot use this to
-- create a profile for anyone other than themselves, and cannot call
-- it twice to change orgs once a profile exists (idempotent no-op).

CREATE OR REPLACE FUNCTION public.create_portal_session(p_org_name text, p_secret_code text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id uuid;
  v_caller uuid := auth.uid();
BEGIN
  IF v_caller IS NULL THEN
    RETURN NULL;
  END IF;

  -- Already has a profile (of any role) — never overwrite.
  IF EXISTS (SELECT 1 FROM public.profiles WHERE id = v_caller) THEN
    RETURN NULL;
  END IF;

  v_org_id := public.verify_org_secret_code(p_org_name, p_secret_code);
  IF v_org_id IS NULL THEN
    RETURN NULL;
  END IF;

  INSERT INTO public.profiles (id, role, org_id) VALUES (v_caller, 'portal', v_org_id);
  RETURN v_org_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_portal_session(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_portal_session(text, text) TO authenticated;


-- ── delivery_events ───────────────────────────────────────────────
--
-- One row per Portal scanning session: department + invoice picked,
-- staff name entered. Scans (scan_events) reference this, giving
-- every scan an attributable session even though Portal has no
-- individual login identity.

CREATE TABLE delivery_events (
  event_id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dept_order_id uuid NOT NULL REFERENCES department_orders(dept_order_id) ON DELETE RESTRICT,
  staff_name    text NOT NULL,
  started_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE delivery_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY select_delivery_events ON delivery_events
  FOR SELECT
  USING (
    public.current_user_role() = 'admin'
    OR EXISTS (
      SELECT 1 FROM public.department_orders do_
      JOIN public.departments d ON d.department_id = do_.department_id
      WHERE do_.dept_order_id = delivery_events.dept_order_id
        AND d.org_id = public.current_user_org_id()
    )
  );

CREATE POLICY insert_delivery_events ON delivery_events
  FOR INSERT
  WITH CHECK (
    public.current_user_role() = 'portal'
    AND EXISTS (
      SELECT 1 FROM public.department_orders do_
      JOIN public.departments d ON d.department_id = do_.department_id
      WHERE do_.dept_order_id = delivery_events.dept_order_id
        AND d.org_id = public.current_user_org_id()
    )
  );


-- ── scan_events ───────────────────────────────────────────────────
--
-- Audit trail, one row per scan. Written exclusively by process_scan
-- below (SECURITY DEFINER) — Portal sessions get no direct INSERT
-- grant on this table, so this is the only path a scan can be
-- recorded through.

CREATE TABLE scan_events (
  scan_id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  line_item_id     uuid NOT NULL REFERENCES delivery_line_items(line_item_id) ON DELETE RESTRICT,
  event_id         uuid NOT NULL REFERENCES delivery_events(event_id) ON DELETE RESTRICT,
  scanned_qty      numeric NOT NULL CHECK (scanned_qty > 0),
  method           text NOT NULL DEFAULT 'camera' CHECK (method IN ('camera', 'manual')),
  idempotency_key  uuid NOT NULL,
  scanned_at       timestamptz NOT NULL DEFAULT now(),
  -- One row per (event, idempotency_key) — this is what makes a
  -- resubmitted request (e.g. a flaky network retry sending the exact
  -- same scan twice) safely rejected as a duplicate, WITHOUT also
  -- rejecting a genuinely new scan of another unit of the same
  -- product moments later. A time-window heuristic was tried first
  -- and rejected: it would have incorrectly blocked the very common
  -- case of an employee scanning several units of one SKU back to
  -- back within a couple of seconds. The client generates a fresh
  -- random key per physical scan action (see the scan UI) — replaying
  -- the same request reuses the same key, a new scan gets a new one.
  UNIQUE (event_id, idempotency_key)
);

CREATE INDEX idx_scan_events_line_item ON scan_events(line_item_id);
CREATE INDEX idx_scan_events_event ON scan_events(event_id);

ALTER TABLE scan_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY select_scan_events ON scan_events
  FOR SELECT
  USING (
    public.current_user_role() = 'admin'
    OR EXISTS (
      SELECT 1 FROM public.delivery_line_items li
      JOIN public.department_orders do_ ON do_.dept_order_id = li.dept_order_id
      JOIN public.departments d ON d.department_id = do_.department_id
      WHERE li.line_item_id = scan_events.line_item_id
        AND d.org_id = public.current_user_org_id()
    )
  );

-- No INSERT policy for any role — see process_scan.


-- ── process_scan ──────────────────────────────────────────────────
--
-- The highest-risk endpoint in the system (per docs/security/
-- assessment.md). SECURITY DEFINER — but every rule normally
-- enforced by RLS is re-implemented explicitly and manually here,
-- since DEFINER bypasses RLS entirely. In particular: the caller's
-- own org_id (from their own profile, via current_user_org_id() —
-- itself safe to call) is explicitly compared against the target
-- event's org before anything else happens. Skipping this check is
-- the classic SECURITY DEFINER mistake — verified directly with a
-- real cross-org attack attempt (see docs/phases/phase-3.md).
--
-- All checks from the security assessment's /api/portal/scan
-- deep-dive, in one atomic transaction:
--   - caller must be role='portal'
--   - event must belong to the caller's own org (cross-org check)
--   - target invoice must not be locked (fully_received)
--   - barcode lookup scoped to this exact dept_order_id only
--   - on no match: search other departments in the SAME ORG only,
--     suggest if found, generic "not recognized" if not (never
--     reveals cross-org existence either way)
--   - scanned_qty bounded (positive, capped)
--   - row-level lock (FOR UPDATE) on the specific line item, so
--     concurrent scans of the same barcode serialize instead of
--     racing and losing an update
--   - idempotency via a client-generated key per physical scan
--     action, NOT a time-window heuristic — a time window was tried
--     first and rejected, since it would incorrectly block the very
--     common case of scanning several units of one product within a
--     couple of seconds of each other. A resubmitted request reusing
--     the same key is a safe no-op replay; a new scan gets a new key.

CREATE OR REPLACE FUNCTION public.process_scan(
  p_event_id         uuid,
  p_barcode_value    text,
  p_idempotency_key  uuid,
  p_scanned_qty      numeric DEFAULT 1,
  p_method           text DEFAULT 'camera'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_org_id    uuid;
  v_dept_order_id    uuid;
  v_dept_org_id      uuid;
  v_dept_status      text;
  v_line_item        record;
  v_other_dept_name  text;
  v_existing_scan    record;
BEGIN
  IF public.current_user_role() != 'portal' THEN
    RETURN jsonb_build_object('result', 'error', 'message', 'Not authorized');
  END IF;
  v_caller_org_id := public.current_user_org_id();

  IF p_method NOT IN ('camera', 'manual') THEN
    RETURN jsonb_build_object('result', 'error', 'message', 'Invalid method');
  END IF;

  IF p_idempotency_key IS NULL THEN
    RETURN jsonb_build_object('result', 'error', 'message', 'Missing idempotency key');
  END IF;

  IF p_scanned_qty IS NULL OR p_scanned_qty <= 0 OR p_scanned_qty > 10000 THEN
    RETURN jsonb_build_object('result', 'error', 'message', 'Invalid quantity');
  END IF;

  -- Resolve event -> dept_order -> org, and verify it's really this
  -- caller's own org. This is the check that makes SECURITY DEFINER
  -- safe here — without it, any event_id from any org would work.
  SELECT do_.dept_order_id, d.org_id, do_.status
  INTO v_dept_order_id, v_dept_org_id, v_dept_status
  FROM public.delivery_events de
  JOIN public.department_orders do_ ON do_.dept_order_id = de.dept_order_id
  JOIN public.departments d ON d.department_id = do_.department_id
  WHERE de.event_id = p_event_id;

  IF v_dept_order_id IS NULL OR v_dept_org_id IS NULL OR v_dept_org_id != v_caller_org_id THEN
    RETURN jsonb_build_object('result', 'error', 'message', 'Invalid session');
  END IF;

  -- Idempotency check FIRST, before anything else: if this exact
  -- physical scan action was already processed (a resubmitted/retried
  -- request reusing the same key), return the same outcome again
  -- rather than reprocessing it. Deliberately checked before the
  -- locked-invoice check too, so a retried request for a scan that
  -- already succeeded doesn't get a confusing "locked" response if
  -- the invoice was completed in between.
  SELECT se.scanned_qty, li.description, li.received_qty, li.ordered_qty
  INTO v_existing_scan
  FROM public.scan_events se
  JOIN public.delivery_line_items li ON li.line_item_id = se.line_item_id
  WHERE se.event_id = p_event_id AND se.idempotency_key = p_idempotency_key;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'result', 'ok',
      'description', v_existing_scan.description,
      'received_qty', v_existing_scan.received_qty,
      'ordered_qty', v_existing_scan.ordered_qty,
      'replay', true
    );
  END IF;

  IF v_dept_status = 'fully_received' THEN
    RETURN jsonb_build_object('result', 'locked', 'message', 'This invoice is fully received and locked.');
  END IF;

  -- Row-level lock: this SELECT ... FOR UPDATE is what prevents two
  -- concurrent scans of the same barcode from both reading the same
  -- stale received_qty and one of them getting lost. Verified with a
  -- real concurrent-request test, not assumed (see phase-3 test notes).
  SELECT * INTO v_line_item
  FROM public.delivery_line_items
  WHERE dept_order_id = v_dept_order_id AND barcode_value = p_barcode_value
  FOR UPDATE;

  IF v_line_item IS NULL THEN
    SELECT d.department_name INTO v_other_dept_name
    FROM public.delivery_line_items li
    JOIN public.department_orders do2 ON do2.dept_order_id = li.dept_order_id
    JOIN public.departments d ON d.department_id = do2.department_id
    WHERE li.barcode_value = p_barcode_value
      AND d.org_id = v_caller_org_id
    LIMIT 1;

    IF v_other_dept_name IS NOT NULL THEN
      RETURN jsonb_build_object(
        'result', 'wrong_department',
        'message', format(
          'You have scanned a wrong product for this department. Suggestion: this product may belong to %s.',
          v_other_dept_name
        )
      );
    ELSE
      RETURN jsonb_build_object('result', 'not_found', 'message', 'Barcode not recognized.');
    END IF;
  END IF;

  UPDATE public.delivery_line_items
  SET received_qty = received_qty + p_scanned_qty
  WHERE line_item_id = v_line_item.line_item_id;

  INSERT INTO public.scan_events (line_item_id, event_id, scanned_qty, method, idempotency_key)
  VALUES (v_line_item.line_item_id, p_event_id, p_scanned_qty, p_method, p_idempotency_key);

  RETURN jsonb_build_object(
    'result', 'ok',
    'description', v_line_item.description,
    'received_qty', v_line_item.received_qty + p_scanned_qty,
    'ordered_qty', v_line_item.ordered_qty
  );
END;
$$;

REVOKE ALL ON FUNCTION public.process_scan(uuid, text, uuid, numeric, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.process_scan(uuid, text, uuid, numeric, text) TO authenticated;
