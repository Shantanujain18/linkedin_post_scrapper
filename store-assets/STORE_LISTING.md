# ReachPod — Chrome Web Store publish pack

Version to ship: **2.2.0**  
Package: build with `npm run build:production`, zip the **contents of** `dist/` (not the folder name).

Official image rules: [Supplying Images](https://developer.chrome.com/docs/webstore/images)

---

## 1. One-time account setup

1. Open [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole)
2. Pay the **one-time $5** developer registration fee
3. Verify email / complete account details
4. Create a new item → upload your ZIP

---

## 2. Graphic assets (ready in this folder)

| Asset | Size | Required? | File |
|-------|------|-----------|------|
| Store / package icon | **128×128** PNG | Yes | `icons/icon128.png` |
| Extension toolbar icons | 16 / 32 / 48 / 128 | In ZIP + manifest | `icons/icon16.png` … `icon128.png` |
| Small promo tile | **440×280** PNG | Yes | `promo/small-promo-440x280.png` |
| Marquee promo tile | **1400×560** PNG | Optional (needed to be featured) | `promo/marquee-1400x560.png` |
| Screenshots | **1280×800** (preferred) or 640×400 | ≥1, up to 5 | See §4 — capture real UI |
| Promo video | YouTube URL | Optional | Record 30–60s walkthrough |

Sources (higher res, for redesign): `icons/icon-source.png`, `promo/*-source.png`

**Icon tip (Chrome docs):** artwork should sit in ~96×96 with ~16px transparent padding inside the 128×128 canvas. Re-export from Figma if review complains about edge clipping.

**Promo tip:** no alpha on promo tiles if upload fails — flatten on `#0f1117`. Screenshots: square corners, **no padding**, full bleed.

---

## 3. Listing copy (paste into dashboard)

### Name
```
ReachPod
```
(Manifest name must stay ≤45 characters — current is fine.)

### Short description (manifest `description`, ≤132 chars)
```
Scrape LinkedIn hiring posts, auto-save leads, and AI-draft outreach emails with your ReachPod account.
```

### Detailed description
```
ReachPod helps job seekers turn LinkedIn hiring posts into personalized outreach — without the CSV shuffle.

What it does
• Sign in with your ReachPod account
• Search LinkedIn for hiring posts matching your keywords
• Save posts to your ReachPod dashboard (quota applies)
• Trigger AI email drafts based on your resume and skills
• Review and send from the ReachPod web app

How to use
1. Install ReachPod and pin it
2. Create an account at https://reachpod.vercel.app (or your production domain)
3. Upload your resume in the dashboard (Step 1)
4. Open LinkedIn, open the extension, sign in
5. Enter keywords and post limit, then start search
6. When drafts are ready, open Send emails in the dashboard

Plans & limits
Free accounts include a daily scrape quota. Higher limits are available on paid plans.

Privacy
ReachPod uses your signed-in session to call ReachPod APIs and access LinkedIn pages you open. See our Privacy Policy for details.

Support: shantanujain18@gmail.com
Website: https://reachpod.vercel.app
```

### Category
**Productivity** (or **Workflow & Planning** if shown)

### Language
English

### Store listing URLs
| Field | Value |
|-------|--------|
| Homepage | `https://reachpod.vercel.app` |
| Privacy policy | `https://reachpod.vercel.app/privacy` |
| Support email | `shantanujain18@gmail.com` |

If you use a custom domain later, update these + `host_permissions` to match.

---

## 4. Screenshots to capture (you still need real ones)

Promo art is ready; **screenshots should show the real product**. Capture at **1280×800**:

1. Extension popup — signed in, ready to scrape  
2. Extension popup — progress / preparing drafts  
3. Dashboard — Find people  
4. Dashboard — Send emails with drafts  
5. (Optional) Profile / resume step  

Suggested filenames after you capture:
```
screenshots/01-popup-ready.png
screenshots/02-popup-progress.png
screenshots/03-dashboard-leads.png
screenshots/04-dashboard-send.png
```

Resize with:
```bash
sips -z 800 1280 your-capture.png --out store-assets/screenshots/01-popup-ready.png
```

Mock references (not for final upload if you want authentic UI):  
`/Users/apple/.cursor/projects/Users-apple-Desktop-Linkedin-Scrapper/assets/reachpod-screenshot-*.png`

---

## 5. Privacy practices (dashboard questionnaire)

Answer honestly; typical for this extension:

| Question | Suggested answer |
|----------|------------------|
| Single purpose | Help users find LinkedIn hiring posts and prepare ReachPod outreach drafts |
| Remote code | No |
| Collects user data | Yes — account email; scraped post content; sent to ReachPod servers |
| Uses for | App functionality / account management |
| Sold to third parties | No |
| Used for creditworthiness | No |
| Certify compliance | Check the boxes you actually meet |

**Permissions justification (write these in the “Permission justifications” fields):**

- **`activeTab` / `scripting`** — inject content script on the active LinkedIn tab to read visible hiring posts the user asked to scrape  
- **`storage`** — store auth session / local preferences  
- **`tabs`** — open LinkedIn / dashboard deep links and coordinate scrape flow  
- **Host: `https://www.linkedin.com/*`** — read posts on LinkedIn search/feed pages the user opens  
- **Host: `https://reachpod.vercel.app/*` + `https://*.supabase.co/*`** — ReachPod API + auth  

Remove **`http://localhost:3002/*`** from the **store** build before upload (dev-only). Reviewers flag localhost host permissions.

---

## 6. Pre-upload code checklist

- [ ] `version` is `2.2.0` in `manifest.json` / `package.json`
- [ ] `npm run build:production` (production API URL, not localhost)
- [ ] Icons referenced in `manifest.json` (`icons` + `action.default_icon`)
- [ ] No localhost in `host_permissions` for the uploaded ZIP
- [ ] Privacy policy live and linked
- [ ] Test: install from ZIP → sign in → scrape → drafts appear in dashboard
- [ ] Zip **inside** `dist/` so `manifest.json` is at the ZIP root

```bash
cd chrome-extension
npm run build:production
# copy store-assets/icons into dist/ if not already via public/
cd dist && zip -r ../reachpod-2.2.0-cws.zip . -x '*.DS_Store'
```

---

## 7. Review risk notes (LinkedIn scraping)

Chrome and LinkedIn both scrutinize scrapers. Reduce rejection risk:

- Describe the product as **user-initiated** search/export for **job outreach**, not “bypass LinkedIn” or mass automation
- Don’t use LinkedIn trademarks/logos in icons or promo art
- Don’t claim affiliation with LinkedIn
- Keep rate limits / quota language visible
- Single purpose declaration must match the actual UX

Expect possible **manual review** because of `linkedin.com` host permission + scripting.

---

## 8. After publish

1. Switch listing visibility: **Public** / Unlisted / Private  
2. Update dashboard download banner to the **Chrome Web Store URL** (replace GitHub `dist.zip` once approved)  
3. Optionally set `extension_config.update_url` in Postgres to the store URL  

---

## Brand colors (match site)

- Primary: `#4f6ef7`
- Accent: `#6d5dfc`
- Background: `#0f1117`
- Wordmark: ReachPod
- Mark: **RP**
