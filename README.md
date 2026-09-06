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

## Project Notes

- **Language:** English only (no RTL/Arabic content).
- **Author:** Created by Dr. Raouf Roshdy.
- **Content source:** Egyptian Health Council — this is a clinical reference aid and does not replace clinical judgement.

## License

Copyright © 2026 Dr. Raouf Roshdy. Licensed under the [MIT License](LICENSE).