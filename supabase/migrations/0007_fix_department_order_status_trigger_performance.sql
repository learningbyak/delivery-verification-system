-- Fix: department_orders status trigger caused statement timeouts on
-- large invoices in production (real bug, reported and reproduced).
--
-- Root cause, confirmed by reproduction: the original
-- trg_recompute_department_order_status trigger (migration 0006) was
-- FOR EACH ROW — so inserting N line items in a single bulk INSERT
-- fired N separate aggregate re-scans of delivery_line_items plus N
-- separate UPDATEs on department_orders, all within that one INSERT
-- statement. Measured locally: 214 rows = 27ms, 500 rows = 86ms,
-- 1000 rows = 243ms, 2000 rows = 778ms — clearly superlinear growth,
-- not the flat-per-row cost a correct design should have. On
-- Supabase's shared infrastructure, under real load, with a large
-- department (this was hit on a genuine ~500+ line Grocery invoice),
-- this exceeded the statement_timeout and the whole upload failed.
--
-- Fix: replace the FOR EACH ROW trigger with FOR EACH STATEMENT
-- triggers using transition tables, so a bulk insert of any size
-- recomputes each *distinct* affected department_order's status
-- exactly ONCE per statement, not once per row. Since a normal
-- upload's line items all belong to the same department_order, this
-- turns an O(N) (really closer to O(N^1.5-2) in practice) trigger cost
-- into O(1) per upload, regardless of how many products it contains.
--
-- Postgres does not allow combining transition tables on a single
-- trigger covering more than one event (verified directly — this
-- fails with "transition tables cannot be specified for triggers
-- with more than one event") — hence three separate triggers below,
-- one per event, sharing one small helper function.

DROP TRIGGER IF EXISTS trg_recompute_department_order_status ON delivery_line_items;
DROP FUNCTION IF EXISTS public.recompute_department_order_status();

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
    count(*) FILTER (WHERE delivered_qty > 0)
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

CREATE OR REPLACE FUNCTION public.recompute_department_order_status_on_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT DISTINCT dept_order_id FROM new_table LOOP
    PERFORM public.recompute_one_department_order_status(r.dept_order_id);
  END LOOP;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.recompute_department_order_status_on_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT dept_order_id FROM new_table
    UNION
    SELECT dept_order_id FROM old_table
  LOOP
    PERFORM public.recompute_one_department_order_status(r.dept_order_id);
  END LOOP;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.recompute_department_order_status_on_delete()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT DISTINCT dept_order_id FROM old_table LOOP
    PERFORM public.recompute_one_department_order_status(r.dept_order_id);
  END LOOP;
  RETURN NULL;
END;
$$;

CREATE TRIGGER trg_recompute_department_order_status_ins
AFTER INSERT ON delivery_line_items
REFERENCING NEW TABLE AS new_table
FOR EACH STATEMENT EXECUTE FUNCTION public.recompute_department_order_status_on_insert();

CREATE TRIGGER trg_recompute_department_order_status_upd
AFTER UPDATE ON delivery_line_items
REFERENCING NEW TABLE AS new_table OLD TABLE AS old_table
FOR EACH STATEMENT EXECUTE FUNCTION public.recompute_department_order_status_on_update();

CREATE TRIGGER trg_recompute_department_order_status_del
AFTER DELETE ON delivery_line_items
REFERENCING OLD TABLE AS old_table
FOR EACH STATEMENT EXECUTE FUNCTION public.recompute_department_order_status_on_delete();

-- Note: trg_compute_line_status (the BEFORE trigger that sets each
-- row's own line_status) is untouched — it's O(1) per row with no
-- additional queries, so it was never the source of this problem.
