# Hotfix: "PDF Took Too Long to Process"

This is a **different** bug from the last hotfix. That one fixed the wait *before* parsing started (Render's service waking up from sleep). This one fixes the parsing itself being too slow once it actually started — caused by the PDF library, not by cold starts.

## What was wrong

The parser used `pdfplumber`, a pure-Python library. On Render's free tier (0.1 CPU — a tenth of a single processor core), reading a real invoice PDF took long enough to hit the parser's own internal 30-second timeout, even though it was fast on more typical hardware.

## What changed

Switched to `PyMuPDF`, a different PDF library backed by a fast C library instead of pure Python. Measured directly on your real sample invoice: **3.27 seconds → 0.047 seconds — about 69x faster.** A full test upload through the real service, start to finish, now takes 0.32 seconds total.

Just as important: this was verified to produce **identical results** — all 8 automated parser tests pass unchanged, and no changes were needed to the actual row-parsing logic at all.

## Steps

### 1. Get the fixed files

1. Download the new zip and unzip it.
2. Copy everything into your project folder, overwriting files with the same name. Your `.env.local` is untouched.

### 2. Update the parser service's dependencies

This only affects the Python parser service, not your main database — no new SQL migration this time.

If you're running the parser service locally for testing:
```bash
cd parser-service
pip install -r requirements.txt
```

### 3. Push and redeploy

```bash
git add .
git commit -m "Fix: switch PDF parser to PyMuPDF for free-tier performance"
git push
```

Your main app on Vercel redeploys automatically. **Render also needs to redeploy the parser service** — it should do this automatically too, since it watches the same GitHub repo. Go to your Render dashboard and confirm you see a new deploy in progress after the push; if not, click "Manual Deploy" → "Deploy latest commit" yourself.

### 4. Test it

Wait for Render's deploy to finish (check the Render dashboard — it'll show "Live" when ready), then try uploading an invoice again, including one that failed with "PDF took too long to process" before.

---

**Why this is a good fix, not just a bigger timeout:** increasing the timeout number would have just made you wait longer without fixing anything — the parsing was genuinely slow, not just impatient. This fix makes the actual work faster, so uploads should now feel close to instant even on free-tier hardware.
