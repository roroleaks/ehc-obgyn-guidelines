# Project Instructions & Mandatory Workflow Protocol

## Fixed Rule: Multi-Platform Edit, QA, Deploy & Snapshot Protocol

For **every edit, feature, modification, or bug fix** in this project, the following 4-step workflow must be strictly and sequentially executed:

### Step 1: Desktop & Mobile Interface Parity
- Every UI, feature, or logic edit must be implemented and optimized for BOTH desktop and mobile interfaces ($\le 640\text{px}$, responsive viewports 320px, 375px, 390px, 768px).
- Enforce touch target accessibility ($\ge 44\text{px}$ for buttons, inputs, pills, clear actions, $\ge 40\text{px}$ for tag chips).
- Guarantee zero horizontal scrollbar overflow across all viewports (`scrollWidth <= clientWidth + 1`).
- Maintain the clinical color highlight system and WCAG AA contrast ratios ($\ge 4.5:1$ text, $\ge 3:1$ pills/badges).

### Step 2: Full Test Suite Execution
- Run the full automated test suite: `npm test`
- All 17 QA harnesses must pass with 100% success:
  1. `tests/viewport-cdp.js` (Headless CDP viewport verification across 320, 375, 390, 768, 1280px)
  2. `tests/a11y-test.js` (Light & dark mode color contrast, AX tree, landmarks, live regions)
  3. `tests/search-state-test.js` (State persistence, URL sync, roving tabindex, query clearing)
  4. `tests/test-provenance.js` (EHC LMS attribution, book URLs, sync states, fallback handling)
  5. `tests/test-all-tags-thorough.js` (All tag words validation and medical expressions)
  6. `tests/test-normal-labor.js` & `tests/test-search4.js` (Exact phrase matching & relevance)
  7. `tests/test-non-tag-clinical-queries.js` (Free-text medical query clinical extraction)
  8. `tests/test-all-phrases.js` & `tests/test-highlight.js` (Highlight & phrase rendering)
  9. `tests/test-sync.js`, `tests/test-render.js`, `tests/test-search.js`, `tests/test-prefix.js`, `tests/test-tags-click.js`
  10. `tests/qa-final.js` (Production regression verification)

### Step 3: Live Site Verification
- Stage, commit with descriptive message, and push to GitHub (`origin master`).
- Check live deployment on Vercel at `https://ehc-obgyn-guidelines.vercel.app/`.
- Validate that the updated assets and features are live and functioning.

### Step 4: Final ZIP Snapshot Update on User's PC
- Generate/update the compressed snapshot archive of the repository on the user's PC:
  - `C:\Users\raouf.RAOUFDESKTOP\.gemini\antigravity\scratch\ehc-obgyn-guidelines-snapshot.zip`
  - `C:\Users\raouf.RAOUFDESKTOP\Desktop\ehc-obgyn-guidelines-snapshot.zip`
- Ensure the archive is clean, complete, and contains the latest code.
