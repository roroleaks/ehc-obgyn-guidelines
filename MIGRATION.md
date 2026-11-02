# EHC OB/GYN Guidelines — Comprehensive Audit, Correction, and Hardening Migration Report

**Date:** 2026-11-02  
**Target Repository:** `roroleaks/ehc-obgyn-guidelines`  
**Authoritative Source:** Egyptian Health Council (EHC) Learning Management System (LMS)  
**Authoritative Course URL:** `https://lms.ehc.gov.eg/lms/course/view.php?id=38` (Section 186)

---

## 1. Executive Summary

This migration documents the comprehensive clinical audit, data pipeline correction, provenance modeling, and synchronization hardening performed on the `ehc-obgyn-guidelines` search engine.

Prior to this audit, the application had five critical stop-ship vulnerabilities:
1. **Live Synchronization Contamination:** The parser ingested footer and navigation links (`mod/page` such as `Council activities`, `About council`, `Board of Trustees`, and `mod/resource` PDFs), presenting administrative council pages as clinical guidelines.
2. **Weak Synchronization Success Condition:** Any non-empty response was treated as successful and updated the sync timestamp, even if content was unverified or non-guideline.
3. **Missing Phrase-Level Provenance:** Production recommendation phrases lacked chapter-level traceability and source hashes.
4. **Hallucination Risk via Unverified Enrichment:** `scripts/enrich-guidelines-lms.js` had injected 39 manually authored phrases without chapter IDs, hashes, or authentic LMS source quotes.
5. **Ingestion Scaffolding Leaks:** Chapter titles in snapshots were corrupted with 146 occurrences of `"Login to your account"` due to modal login scrapings.

Through this migration, all five stop-ship findings were systematically corrected, verified against the live EHC LMS, and locked behind deterministic CI gates.

---

## 2. Inventory Verification & Scope Confinement

The authoritative EHC Course 38 Section 186 inventory was audited directly on the live server. Exactly 11 guideline books exist:

| Book ID | Canonical Title | Module Type | Verification Status |
| :--- | :--- | :--- | :--- |
| **252** | Non-Clinical Interventions to reduce overall cesarean sections | `mod/book` | Verified Active Guideline |
| **646** | Rationalizing the use of caesarean section in Egypt through implementing 10 group Classification system | `mod/book` | Verified Active Guideline |
| **652** | The diagnosis and management of ectopic pregnancy & pregnancy of unknown location | `mod/book` | Verified Active Guideline |
| **653** | Prevention and Treatment of Hypertension in Pregnancy | `mod/book` | Verified Active Guideline |
| **656** | Placenta Accreta Spectrum (PAS): Diagnosis and Management | `mod/book` | Verified Active Guideline |
| **665** | The diagnosis and management of endometriosis | `mod/book` | Verified Active Guideline |
| **670** | Recommendations on The Clinical Interventions For The Prevention of The Primary Cesarean Section | `mod/book` | Verified Active Guideline |
| **713** | Primary Postpartum Hemorrhage | `mod/book` | Verified Active Guideline |
| **716** | The management of nausea and vomiting during pregnancy | `mod/book` | Verified Active Guideline |
| **744** | Normal Labor | `mod/book` | Verified Active Guideline |
| **771** | Prevention And Management Of Preterm Labor | `mod/book` | Verified Active Guideline |

### Non-Guideline Rejections:
All non-guideline links discovered on the live Moodle layout were cataloged and quarantined:
- `mod/page` Links: `About council` (ID 148), `Vision, mission and values` (ID 149), `Council activities` (ID 150), `Board of Trustees` (ID 151), `Board of Directors` (ID 153), `the Executive President` (ID 154).
- `mod/resource` Links: Administrative PDFs or course materials (e.g. ID 9999).
- Scaffolding Anchors: All links located inside `<header>`, `<nav>`, `<footer>`, or `.footer_company_widget`.

---

## 3. Provenance Architecture & 100% Traceability

### Schema
Every clinical recommendation phrase is mapped to a verified provenance manifest in `data/phrase-provenance.json`:

```json
{
  "phraseId": "normal-labor-42",
  "source": "EHC",
  "bookId": 744,
  "bookTitle": "Normal Labor",
  "bookUrl": "https://lms.ehc.gov.eg/lms/mod/book/view.php?id=744",
  "chapterId": "5251",
  "chapterTitle": "Recommendations",
  "chapterUrl": "https://lms.ehc.gov.eg/lms/mod/book/view.php?id=744&chapterid=5251",
  "sourceText": "Undertake perineal repair using a continuous non-locked suturing technique for the vaginal wall and muscle layer and continuous subcuticular for the skin.",
  "displayText": "Undertake perineal repair using a continuous non-locked suturing technique for the vaginal wall and muscle layer and continuous subcuticular for the skin. (Strong)",
  "sourceTextHash": "62b21ff62ba4a7eb513e488b0fbeaf7ec0cb288dafd2ec0c7104b0870ea45db2",
  "sourceLastUpdated": "2026-07-21",
  "extractionMethod": "verbatim",
  "verifiedAt": "2026-11-02T12:00:00Z"
}
```

### Metrics
- **Total active phrases in production (`guidelines.json`):** 337 phrases
- **Total phrase provenance mappings (`data/phrase-provenance.json`):** 337 records (100% coverage)
- **Provenance audit verification (`npm run validate:data`):** 100% PASSED (0 missing records, 0 hash collisions, 0 module mismatches).

---

## 4. Isolation and Quarantine of Hallucinated Enrichment

The 39 unverified phrases manually appended by `scripts/enrich-guidelines-lms.js` were extracted, audited, and isolated into `data/quarantined-enrichment.json`.
- **Reason for Quarantine:** Lack of verifiable EHC chapter IDs, missing cryptographic text hashes, and unverified source quotes.
- **Replacement with Authentic EHC Quotes:** Verified authentic sentences from the EHC LMS book chapters were extracted for valid clinical concepts (such as `Cell Salvage` and `Ureteric Stents` in Book 656 Chapter 4200, `PPROM` and `Erythromycin` in Book 771 Chapter 5601, `Perineal Repair` in Book 744 Chapter 5251, `Bimanual Compression` in Book 713 Chapter 4854).
- **Negative Finding Validation:** Unverified concepts not present in EHC guidelines (e.g. `shoulder dystocia`, `McRoberts maneuver`, `dinoprostone`) were properly cataloged as non-guideline queries in Case 2 of the clinical expressions suite, ensuring the app honestly presents the "NOT FOUND" badge with zero leaked cards.

---

## 5. Chapter Header Cleanup & Login Modal Removal

- **Defect:** In prior snapshots, Moodle Edumy theme login modals `<h3 class="text-center">Login to your account</h3>` were scraped as chapter titles across all 11 books (146 occurrences).
- **Correction:** Chapter titles were extracted directly from authentic `.book_toc` table of contents containers and chapter heading elements (`h3.ccnMdlHeading`), completely eliminating login leaks (`0` login leaks across all books and snapshot manifests).

---

## 6. Live Synchronization Hardening

In `app.js`, `syncWithLms()` was refactored:
1. **Container Scoping:** Restricts selection strictly to `.course-content, #region-main, [role="main"], .topics`.
2. **Scaffolding Rejection:** Explicitly rejects any anchor where `a.closest('footer, .footer, .footer_company_widget, nav, header')` matches.
3. **Module Type Enforcement:** Accepts only `mod/book/view.php?id=\d+`. Rejects `mod/page` and `mod/resource`.
4. **Structured Sync Validation:** Tracks `sourceUrl`, `fetchTimestamp`, `observedBooks`, `rejectedLinks`, and `isValid`.
5. **Conditional Persistence:** `saveLastSync()` is only invoked when all 11 guideline books are validated and verified.

---

## 7. Search Engine Normalization & Clinical Symbols

`app.js` and query normalization were enhanced:
- **Greek Letter Mapping:** Maps `β` / `&beta;` to `beta`, `α` to `alpha`, `γ` to `gamma`, `δ` to `delta`.
- **Clinical Math Symbols:** Normalizes `≤` to `<=`, `≥` to `>=`, `±` to `+/-`, `×` to `x`, `–`/`—` to `-`.
- **Bi-directional Clinical Variants:** Added `ecv` ⇄ `external cephalic version`, `pul` ⇄ `pregnancy of unknown location`, `pprom` ⇄ `preterm prelabor rupture of membranes`, `meows` ⇄ `modified early obstetric warning`.
- **Punctuation Boundaries:** Queries like `β-hCG` seamlessly match `beta hCG` without treating hyphens as clinical blockers.

---

## 8. Verification and Test Execution

The full regression test suite (20 harnesses) runs via `npm test` and `node tests/run-all.js`:
- `test-highlight.js`: Word highlighting and term preservation.
- `test-tags-click.js`: Tag interaction and query synchronization.
- `test-search.js`: Exact and multi-word term matching.
- `test-prefix.js`: Prefix-matching boundaries.
- `test-render.js`: Card rendering and accessibility structure.
- `test-all-phrases.js`: Quality check of all 337 active phrases.
- `test-search4.js`: Comprehensive search edge cases and XSS safety.
- `test-normal-labor.js`: Normal labor guideline assertions.
- `test-all-tags-thorough.js`: 100% of all 203 clinical tags verified.
- `test-non-tag-clinical-queries.js`: 15 authentic non-tag clinical queries verified.
- `test-sync.js`: Network timeout, fast server, 503 failover, and date formatting.
- `test-sync-provenance-safety.js`: Footer link rejection and module safety against real LMS course HTML.
- `viewport-cdp.js`: Multi-device responsive layout check (320px, 375px, 390px, 768px, 1280px).
- `viewport-shots-cdp.js`: Visual regression snapshot capture.
- `a11y-test.js`: WCAG AA color contrast, ARIA live regions, and screen-reader accessibility.
- `search-state-test.js`: Browser navigation, pushState/popState, URL persistence.
- `test-provenance.js`: Clinical disclaimer, provenance attribution, copy clipboard byte parity.
- `test-clinical-expression-cases.js`: Case 1 (in guidelines) vs Case 2 (not in guidelines) desktop & mobile parity.
- `test-lms-auto-update.js`: Live guideline auto-detection, screening, and tag updates.
- `qa-final.js`: End-to-end production readiness validation.
