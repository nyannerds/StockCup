# StockCup – home coffee and matcha pantry

One offline HTML app that keeps track of the coffee and matcha products at home (by brand and pack size,
sealed vs. opened), deducts stock when a drink is logged, suggests what can be made, scales recipes, estimates
caffeine and cost per person, handles Nespresso capsules by machine, and imports recipes and receipts.
No server, accounts or sync. Data lives in the browser (`localStorage`); use Export/Import to move it.

## Run it

Open **`index.html`** in a phone or laptop browser. That is the whole app (one file, no internet needed).

Receipt photo and screenshot reading uses a bundled OCR engine in `vendor/ocr/` (about 11 MB, fully offline).
Browsers block Web Workers on `file://`, so for photo reading serve the folder (still offline), for example:

```bash
python3 -m http.server 8080   # then open http://localhost:8080 (or your phone via the laptop's IP)
```

Opened straight from a file, everything else works; the photo reader says it is unavailable and you can paste or
type the text instead (quick-add lines, receipt text and recipe text all work without OCR).

## Put it online (Vercel, free)

1. Push the repo to GitHub (already done) and sign in at vercel.com with GitHub.
2. **Add New → Project**, import this repo. Framework preset **Other**. `vercel.json` already sets the build command (`node build.js`) and the output directory (`.`).
3. Deploy. Every pushed branch gets its own preview URL; the production URL updates when you merge into `main`.
4. Open the URL on your phone. In Profile → **App** you get an install button (Android/desktop) or the iPhone hint (Share → Add to Home Screen). After the first load the app works offline, and the receipt reader works offline after its first use.

Notes: each address (preview, production, a local copy) has its own separate data, because browsers store data per site. Use Export / Import to move it. The Hobby plan is for personal, non-commercial use.

## Household sync (optional, free)

Sync lets everyone in a household share one pantry. Stock, drinks, recipes and settings stay in step on every phone,
each phone still works offline, and changes made offline are merged when it reconnects. Without this setup StockCup
works on one device exactly as before. There are no emails or passwords: each phone gets a silent anonymous identity
and joins a household with an **invite code**.

**One-time setup (about 10 minutes, whoever runs the app):**

1. Create a free account at [supabase.com](https://supabase.com) and make a **New project** (pick a region near you; save the database password somewhere, you will not need it in the app).
2. **Authentication → Sign In / Providers → Anonymous sign-ins → turn on.**
3. **SQL Editor → New query**, paste the whole of `supabase/schema.sql`, press **Run**. (Safe to run again.)
4. **Project Settings → API**: copy the **Project URL** and the **anon public** key.
5. Open `config.js` in this repo, paste them in, commit and push. The anon key is designed to be public; the database's row-level security is what protects the data. **Never** paste the `service_role` key anywhere.
6. Redeploy (Vercel does it on push). Open the app → **Profile → Household → Create a household**.
7. Tap **Invite someone** and send the code. On the other phone: **Profile → Household → Join with an invite code**.

**How it works / what to expect**

* Every change (a drink, a restock, a recount, an edit) is sent as a small event. All phones replay the same events in the same order, so two people logging drinks at once, or one phone offline, never overwrite each other. If two phones use the last of something, stock simply stops at 0.
* Invite codes work for 7 days and up to 5 people, and wrong guesses are rate-limited. Anyone with the code can join, so share it only with people you trust. The owner can remove anyone, and removed phones keep their own copy but stop syncing.
* Joining replaces the pantry on that phone with the household's (the app offers to export first). Leaving keeps a copy on your phone.
* Theme, units and "who am I" stay per phone. Photos, screenshots and receipts are never stored or synced.
* The free Supabase tier is plenty for a household. Projects that sit idle for a while can be paused by Supabase; the app keeps working on each phone and syncs again once the project is resumed. Check Supabase's current free-tier terms.
* Limits to know: an imported or created pantry is uploaded as one snapshot (up to about 8 MB), and the full history is replayed when a new phone joins, which stays fast for household-sized data (1,500 events replay in well under a second in tests).

## Develop

Sources are in `src/` (`core.js` logic, `parse.js` text parsers, `ui-*.js` screens, `ocr.js`, `style.css`).
`node build.js` bundles them into `index.html`. `npm test` runs everything:

| Test | What it checks |
| --- | --- |
| `tests/core.test.js` | PRD acceptance criteria R1–R19, R22, R24 on the logic, using the PRD's own numbers (6 lattes, 42 g → 30 g recount, 31/41-day freshness, …), plus the 500 products / 100 recipes / 1,000 logs timing |
| `tests/parse.test.js` | Quick-add, receipt and recipe-text parsers (R20, R21) on synthetic corpora |
| `tests/ui.test.js` | Real-browser flows at 360 px: tap counts, split/undo, validation, export/import, offline, 44 px targets, no horizontal scroll, dark mode |
| `tests/ocr.test.js` | Bundled OCR reads a receipt image offline (needs http) |
| `tests/catalog.test.js` | Brand catalogue: every entry validates, no invented numbers, helpers follow your machines, parsers match catalogue products |
| `tests/catalog-ui.test.js` | The brand → product → size dropdowns in a real browser: Other (type it), Your brands, machine-filtered capsules, no guessed intensity |
| `tests/sync.test.js` | Sync engine against a mock server: offline merges, last-gram conflicts, undo across phones, deleted products, idempotence, restart, replay speed |
| `tests/schema.test.js` | Runs `supabase/schema.sql` in a real Postgres (PGlite): who can read/write what, append-only, invites, throttling, removal, leaving |
| `tests/sync-ui.test.js` | Two phones through the real screens: create, join, log, offline queue, remove, leave |
| `tests/supabase-api.test.js` | The app's Supabase calls match the SQL function and column names |
| `tests/photo.test.js` | Photo-of-an-item flow, every fullness choice, tea, capsules, no photo stored, receipt coffee/tea switch |
| `tests/link.test.js` | Video-link function (URL guard, redirects, size/time limits, extraction, rate limit) and the in-app flow end to end |
| `tests/pwa.test.js` | Manifest and icons, service worker, installability, offline reload, offline OCR after first use |

## Brand lists (dropdowns)

Pantry → ＋ Add → **Enter all the details**: under Category, choose a **Brand**, then a **Product** (a capsule *flavour*, a matcha such as Marukyu Koyamaen → Wako, a coffee line),
then a **Pack size**. The fields below fill in and stay editable. Every list ends with **Other (type it)**, and brands you type yourself appear under **Your brands** next time.
Capsule lists only show flavours for the machines you have. Typed lines, labels and receipts ("Marukyu Koyamaen Wako 40g") are matched against the same list.

The list lives in `src/catalog.js` and is a **hand-compiled starter list, not authoritative**: Nespresso (Original and Vertuo), Marukyu Koyamaen, Yamamasa Koyamaen, Kumatcha, Ippodo, Aiya, Top Creamery (TOP Series syrups), Lavazza, illy, Starbucks and Twinings.
Names were checked against public listings (brand sites could not be reached when it was written). Numbers are filled only when known; ones recalled but not confirmed are flagged
"check your box" in the form, unknown ones (most Vertuo intensities, many cup sizes) are left blank, and pack sizes marked "typical" are never pre-selected. To add or fix an entry,
edit `src/catalog.js` and run `npm test` (`tests/catalog.test.js` checks every entry).

## Adding items by photo

Pantry → **＋ Add** → **Photo of an item**. Take or choose a photo of the label; the words are read on the device (the photo is previewed
only while you confirm, then discarded, and is never stored, exported or synced). The pack size ("1 L" → 1000 ml, tea bags → about 2 g each),
category and brand are filled in, you pick **how full it is** (Full / ¾ / ½ / ¼ / Almost empty / Not sure), and it is added as one sealed pack or
one opened pack. A carton or tin cannot show its level in a photo, so the fullness is always your choice; "Not sure" saves an unknown amount.
If the label cannot be read, type what it says. Photo reading needs the app served over http(s) (see above); typing works anywhere.
Receipt scans have an **only coffee, matcha, tea and capsules** switch on the review screen.

## Recipe from a video link (best effort)

Recipes → **Import → Video link**. Paste a YouTube, TikTok or Instagram link; a small function on the hosted app (`api/recipe-from-link.js`,
free on Vercel) reads the page's **public caption/description**, which then goes through the same draft screen as pasted text. Nothing is downloaded or stored.

What to expect: **YouTube** descriptions often list ingredients and work well. **TikTok and Instagram** frequently refuse automated requests, and many
videos keep the recipe in the video itself (spoken or as on-screen text), which cannot be read this way; in those cases the app says so and you can paste the
caption or use screenshots. It needs the hosted app and a connection (it is hidden-in-effect when opened as a file or offline).

Safety: the function only accepts https links to those three sites, follows redirects by hand and only to those sites, times out after 8 s, reads at most
1.5 MB, answers only the app's own requests (POST + JSON + a custom header, no cross-site access), rate-limits bursts, identifies itself as StockCupBot, and stores nothing.
Fetching those sites is subject to their terms; it is for a person's own use on a link they pasted.

## Design notes

* Navigation: four tabs (Home, Pantry, Recipes, Profile). Home has the search bar, the notification bell (descale, aging, low stock, recount alerts), Log a drink / Same as last time, Daily Insights tiles (tap for the log and history) and a filterable "Ready now" list. Profile holds people, machines, shopping list, guest plan, limits, appearance and data.

* Recipes use generic ingredient types; stock is specific products. Water and ice are never tracked.
* `espresso` slots are in shots and are filled by compatible capsules (rounded up per drink) or coffee beans (9 g per shot, editable).
* Dairy-free comes from the products used plus each product's user-entered "contains dairy" flag (not allergy advice).
* Caffeine (63 mg per shot, 30 mg per g of matcha by default), freshness and descale values are estimates and labelled as such.
* Every import (quick-add, receipt, recipe text/screenshot) goes through a confirm screen; nothing is saved before it. Images are never stored or exported.
* Preset catalogue is a small, editable starter list, not authoritative; capsule intensities and caffeine are approximate.

## Known limits

* OCR accuracy on real receipts and video screenshots has not been measured; the parser accuracy numbers come from synthetic test text. The PRD's evidence (10 real receipts, 10 real screenshots, 3 first-time users, a real phone) still has to be collected.
* Photo reading needs the folder served over http (see above).
* Household sync is tested against a mock server and a real in-memory Postgres running the schema, but **not against a live Supabase project** (no access from the development environment). Do the two-phone test described above before relying on it.
