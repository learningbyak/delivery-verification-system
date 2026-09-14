# Upgrading: Phase 1 → Phase 2

Same as before — follow these in order, one at a time.

## 1. Replace your code files

1. Download the new zip and unzip it.
2. Copy everything from the unzipped folder into your project folder, overwriting files with the same name. Your `.env.local` is never touched.

## 2. Install the new dependencies

```bash
npm install
```

## 3. Run the two new database migrations

1. Go to your Supabase project → **SQL Editor**.
2. Open `supabase/migrations/0005_verify_org_secret_code.sql`, copy its contents, paste into the SQL Editor, click **Run**.
3. Do the same for `supabase/migrations/0006_invoice_ingestion.sql`.

(Your existing 4 migrations from Phase 1 stay as they are — you don't need to re-run those.)

## 4. Deploy the new PDF parser service

This phase adds a second, separate piece — a small service that reads PDF invoices. It doesn't live on Vercel with the rest of the app.

1. Go to [render.com](https://render.com) and sign up (GitHub login works).
2. Click **New** → **Web Service**, connect your GitHub repo.
3. When asked for the root directory, type: `parser-service`
4. Render should detect the `Dockerfile` automatically and offer to deploy it that way — accept that.
5. Before deploying, add an environment variable: open a terminal and run `openssl rand -hex 32` to generate a random secret value, then add it to Render as `PARSER_SERVICE_TOKEN` with that value. **Copy this value somewhere safe** — you'll need it again in step 6.
6. Click **Deploy**. Wait a few minutes. Once it's live, copy the URL Render gives you (something like `https://your-service.onrender.com`).

## 5. Add the new environment variables

Open your `.env.local` file and add two new lines at the bottom:
```
PDF_PARSER_SERVICE_URL=https://your-service.onrender.com
PDF_PARSER_SERVICE_TOKEN=the-same-random-value-from-step-4
```

## 6. Test it locally

```bash
npm run dev
```

1. Go to `http://localhost:3000/admin/login`, log in, open one of your organizations, and use the new "Create Client Main Panel account" form. Copy the email and password shown.
2. Go to `http://localhost:3000/client/login` and log in with: the organization's name, its secret code (from when you created it), and the email/password from step 1.
3. Try uploading a real invoice PDF. You should see a success message and be able to click into the new invoice to see its line items.

## 7. Push the update

```bash
git add .
git commit -m "Phase 2: Client Main Panel auth + PDF ingestion"
git push
```

Check the **Actions** tab on GitHub — this time there are two check groups (the app, and the new parser service) — both should pass.

## 8. Update Vercel with the new environment variables

Vercel redeploys automatically on push, but it needs the two new environment variables too:

1. Go to your project on vercel.com → **Settings** → **Environment Variables**.
2. Add `PDF_PARSER_SERVICE_URL` and `PDF_PARSER_SERVICE_TOKEN` with the same values from step 5.
3. Trigger a new deployment (Vercel's dashboard has a "Redeploy" button, or just push any small change).

## 9. Confirm on the live site

Repeat the test from step 6, but on your real `.vercel.app` URL instead of localhost.

---

**If anything fails, stop at that step and tell me exactly what you see.** Go through `docs/phases/phase-2.md`'s full testing checklist before telling me to move on to Phase 3.
