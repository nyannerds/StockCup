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

## Develop

Sources are in `src/` (`core.js` logic, `parse.js` text parsers, `ui-*.js` screens, `ocr.js`, `style.css`).
`node build.js` bundles them into `index.html`. `npm test` runs everything:

| Test | What it checks |
| --- | --- |
| `tests/core.test.js` | PRD acceptance criteria R1–R19, R22, R24 on the logic, using the PRD's own numbers (6 lattes, 42 g → 30 g recount, 31/41-day freshness, …), plus the 500 products / 100 recipes / 1,000 logs timing |
| `tests/parse.test.js` | Quick-add, receipt and recipe-text parsers (R20, R21) on synthetic corpora |
| `tests/ui.test.js` | Real-browser flows at 360 px: tap counts, split/undo, validation, export/import, offline, 44 px targets, no horizontal scroll, dark mode |
| `tests/ocr.test.js` | Bundled OCR reads a receipt image offline (needs http) |

## Design notes

* Recipes use generic ingredient types; stock is specific products. Water and ice are never tracked.
* `espresso` slots are in shots and are filled by compatible capsules (rounded up per drink) or coffee beans (9 g per shot, editable).
* Dairy-free comes from the products used plus each product's user-entered "contains dairy" flag (not allergy advice).
* Caffeine (63 mg per shot, 30 mg per g of matcha by default), freshness and descale values are estimates and labelled as such.
* Every import (quick-add, receipt, recipe text/screenshot) goes through a confirm screen; nothing is saved before it. Images are never stored or exported.
* Preset catalogue is a small, editable starter list, not authoritative; capsule intensities and caffeine are approximate.

## Known limits

* OCR accuracy on real receipts and video screenshots has not been measured; the parser accuracy numbers come from synthetic test text. The PRD's evidence (10 real receipts, 10 real screenshots, 3 first-time users, a real phone) still has to be collected.
* Photo reading needs the folder served over http (see above).
