# Hotfix: Partial Uploads on Failure + Premature "Fully Received" Status

You found two more real bugs, both from real-world testing. Both are fixed in one new migration file (`0008`) plus an update to the upload code.

## What was wrong

1. **Partial data saved when an upload failed.** If an upload failed partway through (like the timeout error from the last hotfix), whatever had already been saved stayed in the database — an incomplete, confusing entry. Now the whole upload succeeds completely or saves nothing at all.
2. **"Fully Received" showing before anyone scanned anything.** The system was starting every delivery at the quantity the *supplier* claimed to have shipped, rather than starting at zero and waiting for your staff to actually verify it with a scan. Now every upload starts every item as "Pending," and only your team's scans (coming in the next phase) can change that.

## Steps

### 1. Get the fixed files

1. Download the new zip and unzip it.
2. Copy everything into your project folder, overwriting files with the same name. Your `.env.local` is untouched.

### 2. Run the one new migration

1. Go to your Supabase project → **SQL Editor**.
2. Open `supabase/migrations/0008_atomic_ingestion_and_zero_start.sql` in a text editor, copy its full contents.
3. Paste into the SQL Editor and click **Run**.

You don't need to re-run any earlier migration files.

### 3. Push the update

```bash
git add .
git commit -m "Fix: atomic invoice uploads, delivered qty starts at zero"
git push
```

Vercel redeploys automatically.

### 4. Test it

1. Upload a fresh invoice. Check that every line item shows "pending" status and 0 delivered — even though the supplier's own quantities are still visible for reference.
2. If you still have the invoice that caused the timeout error before, try it again — it should now either succeed completely, or fail completely with nothing left behind (check your invoice list — there should be no incomplete/broken entry either way).

---

**A note on why this happened:** the "start at supplier's claimed quantity" behavior was actually a decision made earlier in this project, based on a reasonable-sounding idea at the time. Seeing it in real use showed it was wrong — it let the system report deliveries as verified before anyone had actually verified them, which undermines the entire reason this system exists. Good catch.
