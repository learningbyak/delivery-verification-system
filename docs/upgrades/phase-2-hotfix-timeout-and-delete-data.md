# Hotfix: "PDF is Taking Too Long" + How to Delete Invoice Data

## Part A — Why uploads were timing out

You're on Render's **free tier** for the PDF parser service. Free services there spin down after 15 minutes with no traffic, and take 30-60 seconds to wake back up on the next request (confirmed against Render's current published behavior). Meanwhile, Vercel's **free (Hobby) tier** defaults every serverless function to a **10-second timeout** — so the upload request was very likely dying while waiting for Render to finish waking up, before the PDF was ever actually read.

**Both fixes below are free — no paid tier needed for either platform.**

### Fix 1: Give Vercel's function more time to wait
`src/app/api/client/upload/route.ts` now sets `maxDuration = 60` — the maximum Vercel allows on the free Hobby plan without extra configuration. Verified directly in a real production build that this setting is actually applied to the route.

### Fix 2: Stop Render from falling asleep in the first place
A new GitHub Actions workflow (`.github/workflows/keep-parser-awake.yml`) pings your parser service every 14 minutes — just often enough that it never hits the 15-minute idle threshold during active use. This is free (uses GitHub Actions' own free scheduled-workflow minutes).

**Setup required for Fix 2:**
1. Go to your GitHub repo → **Settings** → **Secrets and variables** → **Actions**.
2. Click **New repository secret**.
3. Name: `PARSER_SERVICE_URL`. Value: your Render service's URL (e.g. `https://your-service.onrender.com`).
4. Save.

The workflow starts running automatically on its schedule once this secret exists. You can also trigger it manually from the **Actions** tab (click the workflow, then "Run workflow") to test it right away instead of waiting.

### Honest limitation
Neither fix *guarantees* zero cold starts — GitHub Actions' free scheduled workflows can occasionally run a few minutes late, and if literally nobody uses the app for a long stretch (overnight, weekends), a cold start can still happen on the next upload. That's fine — the upload page now shows a friendly "still working, this can take up to a minute" message after 8 seconds, so it doesn't look broken while waiting.

---

## Part B — How to delete invoice data

There's no delete button in the app yet — uploads were deliberately made permanent/append-only in Phase 2's design (corrections happen by re-uploading, which creates a new version, not by deleting). For removing test data right now, use Supabase's SQL Editor directly.

**To delete one specific invoice** (replace `'YOUR-INVOICE-NUMBER'` with the real one):

```sql
DELETE FROM public.delivery_line_items
WHERE dept_order_id IN (
  SELECT dept_order_id FROM public.department_orders
  WHERE batch_id = (SELECT batch_id FROM public.upload_batches WHERE invoice_number = 'YOUR-INVOICE-NUMBER')
);

DELETE FROM public.department_orders
WHERE batch_id = (SELECT batch_id FROM public.upload_batches WHERE invoice_number = 'YOUR-INVOICE-NUMBER');

DELETE FROM public.upload_batches WHERE invoice_number = 'YOUR-INVOICE-NUMBER';
```

Run these three statements **in this exact order** (line items first, then department orders, then the batch) — the database's foreign key rules require it, since child records must be removed before their parent.

**Note:** this does not delete the `departments` themselves (e.g. "Grocery") — only the uploaded invoice data. Departments stay so future uploads keep matching to them correctly.

If you want a **permanent delete feature built into the app** (so you don't need to touch SQL directly going forward), let me know — it's a real design decision worth discussing first, since it changes the "uploads are permanent" model from Phase 2.
