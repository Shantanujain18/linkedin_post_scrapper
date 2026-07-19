# Chrome extension installation

ReachPod Chrome extension: scrapes LinkedIn posts into CSV. Requires a signed-in ReachPod account (same Supabase auth as the web app). Free plan is capped at **50 posts/day** (override per user via `profiles.daily_post_limit` in the database).

## Configure

```bash
cd linkedin_post_scrapper
cp .env.example .env.development
cp .env.example .env.production
```

Use the **same keys** in both files — only the values change:

```env
VITE_API_BASE_URL=...
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
```

| File | Typical `VITE_API_BASE_URL` | Build command |
|------|----------------------------|---------------|
| `.env.development` | `http://localhost:3002` | `npm run build` / `npm run build:local` |
| `.env.production` | `https://reachpod.vercel.app` | `npm run build:production` |

`VITE_SUPABASE_*` is usually identical in both (same Supabase project as the web app).

Also run the SQL migrations on Supabase (including `005_extension_version.sql`).

## Install in Chrome

1. Build:

   ```bash
   npm install
   npm run build
   ```

2. Open `chrome://extensions`, enable **Developer mode**, **Load unpacked**, select the `dist` folder.
3. Pin **ReachPod**.
4. Sign in with your ReachPod email/password, then scrape.

## Export posts

1. Open a tab while signed into LinkedIn.
2. Open the extension, sign in to ReachPod if needed.
3. Enter keywords and a post limit (clamped to remaining daily quota).
4. Click **Search and export**. Keep the LinkedIn tab open.

CSV columns: `posted_by`, `posted_by_url`, `posted_date`, `posted_content`, `post_url`, `scraped_at`.

## Raise a user’s daily limit

In Supabase SQL Editor (or any Postgres client):

```sql
update public.profiles
set daily_post_limit = 500, plan = 'paid'
where user_id = '<auth-user-uuid>';
```

Reload the extension after changing source (`npm run build`, then the reload button on `chrome://extensions`).
