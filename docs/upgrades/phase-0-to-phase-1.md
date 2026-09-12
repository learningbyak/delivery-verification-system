# Upgrading: Phase 0 → Phase 1

Follow these in order. Each step says exactly what to type or click.

## 1. Replace your code files

1. Download the new zip I gave you and unzip it.
2. Copy every file from the unzipped folder into your existing project folder, **overwriting** files with the same name. (Your `.env.local` is never part of the zip, so it will not be touched or overwritten.)

## 2. Install the new dependencies

In your terminal, inside your project folder:

```bash
npm install
```

This pulls in the new packages this phase added (bcryptjs, Supabase server-side packages, etc.).

## 3. Run the new database migrations

Phase 1 adds real database tables. You need to create them in your actual Supabase project:

1. Go to your project at supabase.com and sign in.
2. In the left sidebar, click **SQL Editor**.
3. Open the file `supabase/migrations/0001_organizations.sql` from your project folder in a text editor, copy its entire contents, paste into the SQL Editor, and click **Run**.
4. Repeat step 3 for `0002_profiles_and_rls_helpers.sql`, then `0003_organizations_policies.sql`, then `0004_departments.sql` — **in that exact order**, running each one and confirming it succeeds before moving to the next.

## 4. Create your first Admin account

Still in your terminal:

```bash
npm run create-admin -- you@youremail.com "choose-a-strong-password"
```

Replace the email and password with your own. This is the only account that can log in to the Admin Panel — save the password somewhere safe (a password manager, not a sticky note).

## 5. Test it locally

```bash
npm run dev
```

Open `http://localhost:3000/admin/login` and log in with the email and password from step 4. You should land on a dashboard where you can create an organization.

## 6. Push the update to GitHub

```bash
git add .
git commit -m "Phase 1: Admin Panel core"
git push
```

Check the **Actions** tab on your GitHub repo — the same CI checks from before should run and pass (green checkmark).

## 7. Update Vercel

Nothing extra needed here — Vercel automatically redeploys whenever you push to GitHub. Wait about a minute, then visit your live `.vercel.app` URL at `/admin/login` and confirm the same login works there too.

## 8. Confirm you're really done

Go through every box in `docs/phases/phase-1.md`'s "Manual testing checklist" and "Exit criteria" sections before telling me to move on to Phase 2.

---

**If anything fails at any step, stop there and tell me exactly what you see — the error message, which step, everything.** Don't try to push forward past an error; that's usually how small problems turn into confusing ones.
