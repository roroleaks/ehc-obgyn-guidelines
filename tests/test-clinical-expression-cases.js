'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { appRoot, chromePath, waitForCdp, tmpDir } = require('./_helpers');

const APP = appRoot;
const CHROME = chromePath();
const PORT = 8855;
const CDP_PORT = 9299;
const PROF = tmpDir('ehc-cases-prof');

if (!CHROME) { console.error('Chrome not found'); process.exit(2); }

const data = JSON.parse(fs.readFileSync(path.join(APP, 'guidelines.json'), 'utf8'));
const tagSet = new Set((data.allTags || []).map(t => t.toLowerCase()));

// CASE 1: Words and multi-word expressions NOT in allTags, but present in EHC guidelines
const CASE_1_QUERIES = [
  // Multi-word medical expressions (all strictly not in allTags)
  { query: 'shoulder dystocia', type: 'multi-word expression' },
  { query: 'fetal heart rate', type: 'multi-word expression' },
  { query: 'cervical ripening', type: 'multi-word expression' },
  { query: 'epidural analgesia', type: 'multi-word expression' },
  { query: 'external cephalic version', type: 'multi-word expression' },
  { query: 'bimanual uterine compression', type: 'multi-word expression' },
  { query: 'active phase of labor', type: 'multi-word expression' },
  { query: 'blood pressure', type: 'multi-word expression' },
  { query: 'vacuum extraction', type: 'multi-word expression' },
  { query: 'catamenial pneumothorax', type: 'multi-word expression' },
  { query: 'hypotonic intravenous fluids', type: 'multi-word expression' },
  // Single medical words (all strictly not in allTags)
  { query: 'dinoprostone', type: 'single word' },
  { query: 'betamethasone', type: 'single word' },
  { query: 'mcroberts', type: 'single word' },
  { query: 'dystocia', type: 'single word' },
  { query: 'ketonuria', type: 'single word' }
];

// CASE 2: Words and multi-word expressions NOT in EHC guidelines
const CASE_2_QUERIES = [
  // Multi-word expressions
  { query: 'coronary artery bypass', type: 'multi-word expression' },
  { query: 'total knee arthroplasty', type: 'multi-word expression' },
  { query: 'alzheimer disease dementia', type: 'multi-word expression' },
  // Single words
  { query: 'appendectomy', type: 'single word' },
  { query: 'amiodarone', type: 'single word' },
  { query: 'pneumococcal', type: 'single word' },
  { query: 'xyzquantum999', type: 'nonsense word' }
];

// Verify setup: confirm Case 1 queries are indeed NOT in tag words
CASE_1_QUERIES.forEach(item => {
  const isTag = tagSet.has(item.query.toLowerCase());
  if (isTag) {
    console.warn(`WARNING: Query "${item.query}" is already in allTags!`);
  }
});

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
  if (!fs.existsSync(file)) { res.writeHead(404); res.end('not found'); return; }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});

server.listen(PORT, async () => {
  const chrome = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-sandbox', `--remote-debugging-port=${CDP_PORT}`,
    '--user-data-dir=' + PROF, '--window-size=1280,900', 'about:blank'
  ]);

  try {
    await waitForCdp(CDP_PORT);
    const targets = await fetch(`http://127.0.0.1:${CDP_PORT}/json/new?about:blank`, { method: 'PUT' }).then(r => r.json());
    const ws = new WebSocket(targets.webSocketDebuggerUrl);
    let msgId = 0;
    const pending = new Map();
    function send(method, params = {}) {
      return new Promise((resolve, reject) => {
        const id = ++msgId;
        pending.set(id, { resolve, reject });
        ws.send(JSON.stringify({ id, method, params }));
      });
    }
    ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && pending.has(m.id)) {
        const p = pending.get(m.id); pending.delete(m.id);
        if (m.error) p.reject(new Error(m.error.message)); else p.resolve(m.result);
      }
    };
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    await send('Page.enable');
    await send('Runtime.enable');

    async function evaluateSearch(query, isMobile) {
      if (isMobile) {
        await send('Emulation.setDeviceMetricsOverride', { width: 375, height: 812, deviceScaleFactor: 2, mobile: true });
      } else {
        await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
      }

      await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/index.html` });
      await new Promise(r => setTimeout(r, 1200));

      const code = `(function(){
        const input = document.getElementById('search-input');
        input.value = ${JSON.stringify(query)};
        input.dispatchEvent(new Event('input', { bubbles: true }));
      })()`;
      await send('Runtime.evaluate', { expression: code });
      await new Promise(r => setTimeout(r, 600));

      const checkCode = `(function(){
        const cards = document.querySelectorAll('.result-card');
        const noResults = document.getElementById('no-results');
        const initialState = document.getElementById('initial-state');
        const stats = document.getElementById('results-stats');
        const badge = noResults ? noResults.querySelector('.no-results-badge') : null;
        const noResP = noResults ? noResults.innerText : '';
        const cardData = Array.from(cards).slice(0, 3).map(c => ({
          title: c.querySelector('.result-guideline')?.innerText?.trim() || '',
          phrase: c.querySelector('.result-phrase')?.innerText?.trim() || '',
          hasMark: !!c.querySelector('mark'),
          bookId: c.getAttribute('data-book-id')
        }));

        return {
          cardCount: cards.length,
          noResultsHidden: noResults ? noResults.hidden : true,
          noResultsVisible: noResults ? (noResults.hidden === false && getComputedStyle(noResults).display !== 'none') : false,
          badgeText: badge ? badge.innerText.trim() : '',
          noResText: noResP,
          initialStateHidden: initialState ? initialState.hidden : true,
          statsText: stats ? stats.innerText.trim() : '',
          sampleCards: cardData
        };
      })()`;

      const res = await send('Runtime.evaluate', { expression: checkCode, returnByValue: true });
      return res && res.result && res.result.value;
    }

    let allPassed = true;
    const testCases = [
      { name: 'Desktop (1280px)', isMobile: false },
      { name: 'Mobile (375px)', isMobile: true }
    ];

    for (const env of testCases) {
      console.log(`\n======================================================`);
      console.log(`TESTING ENVIRONMENT: ${env.name}`);
      console.log(`======================================================`);

      // CASE 1: Words/expressions not in allTags, but present in EHC guidelines
      console.log(`\n--- CASE 1: NOT in tag words, but IN EHC Guidelines (Must find exact recommendations) ---`);
      for (const item of CASE_1_QUERIES) {
        const result = await evaluateSearch(item.query, env.isMobile);
        const pass = result && result.cardCount > 0 && result.noResultsHidden === true && result.initialStateHidden === true;
        if (pass) {
          console.log(`[PASS] "${item.query}" (${item.type}) -> Found ${result.cardCount} recommendation card(s).`);
          console.log(`       Sample: [${result.sampleCards[0].title}] "${result.sampleCards[0].phrase.slice(0, 85)}..."`);
          console.log(`       Highlighted with <mark>: ${result.sampleCards[0].hasMark}`);
        } else {
          console.error(`[FAIL] "${item.query}" (${item.type}) -> Expected results, got ${result ? result.cardCount : 'null'} cards!`);
          allPassed = false;
        }
      }

      // CASE 2: Words/expressions not in EHC guidelines (Must display "Not Found")
      console.log(`\n--- CASE 2: NOT in EHC Guidelines (Must display "Not Found" message) ---`);
      for (const item of CASE_2_QUERIES) {
        const result = await evaluateSearch(item.query, env.isMobile);
        const hasNotFoundBadge = result && /not found/i.test(result.badgeText);
        const hasNoPhrasesMatch = result && result.noResText.indexOf(`No phrases match "${item.query}"`) !== -1;
        const zeroCards = result && result.cardCount === 0;
        const pass = result && result.noResultsVisible === true && hasNotFoundBadge && hasNoPhrasesMatch && zeroCards;

        if (pass) {
          console.log(`[PASS] "${item.query}" (${item.type}) -> Correctly displayed NOT FOUND.`);
          console.log(`       Badge: "${result.badgeText}" | Message: No phrases match "${item.query}"`);
        } else {
          console.error(`[FAIL] "${item.query}" (${item.type}) -> Expected NOT FOUND state!`);
          console.error(`       Details: zeroCards=${zeroCards}, visible=${result ? result.noResultsVisible : false}, badge="${result ? result.badgeText : ''}"`);
          allPassed = false;
        }
      }
    }

    ws.close();
    chrome.kill();
    server.close();

    console.log(`\n======================================================`);
    if (allPassed) {
      console.log('ALL CASE 1 & CASE 2 CLINICAL EXPRESSION TESTS PASSED (100%)');
      process.exit(0);
    } else {
      console.error('SOME CLINICAL EXPRESSION TESTS FAILED!');
      process.exit(1);
    }
  } catch (err) {
    console.error('Harness error:', err);
    try { chrome.kill(); server.close(); } catch (_) {}
    process.exit(2);
  }
});
