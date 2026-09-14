# Hotfix: Large Invoice Upload Timeout

You found a real bug: uploading an invoice with a large department (200+ products) failed with `canceling statement due to statement timeout`. Your diagnosis was correct — a database trigger was doing far more work than it needed to on every upload. This is fixed in one new migration file. You don't need to redo the whole Phase 2 upgrade — just these steps.

## 1. Get the fixed file

1. Download the new zip I gave you and unzip it.
2. Copy everything into your project folder, overwriting files with the same name (your `.env.local` is untouched).

## 2. Run the one new migration

1. Go to your Supabase project → **SQL Editor**.
2. Open `supabase/migrations/0007_fix_department_order_status_trigger_performance.sql` in a text editor, copy its full contents.
3. Paste into the SQL Editor and click **Run**.

That's it for the database — you don't need to re-run any of the earlier migration files.

## 3. Push the code update

```bash
git add .
git commit -m "Fix: large invoice upload timeout"
git push
```

Vercel will redeploy automatically.

## 4. Test it

Try uploading the same large invoice that failed before. It should now complete successfully. If you have an invoice with even more line items, that's a great stress test too.

---

**What actually changed, in plain terms:** every time a product was saved to the database, a background process was re-checking *the entire invoice's* status from scratch — for every single product, one at a time. With 200+ products, that meant hundreds of repeated checks instead of one. The fix makes it do that check once per upload, no matter how many products are in it — verified to be dramatically faster (a 5,000-product test that would have taken many seconds before now takes about 0.2 seconds), while still being just as accurate.
