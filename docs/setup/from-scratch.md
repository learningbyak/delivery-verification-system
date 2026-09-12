# From-Scratch Setup Guide

Written for someone setting this up for the very first time, with no assumed experience. If you already know Git/GitHub/Supabase/Vercel, the [main README](../../README.md)'s "Getting started" section is faster.

A **terminal** is a text box where you type instructions to your computer instead of clicking icons. Every "run this" instruction below means: type that text, press Enter.

- **Mac:** `Cmd + Space`, type "Terminal", press Enter
- **Windows:** press the Windows key, type "PowerShell", press Enter

## 1. Get the code onto your computer

If you're starting from a zip file I gave you: unzip it, then open a terminal inside that folder (Mac: right-click the folder → "New Terminal at Folder"; Windows: open the folder in File Explorer, click the address bar, type `cmd`, press Enter).

If you're cloning an existing GitHub repo instead:
```bash
git clone <your-repo-url>
cd delivery-verification-system
```

## 2. Put the code on GitHub (skip if already done)

1. Go to [github.com](https://github.com) → sign up or sign in.
2. Click the **+** icon (top right) → **New repository**. Name it, leave everything else default, click **Create repository**.
3. GitHub shows you some commands under "…or push an existing repository from the command line." Copy them.
4. In your terminal:
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   ```
   Then paste the commands GitHub showed you.
5. Refresh the GitHub page — you should see your files.

## 3. Create your database (Supabase)

1. Go to [supabase.com](https://supabase.com) → sign up (GitHub login works) or sign in.
2. Click **New project**. Name it, set a database password (save it somewhere safe), pick a region near you, click **Create new project**. Wait ~2 minutes.
3. Once ready: left sidebar → **Project Settings** (gear icon) → **API**. You'll need three values from this page:
   - **Project URL**
   - **anon / public** key
   - **service_role** key (click "reveal") — treat this like a root password, never share it

## 4. Connect your code to your database

```bash
cp .env.example .env.local
```
Open `.env.local` in any text editor and paste in the three values from step 3. Save it. This file is already excluded from Git — it will never be uploaded anywhere.

## 5. Run the database migrations

1. In your Supabase project, left sidebar → **SQL Editor**.
2. Open each file in `supabase/migrations/`, in filename order (`0001_...`, `0002_...`, etc.). For each one: copy its full contents, paste into the SQL Editor, click **Run**, confirm it succeeds, then move to the next file.

## 6. Create your first Admin account

```bash
npm install
npm run create-admin -- you@example.com "choose-a-strong-password"
```

## 7. Run it locally

```bash
npm run dev
```
Open `http://localhost:3000/admin/login` in your browser and log in.

## 8. Put it on the internet (Vercel)

1. Go to [vercel.com](https://vercel.com) → sign up with GitHub.
2. **Add New…** → **Project** → find your repo → **Import**.
3. Before deploying, expand **Environment Variables** and add the same three values from step 3.
4. Click **Deploy**. Wait a minute or two.
5. Open the live `.vercel.app` link Vercel gives you.

---

**If something goes wrong at any step:** stop there and note exactly what you see (screenshot or copy the error text). Don't skip ahead — small problems are much easier to fix at the step where they happened than three steps later.
