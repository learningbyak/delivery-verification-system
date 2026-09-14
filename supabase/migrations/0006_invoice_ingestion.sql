-- Phase 2: invoice ingestion tables
--
-- One uploaded PDF (upload_batches) fans out into one row per
-- DEPARTMENT: section found in it (department_orders), each
-- containing one row per product line (delivery_line_items). See
-- docs/architecture/spec.md Section 3 for why this three-level
-- structure exists — one invoice can span multiple departments.

CREATE TABLE upload_batches (
  batch_id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            uuid NOT NULL REFERENCES organizations(org_id) ON DELETE RESTRICT,
  invoice_number    text NOT NULL,
  invoice_date      date,
  uploaded_by       uuid NOT NULL REFERENCES auth.users(id),
  source_filename   text NOT NULL,
  version           int NOT NULL DEFAULT 1,
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, invoice_number, version)
);

ALTER TABLE upload_batches ENABLE ROW LEVEL SECURITY;

CREATE POLICY select_upload_batches ON upload_batches
  FOR SELECT
  USING (
    public.current_user_role() = 'admin'
    OR org_id = public.current_user_org_id()
  );

CREATE POLICY insert_upload_batches ON upload_batches
  FOR INSERT
  WITH CHECK (
    public.current_user_role() = 'admin'
    OR (public.current_user_role() = 'client_admin' AND org_id = public.current_user_org_id())
  );

-- No UPDATE/DELETE policy — an upload batch is immutable once
-- created. Corrections happen via a new version (see the UNIQUE
-- constraint above), never by editing history in place.


CREATE TABLE department_orders (
  dept_order_id  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id       uuid NOT NULL REFERENCES upload_batches(batch_id) ON DELETE RESTRICT,
  department_id  uuid NOT NULL REFERENCES departments(department_id) ON DELETE RESTRICT,
  status         text NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending', 'partially_received', 'fully_received')),
  created_at     timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE department_orders ENABLE ROW LEVEL SECURITY;

-- department_orders has no direct org_id column — scope is enforced
-- by joining through departments, which does have org_id. This is
-- exactly the pattern flagged in docs/security/assessment.md Section
-- 6 as the place cross-tenant leaks tend to hide if skipped.
CREATE POLICY select_department_orders ON department_orders
  FOR SELECT
  USING (
    public.current_user_role() = 'admin'
    OR EXISTS (
      SELECT 1 FROM public.departments d
      WHERE d.department_id = department_orders.department_id
        AND d.org_id = public.current_user_org_id()
    )
  );

CREATE POLICY insert_department_orders ON department_orders
  FOR INSERT
  WITH CHECK (
    public.current_user_role() = 'admin'
    OR (
      public.current_user_role() = 'client_admin'
      AND EXISTS (
        SELECT 1 FROM public.departments d
        WHERE d.department_id = department_orders.department_id
          AND d.org_id = public.current_user_org_id()
      )
    )
  );

-- status is never directly settable by application code — see the
-- trigger below. No general UPDATE policy is needed for application
-- use; the trigger runs as the table owner and is unaffected by RLS.


CREATE TABLE delivery_line_items (
  line_item_id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dept_order_id           uuid NOT NULL REFERENCES department_orders(dept_order_id) ON DELETE RESTRICT,
  row_data                jsonb NOT NULL,
  barcode_value           text NOT NULL,
  article_number          text,
  description             text,
  ordered_qty             numeric NOT NULL DEFAULT 0 CHECK (ordered_qty >= 0),
  supplier_reported_qty   numeric NOT NULL DEFAULT 0 CHECK (supplier_reported_qty >= 0),
  delivered_qty           numeric NOT NULL DEFAULT 0 CHECK (delivered_qty >= 0),
  err_code                text,
  line_status             text NOT NULL DEFAULT 'pending'
                            CHECK (line_status IN ('pending', 'partial', 'fully_received', 'over_received')),
  created_at              timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_delivery_line_items_dept_order ON delivery_line_items(dept_order_id);
CREATE INDEX idx_delivery_line_items_barcode ON delivery_line_items(barcode_value);

ALTER TABLE delivery_line_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY select_delivery_line_items ON delivery_line_items
  FOR SELECT
  USING (
    public.current_user_role() = 'admin'
    OR EXISTS (
      SELECT 1 FROM public.department_orders do_
      JOIN public.departments d ON d.department_id = do_.department_id
      WHERE do_.dept_order_id = delivery_line_items.dept_order_id
        AND d.org_id = public.current_user_org_id()
    )
  );

CREATE POLICY insert_delivery_line_items ON delivery_line_items
  FOR INSERT
  WITH CHECK (
    public.current_user_role() = 'admin'
    OR (
      public.current_user_role() = 'client_admin'
      AND EXISTS (
        SELECT 1 FROM public.department_orders do_
        JOIN public.departments d ON d.department_id = do_.department_id
        WHERE do_.dept_order_id = delivery_line_items.dept_order_id
          AND d.org_id = public.current_user_org_id()
      )
    )
  );

-- delivered_qty updates happen via the barcode-scanning flow, which
-- arrives in Phase 3 with its own policy (Client Portal role, scoped
-- to its own open dept_order). No UPDATE policy is added here yet —
-- deliberately, since nothing in Phase 2 should be able to change a
-- line item after it's created.


-- ── Tamper-resistant status computation ─────────────────────────
--
-- line_status is ALWAYS recomputed from delivered_qty/ordered_qty by
-- this trigger — it is never trusted as a value the application (or
-- an attacker who found a way to send one) can set directly. This
-- closes off "Manipulate delivery status" as an attack, per
-- docs/security/assessment.md Section 8.
--
-- IMPORTANT, found via direct testing (not obvious from reading the
-- SQL alone): this trigger must fire on EVERY UPDATE, not scoped to
-- "UPDATE OF delivered_qty, ordered_qty". An earlier version used
-- that column-scoped form, which meant a statement that updates
-- ONLY line_status directly (e.g. UPDATE ... SET line_status =
-- 'fully_received') never fired the trigger at all — the tampering
-- attempt succeeded silently, because the trigger literally never
-- ran. Verified with a real tampering-attempt test against Postgres
-- before and after this fix.

CREATE OR REPLACE FUNCTION public.compute_line_status()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.delivered_qty = 0 THEN
    NEW.line_status := 'pending';
  ELSIF NEW.delivered_qty < NEW.ordered_qty THEN
    NEW.line_status := 'partial';
  ELSIF NEW.delivered_qty = NEW.ordered_qty THEN
    NEW.line_status := 'fully_received';
  ELSE
    NEW.line_status := 'over_received';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_compute_line_status
BEFORE INSERT OR UPDATE ON delivery_line_items
FOR EACH ROW EXECUTE FUNCTION public.compute_line_status();


-- Whenever a line item's status could have changed, roll that up
-- into its parent department_order's aggregate status. Runs as the
-- table owner (SECURITY DEFINER-equivalent for triggers, since
-- triggers execute with the privileges of the table owner, not the
-- invoking role) — so this update is unaffected by the fact that no
-- direct UPDATE policy exists on department_orders for regular users.

CREATE OR REPLACE FUNCTION public.recompute_department_order_status()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_dept_order_id uuid;
  v_total         int;
  v_fully         int;
  v_started       int;
BEGIN
  v_dept_order_id := COALESCE(NEW.dept_order_id, OLD.dept_order_id);

  SELECT
    count(*),
    count(*) FILTER (WHERE line_status IN ('fully_received', 'over_received')),
    count(*) FILTER (WHERE delivered_qty > 0)
  INTO v_total, v_fully, v_started
  FROM public.delivery_line_items
  WHERE dept_order_id = v_dept_order_id;

  UPDATE public.department_orders
  SET status = CASE
    WHEN v_total > 0 AND v_fully = v_total THEN 'fully_received'
    WHEN v_started > 0 THEN 'partially_received'
    ELSE 'pending'
  END
  WHERE dept_order_id = v_dept_order_id;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_recompute_department_order_status
AFTER INSERT OR UPDATE OR DELETE ON delivery_line_items
FOR EACH ROW EXECUTE FUNCTION public.recompute_department_order_status();
