'use strict';
/**
 * Automated Test Suite: EHC LMS Guideline Auto-Update & Dynamic Screening
 *
 * Validates that when a new guideline file is uploaded to the original EHC website:
 *   https://lms.ehc.gov.eg/lms/course/view.php?id=38
 * The web application automatically detects the new guideline on launch and executes 2 jobs:
 *   Job 1: Updates tag search words automatically with the new item after careful screening
 *          (stripping action verbs, discarding generic words, enforcing <= 2 words, title case).
 *   Job 2: Subsequently updates search results following all clinical rules
 *          (exact phrase matching, multi-word contiguous priority, highlights, provenance, filters).
 *
 * Verifies Desktop (1280px) and Mobile (375px) environments.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { appRoot, chromePath, tmpDir, waitForCdp } = require('./_helpers');

const APP = appRoot;
const CHROME = chromePath();
const PORT = 8866;
const CDP_PORT = 9311;
const PROF = tmpDir('ehc-auto-update-prof');

if (!CHROME) {
  console.error('Chrome/Chromium binary not found.');
  process.exit(2);
}

const DATA = JSON.parse(fs.readFileSync(path.join(APP, 'guidelines.json'), 'utf8'));

// Simulated HTML for EHC LMS course page with 11 existing guidelines PLUS 1 newly uploaded guideline (Book 999)
const NEW_BOOK_ID = 999;
const NEW_BOOK_TITLE = 'Induction of Labor and Post-Term Pregnancy';

function coursePageWithNewGuidelineHtml() {
  const existingLinks = DATA.guidelines.map(g =>
    `<a href="https://lms.ehc.gov.eg/lms/mod/book/view.php?id=${g.bookId}">${g.title} Book</a>`
  ).join('\n');

  const newLink = `<a href="https://lms.ehc.gov.eg/lms/mod/book/view.php?id=${NEW_BOOK_ID}">${NEW_BOOK_TITLE} Book</a>`;

  return `<!DOCTYPE html>
<html>
<head><title>EHC OB/GYN Course</title></head>
<body>
  <div class="course-content">
    ${existingLinks}
    ${newLink}
  </div>
</body>
</html>`;
}

// Simulated content for the newly uploaded guideline file on EHC LMS
function newGuidelineContentHtml() {
  return `<!DOCTYPE html>
<html>
<head><title>${NEW_BOOK_TITLE}</title></head>
<body>
  <div id="mod_book-chapter" class="book_content">
    <h3>Induction of Labor and Post-Term Pregnancy Clinical Practice Guidelines</h3>
    <p>We recommend offering induction of labor to women with uncomplicated singleton pregnancies between 41+0 and 42+0 weeks of gestation.</p>
    <p>Membrane sweeping should be offered to women prior to formal induction of labor to promote spontaneous onset of labor.</p>
    <p>Membrane sweeping reduces the requirement for formal induction of labor and is safe in uncomplicated singleton pregnancies.</p>
    <p>Intravenous oxytocin infusion combined with amniotomy is recommended for induction of labor in women with a favorable cervix.</p>
    <p>Continuous electronic fetal monitoring using cardiotocography is mandatory during active oxytocin induction.</p>
  </div>
</body>
</html>`;
}

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon'
};

const server = http.createServer((req, res) => {
  const u = req.url.split('?')[0];
  let file = path.join(APP, u === '/' ? 'index.html' : u.replace(/^\//, ''));
  if (!fs.existsSync(file)) {
    res.writeHead(404);
    res.end('not found');
    return;
  }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function evalJS(ws, send, expr) {
  return send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
    .then(r => r.result ? r.result.value : null);
}

server.listen(PORT, async () => {
  const chrome = spawn(CHROME, [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    `--remote-debugging-port=${CDP_PORT}`,
    '--user-data-dir=' + PROF,
    '--window-size=1280,1000',
    '--host-resolver-rules=MAP lms.ehc.gov.eg 127.0.0.1:1,MAP fonts.googleapis.com 127.0.0.1:1,MAP fonts.gstatic.com 127.0.0.1:1,MAP ehc.gov.eg 127.0.0.1:1',
    'about:blank'
  ]);
  chrome.stderr.on('data', () => {});

  let allPassed = true;
  function ok(cond, label) {
    if (cond) {
      console.log('PASS ' + label);
    } else {
      console.error('FAIL ' + label);
      allPassed = false;
    }
    return cond;
  }

  try {
    await waitForCdp(CDP_PORT);
    const targets = await fetch(`http://127.0.0.1:${CDP_PORT}/json/new?${encodeURIComponent('http://127.0.0.1:' + PORT + '/index.html')}`, { method: 'PUT' }).then(r => r.json());
    const ws = new WebSocket(targets.webSocketDebuggerUrl);

    let msgId = 0;
    const pending = new Map();
    const send = (method, params = {}) => new Promise((resolve, reject) => {
      const id = ++msgId;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });

    ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && pending.has(m.id)) {
        const p = pending.get(m.id);
        pending.delete(m.id);
        if (m.error) p.reject(new Error(m.error.message));
        else p.resolve(m.result);
      }
    };

    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    await send('Page.enable');
    await send('Runtime.enable');

    // Intercept fetches to lms.ehc.gov.eg so we simulate LMS course & new guideline book
    const courseHtmlEscaped = JSON.stringify(coursePageWithNewGuidelineHtml());
    const newBookHtmlEscaped = JSON.stringify(newGuidelineContentHtml());

    await send('Page.addScriptToEvaluateOnNewDocument', {
      source: `
        (function() {
          var origFetch = window.fetch;
          var courseHtml = ${courseHtmlEscaped};
          var newBookHtml = ${newBookHtmlEscaped};

          window.fetch = function(url, opts) {
            var u = String(url);
            if (u.indexOf('course/view.php?id=38') !== -1) {
              return Promise.resolve({
                ok: true,
                status: 200,
                text: function() { return Promise.resolve(courseHtml); }
              });
            }
            if (u.indexOf('mod/book/view.php?id=999') !== -1 || u.indexOf('mod/resource/view.php?id=999') !== -1) {
              return Promise.resolve({
                ok: true,
                status: 200,
                text: function() { return Promise.resolve(newBookHtml); }
              });
            }
            if (u.indexOf('lms.ehc.gov.eg') !== -1) {
              // Existing books return a minimal 200 response
              return Promise.resolve({
                ok: true,
                status: 200,
                text: function() { return Promise.resolve('<html><body>Existing Book</body></html>'); }
              });
            }
            return origFetch.apply(window, arguments);
          };
        })();
      `
    });

    console.log('\n======================================================');
    console.log('TEST SUITE: AUTOMATIC DETECTION & SCREENING OF NEW GUIDELINES');
    console.log('Source URL: https://lms.ehc.gov.eg/lms/course/view.php?id=38');
    console.log('======================================================\n');

    // Clean profile initial load
    await send('Page.navigate', { url: 'http://127.0.0.1:' + PORT + '/index.html' });
    await sleep(1500);
    await evalJS(ws, send, `try { localStorage.clear(); } catch(e){}`);
    await send('Page.navigate', { url: 'http://127.0.0.1:' + PORT + '/index.html' });

    // Allow sync and auto-ingestion to complete
    console.log('Waiting for LMS sync & ingestion of newly uploaded guideline file...');
    let syncSettled = false;
    for (let attempt = 0; attempt < 30; attempt++) {
      await sleep(500);
      const syncInfo = await evalJS(ws, send, `(function() {
        var el = document.getElementById('sync-status');
        return el ? { text: el.textContent, className: el.className } : null;
      })()`);
      if (syncInfo && syncInfo.className.indexOf('sync-status--ok') !== -1) {
        syncSettled = true;
        console.log(`Sync settled successfully: "${syncInfo.text}"`);
        break;
      }
    }
    ok(syncSettled, 'LMS auto-sync successfully detected and ingested the new guideline file');

    // -------------------------------------------------------------
    // JOB 1: Automatic Tag Words Update after Careful Screening
    // -------------------------------------------------------------
    console.log('\n--- JOB 1: Tag Words Update after Careful Screening ---');

    const job1Data = await evalJS(ws, send, `(function() {
      var container = document.getElementById('tags-container');
      var btns = container ? Array.from(container.querySelectorAll('.tag-btn')).map(b => b.textContent.trim()) : [];
      var membraneTagBtn = container ? container.querySelector('.tag-btn[data-tag="Membrane Sweeping"]') : null;
      var topicFilter = document.getElementById('topic-filter');
      var options = topicFilter ? Array.from(topicFilter.querySelectorAll('option')).map(o => ({ value: o.value, text: o.textContent.trim() })) : [];

      var baseSet = new Set(${JSON.stringify(DATA.allTags)});
      var newDiscovered = btns.filter(t => !baseSet.has(t));

      return {
        totalTags: btns.length,
        hasMembraneSweepingTag: btns.indexOf('Membrane Sweeping') !== -1,
        membraneTagBtnExists: !!membraneTagBtn,
        newDiscoveredTags: newDiscovered,
        // Check screening on newly discovered tags: no action verbs, no generic words, max 2 words
        newTagsHaveActionVerbs: newDiscovered.some(t => /^(assess|recommend|offer|consider|screen|perform|manage|monitor|treat|evaluate)\\b/i.test(t)),
        newTagsHaveGenericWords: newDiscovered.some(t => /^(women|patient|guideline|evidence|certainty|risk)\\b/i.test(t)),
        newTagsHaveLongTags: newDiscovered.some(t => t.split(/\\s+/).length > 2),
        // Topic filter check
        topicOptionsCount: options.length,
        hasNewTopicOption: options.some(o => o.value === 'lms-live-999' && o.text === 'Induction of Labor and Post-Term Pregnancy')
      };
    })()`);

    ok(job1Data.hasMembraneSweepingTag, 'Job 1: "Membrane Sweeping" automatically added to tag words after screening');
    ok(job1Data.membraneTagBtnExists, 'Job 1: Clickable tag button for "Membrane Sweeping" rendered in DOM');
    ok(job1Data.totalTags > 203, `Job 1: Total tag words increased from 203 baseline (current: ${job1Data.totalTags})`);
    ok(!job1Data.newTagsHaveActionVerbs, 'Job 1 Screening: Action verbs (Recommend, Offer, Assess) strictly rejected from new tags');
    ok(!job1Data.newTagsHaveGenericWords, 'Job 1 Screening: Generic terms (Women, Guideline, Evidence) strictly rejected from new tags');
    ok(!job1Data.newTagsHaveLongTags, 'Job 1 Screening: All new tags strictly obey the maximum 2-word clinical boundary');
    ok(job1Data.hasNewTopicOption, 'Job 1: New guideline option "Induction of Labor and Post-Term Pregnancy" added to Topic Filter');

    // -------------------------------------------------------------
    // JOB 2: Subsequently Update Search Results within Previous Rules
    // -------------------------------------------------------------
    console.log('\n--- JOB 2: Update Search Results within Previous Clinical Rules ---');

    // Test A: Clicking the new tag button in the UI
    console.log('\n[Job 2 - Action A] Clicking newly screened tag button "Membrane Sweeping"...');
    const tagClickResult = await evalJS(ws, send, `(function() {
      var btn = document.querySelector('.tag-btn[data-tag="Membrane Sweeping"]');
      if (!btn) return { error: 'button not found' };
      btn.click();
      var input = document.getElementById('search-input');
      var cards = Array.from(document.querySelectorAll('.result-card'));
      var stats = document.getElementById('results-stats');
      return {
        inputValue: input ? input.value : '',
        cardCount: cards.length,
        statsText: stats ? stats.textContent : '',
        cardData: cards.map(c => {
          var header = c.querySelector('.result-guideline');
          var a = header ? header.querySelector('a') : null;
          var p = c.querySelector('.result-phrase');
          var marks = p ? Array.from(p.querySelectorAll('mark')).map(m => m.textContent) : [];
          return {
            guidelineTitle: a ? a.textContent.trim() : '',
            guidelineHref: a ? a.getAttribute('href') : '',
            target: a ? a.getAttribute('target') : '',
            rel: a ? a.getAttribute('rel') : '',
            phraseText: p ? p.textContent.trim() : '',
            highlights: marks,
            hasCopyBtn: !!c.querySelector('.copy-btn')
          };
        })
      };
    })()`);

    ok(tagClickResult.inputValue === 'Membrane Sweeping', 'Search input populated with clicked tag "Membrane Sweeping"');
    ok(tagClickResult.cardCount === 2, `Correctly returned 2 recommendation cards for "Membrane Sweeping" (got: ${tagClickResult.cardCount})`);
    ok(tagClickResult.cardData.length > 0 && tagClickResult.cardData[0].guidelineTitle.indexOf('Induction of Labor and Post-Term Pregnancy') !== -1,
      'Card header attributes recommendation to "Induction of Labor and Post-Term Pregnancy"');
    ok(tagClickResult.cardData.length > 0 && tagClickResult.cardData[0].guidelineHref === 'https://lms.ehc.gov.eg/lms/mod/book/view.php?id=999',
      'Source link points to new guideline on EHC LMS (book ID 999)');
    ok(tagClickResult.cardData.length > 0 && tagClickResult.cardData[0].target === '_blank' && tagClickResult.cardData[0].rel === 'noopener',
      'Source link securely opens in new tab with target=_blank and rel=noopener');
    ok(tagClickResult.cardData.length > 0 && tagClickResult.cardData[0].highlights.length > 0,
      'Exact query match is highlighted inside <mark> tag');
    ok(tagClickResult.cardData.length > 0 && tagClickResult.cardData[0].hasCopyBtn,
      'Clinician Copy button present on newly ingested recommendation cards');

    // Test B: Multi-word contiguous medical expression search
    console.log('\n[Job 2 - Action B] Searching multi-word expression "induction of labor"...');
    await evalJS(ws, send, `(function() {
      var input = document.getElementById('search-input');
      input.value = 'induction of labor';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
    await sleep(400);

    const multiWordResult = await evalJS(ws, send, `(function() {
      var cards = Array.from(document.querySelectorAll('.result-card'));
      return {
        cardCount: cards.length,
        topCardTitle: cards.length > 0 ? (cards[0].querySelector('.result-guideline') || {}).textContent || '' : '',
        topCardText: cards.length > 0 ? (cards[0].querySelector('.result-phrase') || {}).textContent || '' : '',
        topCardHighlights: cards.length > 0 ? Array.from(cards[0].querySelectorAll('mark')).map(m => m.textContent) : []
      };
    })()`);

    ok(multiWordResult.cardCount > 0, `Multi-word expression "induction of labor" returned ${multiWordResult.cardCount} recommendation card(s)`);
    ok(multiWordResult.topCardHighlights.length > 0, 'Multi-word expression highlighted as cohesive clinical concept');

    // Test C: Single-word query from new guideline: "amniotomy"
    console.log('\n[Job 2 - Action C] Searching specific new medical term "amniotomy"...');
    await evalJS(ws, send, `(function() {
      var input = document.getElementById('search-input');
      input.value = 'amniotomy';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
    await sleep(400);

    const singleWordResult = await evalJS(ws, send, `(function() {
      var cards = Array.from(document.querySelectorAll('.result-card'));
      return {
        cardCount: cards.length,
        cardPhrases: cards.map(c => (c.querySelector('.result-phrase') || {}).textContent || ''),
        highlights: cards.length > 0 ? Array.from(cards[0].querySelectorAll('mark')).map(m => m.textContent) : []
      };
    })()`);

    ok(singleWordResult.cardCount >= 1, `Term "amniotomy" found ${singleWordResult.cardCount} recommendation card(s)`);
    ok(singleWordResult.cardPhrases.some(p => p.toLowerCase().indexOf('oxytocin infusion combined with amniotomy') !== -1),
      'Returned exact recommendation phrase containing "amniotomy"');
    ok(singleWordResult.highlights.length > 0, 'Exact word "amniotomy" highlighted with <mark>');

    // Test D: Negative query test (Rule: not in any guidelines -> NOT FOUND)
    console.log('\n[Job 2 - Action D] Searching query not in any guidelines "coronary artery bypass"...');
    await evalJS(ws, send, `(function() {
      var input = document.getElementById('search-input');
      input.value = 'coronary artery bypass';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
    await sleep(400);

    const notFoundResult = await evalJS(ws, send, `(function() {
      var noRes = document.getElementById('no-results');
      var badge = noRes ? noRes.querySelector('.no-results-badge') : null;
      var cards = document.querySelectorAll('.result-card');
      return {
        noResultsVisible: noRes && !noRes.classList.contains('hidden') && noRes.offsetParent !== null,
        badgeText: badge ? badge.textContent.trim() : '',
        cardCount: cards.length
      };
    })()`);

    ok(notFoundResult.noResultsVisible, 'Correctly displays NOT FOUND state when query is not in guidelines');
    ok(/not found/i.test(notFoundResult.badgeText), 'Explicit NOT FOUND badge displayed');
    ok(notFoundResult.cardCount === 0, 'Zero cards leaked during NOT FOUND state');

    // Test E: Mobile Viewport Evaluation (375x667)
    console.log('\n--- Mobile Viewport Parity Check (375px) ---');
    await send('Emulation.setDeviceMetricsOverride', {
      width: 375,
      height: 667,
      deviceScaleFactor: 2,
      mobile: true
    });
    await sleep(500);

    const mobileCheck = await evalJS(ws, send, `(function() {
      var input = document.getElementById('search-input');
      input.value = 'membrane sweeping';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      var cards = document.querySelectorAll('.result-card');
      var tagBtn = document.querySelector('.tag-btn[data-tag="Membrane Sweeping"]');
      return {
        cardCount: cards.length,
        tagBtnVisible: !!tagBtn,
        cardVisible: cards.length > 0 && cards[0].offsetParent !== null
      };
    })()`);

    ok(mobileCheck.cardCount === 2, `Mobile: Search returns identical 2 cards for "membrane sweeping"`);
    ok(mobileCheck.tagBtnVisible, 'Mobile: "Membrane Sweeping" tag button exists and accessible in mobile UI');
    ok(mobileCheck.cardVisible, 'Mobile: Recommendation card is visibly rendered with responsive styling');

    // Clean up
    ws.close();
    chrome.kill();
    server.close();

    console.log('\n======================================================');
    if (allPassed) {
      console.log('ALL LMS AUTO-DETECTION, SCREENING & SEARCH UPDATE CHECKS PASSED (100%)');
      process.exit(0);
    } else {
      console.error('SOME LMS AUTO-DETECTION CHECKS FAILED!');
      process.exit(1);
    }
  } catch (err) {
    console.error('Harness error:', err);
    try { chrome.kill(); server.close(); } catch (_) {}
    process.exit(2);
  }
});
