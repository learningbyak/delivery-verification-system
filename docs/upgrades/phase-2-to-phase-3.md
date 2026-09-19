# Upgrading: Phase 2 → Phase 3

Same as before — follow these in order.

## 1. Replace your code files

1. Download the new zip and unzip it.
2. Copy everything into your project folder, overwriting files with the same name. Your `.env.local` is untouched.

## 2. Install the new dependency

```bash
npm install
```

## 3. Run the new database migration

1. Go to your Supabase project → **SQL Editor**.
2. Open `supabase/migrations/0010_client_portal_scanning.sql`, copy its full contents.
3. Paste into the SQL Editor and click **Run**.

## 4. Turn on Anonymous Sign-ins (required — Portal login will not work without this)

1. In your Supabase project dashboard, go to **Authentication** in the left sidebar.
2. Click **Sign In / Providers** (or **Providers**, depending on your dashboard version).
3. Find **Anonymous Sign-ins** and turn it **on**.
4. This takes effect immediately — no redeploy needed.

## 5. Push and redeploy

```bash
git add .
git commit -m "Phase 3: Client Portal and barcode scanning"
git push
```

Vercel redeploys automatically.

## 6. Test it — on an actual phone, not just your computer

Camera scanning genuinely needs a real device to test properly.

1. On your phone, go to your live site's `/portal/login` page.
2. Log in with an organization's name and secret code.
3. Pick a department, then an open invoice.
4. Enter a name, allow camera access when your phone asks.
5. Point the camera at a real barcode (any UPC/EAN barcode — a grocery item at home works fine for testing) and confirm it registers a scan.
6. Try the "Barcode won't scan? Enter manually" option too.
7. Check the Client Main Panel — the item you scanned should now show an updated "Received (scanned)" quantity.

## 7. Confirm the full testing checklist

Go through every item in `docs/phases/phase-3.md`'s "Manual testing checklist" — this phase has more moving parts than previous ones, so it's worth being thorough, especially testing on both an Android phone and an iPhone if you can, since camera behavior can differ between them.

---

**If anything fails, stop at that step and tell me exactly what you see.** If Portal login specifically fails with an error mentioning "Anonymous" or a 422 error, that almost always means step 4 above was missed.
