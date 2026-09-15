-- Fix: two real bugs reported after real-world testing.
--
-- BUG 1 — partial data saved on upload failure. The original upload
-- route (Phase 2) wrote upload_batches, then looped over departments
-- doing separate INSERTs for each department/department_order/line
-- items, entirely in application code. If any step failed partway
-- through (e.g. the statement-timeout bug fixed in migration 0007,
-- or any other mid-upload failure), everything inserted BEFORE the
-- failure remained in the database — an incomplete, orphaned upload
-- that the Client Main Panel could see and be confused by. Confirmed
-- by the reporter's own screenshot showing exactly this.
--
-- Fix: the entire ingestion — creating the batch, matching/creating
-- departments, creating department_orders, and inserting every line
-- item — now happens inside ONE Postgres function call, which is one
-- transaction. If anything fails anywhere inside it, Postgres rolls
-- back everything the function did, automatically. Nothing is saved
-- unless the whole upload succeeds.
--
-- This function is SECURITY INVOKER (the default — not specified as
-- DEFINER), meaning it runs with the CALLING client_admin's own
-- privileges. RLS still applies to every INSERT inside it exactly as
-- if the client made those inserts directly — if a caller somehow
-- passed an org_id that isn't their own, the INSERT into
-- upload_batches would violate RLS's WITH CHECK policy and the whole
-- transaction would abort. Atomicity and tenant isolation both hold,
-- verified together in the same test.
--
-- BUG 2 — status showing "Fully Received" before any employee ever
-- scanned anything. The original design pre-filled delivered_qty
-- with the supplier's own claimed quantity (DR Qty) at upload time —
-- a decision made earlier in the project, now confirmed wrong in
-- practice. It meant the system could show a delivery as complete
-- based purely on the supplier's paperwork, before any physical
-- verification happened at all — defeating the actual purpose of the
-- system. Reversed: delivered_qty now starts at 0 for every line
-- item. supplier_reported_qty is still stored (useful as a reference
-- to compare against what staff actually scan, in Phase 3), but it
-- no longer drives delivered_qty or line_status.

-- Explicit grant, not assumed from Supabase's default project setup:
-- the department_order status trigger (migration 0006/0007) performs
-- an UPDATE on department_orders on behalf of whichever role
-- inserted/updated/deleted a line item. That role needs UPDATE
-- privilege on department_orders for the trigger's internal UPDATE to
-- succeed — RLS alone does not substitute for this. Found by testing
-- against a minimal local setup rather than relying on whatever
-- grants a real Supabase project happens to provision by default.
GRANT UPDATE ON public.department_orders TO authenticated;

CREATE OR REPLACE FUNCTION public.ingest_parsed_invoice(
  p_org_id           uuid,
  p_invoice_number   text,
  p_invoice_date     date,
  p_uploaded_by      uuid,
  p_source_filename  text,
  p_departments      jsonb
)
RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE
  v_next_version   int;
  v_batch_id       uuid;
  v_dept           jsonb;
  v_department_id  uuid;
  v_dept_order_id  uuid;
BEGIN
  SELECT COALESCE(max(version), 0) + 1 INTO v_next_version
  FROM public.upload_batches
  WHERE org_id = p_org_id AND invoice_number = p_invoice_number;

  INSERT INTO public.upload_batches
    (org_id, invoice_number, invoice_date, uploaded_by, source_filename, version)
  VALUES
    (p_org_id, p_invoice_number, p_invoice_date, p_uploaded_by, p_source_filename, v_next_version)
  RETURNING batch_id INTO v_batch_id;

  FOR v_dept IN SELECT * FROM jsonb_array_elements(p_departments)
  LOOP
    SELECT department_id INTO v_department_id
    FROM public.departments
    WHERE org_id = p_org_id AND source_dept_code = v_dept->>'source_dept_code';

    IF v_department_id IS NULL THEN
      INSERT INTO public.departments (org_id, department_name, source_dept_code)
      VALUES (p_org_id, v_dept->>'department_name', v_dept->>'source_dept_code')
      RETURNING department_id INTO v_department_id;
    END IF;

    INSERT INTO public.department_orders (batch_id, department_id)
    VALUES (v_batch_id, v_department_id)
    RETURNING dept_order_id INTO v_dept_order_id;

    INSERT INTO public.delivery_line_items (
      dept_order_id, row_data, barcode_value, article_number, description,
      ordered_qty, supplier_reported_qty, delivered_qty, err_code
    )
    SELECT
      v_dept_order_id,
      item,
      item->>'barcode_value',
      item->>'article_number',
      item->>'description',
      (item->>'ordered_qty')::numeric,
      (item->>'supplier_reported_qty')::numeric,
      0,  -- delivered_qty starts at zero — see BUG 2 above. Never
          -- pre-filled from the supplier's claim. Only a real scan
          -- (Phase 3) increments this.
      item->>'err_code'
    FROM jsonb_array_elements(v_dept->'line_items') AS item;
  END LOOP;

  RETURN v_batch_id;
END;
$$;
