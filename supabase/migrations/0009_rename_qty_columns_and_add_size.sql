-- Fix: terminology mismatch causing real confusion, plus missing
-- product size data. Both reported after real-world use.
--
-- RENAME: the invoice's own "DR Qty" column (what the supplier
-- claims to have shipped) was called supplier_reported_qty. The
-- scan-verified quantity was called delivered_qty. In practice this
-- is backwards from how the business actually talks about it: the
-- invoice's number is the "delivered quantity" (what the supplier
-- says was delivered), and the scan-verified number is the "received
-- quantity" (what staff actually confirmed). Renamed to match:
--   supplier_reported_qty  -> delivered_qty   (from the invoice)
--   delivered_qty (old)    -> received_qty    (from an employee scan)
--
-- ADDED: pack_size and size_spec, extracted by the parser all along
-- (see parser-service/parser.py) but never stored as displayable
-- columns or shown in the UI. Now both.

-- Order matters: free up the "delivered_qty" name before reusing it.
ALTER TABLE delivery_line_items RENAME COLUMN delivered_qty TO received_qty;
ALTER TABLE delivery_line_items RENAME COLUMN supplier_reported_qty TO delivered_qty;

ALTER TABLE delivery_line_items ADD COLUMN pack_size text;
ALTER TABLE delivery_line_items ADD COLUMN size_spec text;

-- Postgres automatically updates CHECK constraints, indexes, and the
-- trigger's column-list to follow a renamed column — verified
-- directly (see docs/phases/phase-2.md's testing notes for this
-- migration), not assumed.

-- The line-status trigger now reads received_qty (the scan-verified
-- number), not delivered_qty (which now means the invoice's claim).
CREATE OR REPLACE FUNCTION public.compute_line_status()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.received_qty = 0 THEN
    NEW.line_status := 'pending';
  ELSIF NEW.received_qty < NEW.ordered_qty THEN
    NEW.line_status := 'partial';
  ELSIF NEW.received_qty = NEW.ordered_qty THEN
    NEW.line_status := 'fully_received';
  ELSE
    NEW.line_status := 'over_received';
  END IF;
  RETURN NEW;
END;
$$;

-- Same rename applied to the department_order status rollup helper.
CREATE OR REPLACE FUNCTION public.recompute_one_department_order_status(p_dept_order_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_total   int;
  v_fully   int;
  v_started int;
BEGIN
  SELECT
    count(*),
    count(*) FILTER (WHERE line_status IN ('fully_received', 'over_received')),
    count(*) FILTER (WHERE received_qty > 0)
  INTO v_total, v_fully, v_started
  FROM public.delivery_line_items
  WHERE dept_order_id = p_dept_order_id;

  UPDATE public.department_orders
  SET status = CASE
    WHEN v_total > 0 AND v_fully = v_total THEN 'fully_received'
    WHEN v_started > 0 THEN 'partially_received'
    ELSE 'pending'
  END
  WHERE dept_order_id = p_dept_order_id;
END;
$$;

-- Ingestion now stores pack_size/size_spec, writes the invoice's DR
-- Qty into the renamed delivered_qty column, and explicitly starts
-- received_qty at zero — same "never pre-fill from the supplier's
-- claim" rule as before (migration 0008), just with the corrected
-- column name.
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
      pack_size, size_spec,
      ordered_qty, delivered_qty, received_qty, err_code
    )
    SELECT
      v_dept_order_id,
      item,
      item->>'barcode_value',
      item->>'article_number',
      item->>'description',
      item->>'pack_size',
      item->>'size_spec',
      (item->>'ordered_qty')::numeric,
      (item->>'supplier_reported_qty')::numeric,  -- invoice's DR Qty -> delivered_qty
      0,                                            -- received_qty: only a scan changes this
      item->>'err_code'
    FROM jsonb_array_elements(v_dept->'line_items') AS item;
  END LOOP;

  RETURN v_batch_id;
END;
$$;
