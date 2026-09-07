# EHC Obstetric & Gynecology Guidelines Search

A fast, mobile-friendly search app for the **Egyptian Health Council (EHC) Obstetric & Gynecology clinical guidelines**. Type a tag word (e.g., `preeclampsia`, `oxytocin`, `cesarean`) and instantly get the exact, complete recommendation phrases that contain it — with word highlighting, related-tag suggestions, and color-coded recommendation types (Strong / Conditional / GPS).

**Live site:** https://ehc-obgyn-guidelines.vercel.app/ \
**Source guidelines:** [EHC LMS — Obstetric & Gynecology Guidelines](https://lms.ehc.gov.eg/lms/course/view.php?id=38)

## Features

- **Instant keyword search** — results contain *every* word you type, using strict text matching so nothing irrelevant appears.
- **Spelling-aware matching** — British and American forms are interchangeable (`caesarean` ⇄ `cesarean`, `haemorrhage` ⇄ `hemorrhage`), so no phrase is ever missed due to spelling.
- **Word highlighting** — every searched word is highlighted in the results, in both spelling variants.
- **Related-tag suggestion chips** — each result shows up to 6 tags most relevant to that phrase, with the searched tag always first. Click any chip to jump to that tag's results.
- **Recommendation type badges** — the guideline strength/type (e.g., `(Conditional)`, `(Strong)`, `(GPS)`, `(Context-specific recommendation)`) is displayed as a color-coded badge.
- **Full tag cloud** — 162 curated tag words, all verified to return results. Click to filter.
- **Live auto-sync with EHC LMS** — the app periodically checks the EHC course for newly published guideline books, ingests them in the browser, and makes them searchable immediately (stored locally in your browser).
- **Mobile optimized** — safe-area insets, large tap targets, `viewport-fit=cover`, PWA metadata, and a layout that works from phones to desktops.
- **Dark mode** — automatically adapts to the system color scheme.

## Getting Started

### Run locally

```bash
# install the static-file server (already listed as a dev dependency)
npm install

# serve the app
npm run dev
# or: npm start
```

Then open http://localhost:3000 in your browser.

### Data

The app is fully static — no build step and no backend. `guidelines.json` is the single source of truth:

| File | Purpose |
| --- | --- |
| `index.html` | App shell and layout |
| `styles.css` | Responsive styling, dark mode support |
| `app.js` | Search engine, highlighting, tag suggestions, auto-sync |
| `guidelines.json` | The curated dataset: 10 guidelines, 290 recommendation phrases, 162 tag words |
| `vercel.json` | Deployment & cache-control configuration |

`guidelines.json` structure:

```jsonc
{
  "source": "EHC OB/GYN Guidelines",
  "guidelines": [
    {
      "id": "non-clinical-cs",
      "title": "Non-Clinical Interventions to reduce overall cesarean sections",
      "bookId": 252,          // EHC LMS book id
      "tags": ["Cesarean Section", "..."],
      "phrases": [
        "Implementation of evidence-based clinical practice guidelines ... (Recommended, High-certainty evidence)."
      ]
    }
  ],
  "allTags": ["Cesarean Section", "..."]  // curated searchable tag words
}
```

The recommendation type shown in the badge is the trailing `(Type)` annotation embedded in each phrase (e.g., `(Conditional)`, `(Strong)`, `(GPS)`).

## Deployment

Deployment is handled automatically through **Vercel** on every push to the `master` branch (GitHub → Vercel integration). There is no build step.

```bash
npm run deploy   # optional: deploy with the Vercel CLI instead
```

`vercel.json` sets `no-cache, must-revalidate` headers for the HTML/CSS/JS/JSON assets so updates go live immediately for all users.

## Testing / QA

The repo ships a dependency-free QA suite (`tests/`) covering search logic, tag rendering, sync behavior, accessibility, viewport/responsive layout, provenance, and end-to-end app flows. All harnesses use only Node built-ins; the browser harnesses drive headless Chrome through the DevTools Protocol (CDP).

**Prerequisites:** Node.js 18+ (LTS recommended) and a Chrome/Chromium binary for the browser harnesses. Set `CHROME_BIN` if Chrome is not on the default path.

### Run the full suite locally

```bash
npm test            # syntax validation + every harness; fails on any failure
```

Individual commands:

```bash
npm run test:syntax       # node --check app.js (quick syntax validation)
npm run test:harnesses    # run all QA harnesses without the syntax step
```

The suite runs harnesses sequentially, prints each one's full output, and exits with a non-zero code if any harness fails or its expected pass marker is missing.

### What the CI workflow checks

`.github/workflows/qa.yml` runs on every **push** and **pull request** against an Ubuntu runner with Node.js LTS (22):

1. `node --check app.js` syntax validation.
2. `npm test` — runs `node --check app.js` then every harness via `tests/run-all.js`.
3. Verifies a Chrome/Chromium binary exists (set as `CHROME_BIN`; GitHub-hosted runners ship Google Chrome).
4. Fails the workflow (non-zero exit) on any harness failure; full logs are preserved in the step output.
5. No npm dependency install is required — the suite uses only Node built-ins.

### Which tests need Chrome/Chromium

The following harnesses start a local HTTP server (Node's built-in `http`) and headless Chrome through CDP — nothing else:

- `tests/qa-final.js` — consolidated end-to-end QA
- `tests/test-provenance.js` — provenance, copy search-link, print, strength pills
- `tests/a11y-test.js` — accessibility & color contrast
- `tests/search-state-test.js` — URL restore, back/forward, clear/reset
- `tests/viewport-cdp.js` — responsive layout checks
- `tests/viewport-shots-cdp.js` — writes responsive screenshots to the OS temp dir

All other harnesses are pure Node (no browser): `test-highlight.js`, `test-tags-click.js`, `test-search.js`, `test-prefix.js`, `test-render.js`, `test-all-phrases.js`, `test-search4.js`, `test-sync.js`.

### Which tests simulate LMS synchronization

All sync behavior is simulated and deterministic — no external network dependency:

- `tests/qa-final.js` stubs `window.fetch` (injected before navigation) and reads the LMS mode from `localStorage` (`success` / `fail` / `off`) to exercise sync success, sync failure fallback, and stale-messaging cases.
- The browser harnesses pass `--host-resolver-rules` that block `lms.ehc.gov.eg` and external font hosts, so real LMS/network calls can never occur during the run.
- `tests/test-sync.js` replicates the app's sync rules in-process against throwaway HTTP servers (success, 503 failure, never-responding).

### How to interpret failures

- Each harness prints `PASS ...` / `FAIL ...` lines and a final verdict (`ALL ... PASSED` or `... FAILED`).
- `tests/run-all.js` replays all output, then prints `FAILED harnesses: <names>` and exits non-zero if any harness failed, timed out, or missed its expected pass marker.
- `tests/test-all-phrases.js` reports `Issues: 0` when healthy; the runner requires exactly that.
- Harnesses exit `2` when Chrome cannot be found, `4` on harness-bootstrap errors — check the step log for the specific message when CI fails.

## Project Notes

- **Language:** English only (no RTL/Arabic content).
- **Author:** Created by Dr. Raouf Roshdy.
- **Content source:** Egyptian Health Council — this is a clinical reference aid and does not replace clinical judgement.

## License

Copyright © 2026 Dr. Raouf Roshdy. Licensed under the [MIT License](LICENSE).