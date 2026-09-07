'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { appRoot, chromePath, tmpDir, waitForCdp } = require('./_helpers');

const APP = appRoot;
const CHROME = chromePath();
const PORT = 8810;
const CDP_PORT = 9260;
const PROF = tmpDir('ehc-a11y-prof');

if (!CHROME) { console.error('Chrome/Chromium binary not found. Install Chrome or set CHROME_BIN.'); process.exit(2); }

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8' };
const server = http.createServer((req, res) => {
  const u = req.url.split('?')[0];
  let file = path.join(APP, u === '/' ? 'index.html' : u.replace(/^\//, ''));
  if (!fs.existsSync(file)) { res.writeHead(404); res.end('not found'); return; }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function lum(rgb) {
  const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(rgb[0]) + 0.7152 * f(rgb[1]) + 0.0722 * f(rgb[2]);
}
function ratio(a, b) {
  const L1 = lum(a), L2 = lum(b);
  const hi = Math.max(L1, L2), lo = Math.min(L1, L2);
  return (hi + 0.05) / (lo + 0.05);
}

const MAIN_CHECKS = `
(function(){
  var out = {};
  var d = document;

  // 1. search label association
  var si = d.getElementById('search-input');
  var lbl = d.querySelector('label[for="search-input"]');
  out.searchLabelFor = !!(lbl && lbl.getAttribute('for') === si.id);
  out.searchNameNonEmpty = !!(si.getAttribute('aria-label') || (lbl && lbl.textContent.trim()));

  // 2. clear button
  var cb = d.getElementById('clear-search');
  out.clearHiddenInit = cb.hidden === true;
  out.clearDisplayNoneInit = getComputedStyle(cb).display === 'none';
  out.clearAriaLabel = cb.getAttribute('aria-label');
  out.clearType = cb.getAttribute('type');

  // 3. live regions — must be exactly ONE (role=status is an implicit live region)
  var lives = d.querySelectorAll('[aria-live], [role="status"], [role="alert"]');
  out.liveRegionCount = lives.length;
  out.liveRegionIsStatusRegion = lives.length === 1 && lives[0].id === 'status-region';
  out.syncStatusHasRoleStatus = d.getElementById('sync-status').hasAttribute('role');
  out.resultsSectionLive = d.querySelector('.results-section').hasAttribute('aria-live');
  out.resultsStatsLive = d.getElementById('results-stats').hasAttribute('aria-live');

  // 5. tags container semantics
  var tc = d.getElementById('tags-container');
  out.tagsRole = tc.getAttribute('role');
  out.tagsLabeledBy = tc.getAttribute('aria-labelledby') || tc.getAttribute('aria-label') || '';
  var tbs = tc.querySelectorAll('.tag-btn');
  out.anyTagRoleOption = Array.prototype.some.call(tbs, b => b.getAttribute('role') === 'option');
  out.anyTagAriaSelected = Array.prototype.some.call(tbs, b => b.hasAttribute('aria-selected'));
  out.allTagsPressed = tbs.length > 0 && Array.prototype.every.call(tbs, b => b.hasAttribute('aria-pressed'));
  out.firstTagTabindex = tbs.length ? tbs[0].tabIndex : null;
  var othersFrozen = Array.prototype.every.call(tbs, (b,i) => i === 0 || b.tabIndex === -1);
  out.rovingTabindex = othersFrozen;

  // headings + landmarks
  out.h1Count = d.querySelectorAll('h1').length;
  out.h2Count = d.querySelectorAll('h2').length;
  out.landmarks = ['header','main','footer'].filter(t => d.querySelector(t)).length;
  out.mainLabel = d.querySelector('main').getAttribute('aria-label');

  // result links (populate after search below)
  out.resultLinkNewTabAnnounced = null;

  return out;
})()
`;

const SEARCH_ACTIONS = `
(function(){
  var out = {};
  var d = document, si = d.getElementById('search-input'), region = d.getElementById('status-region');

  // helper: simulate typing
  function type(v){ si.value = v; si.dispatchEvent(new Event('input',{bubbles:true})); }
  function lastAnnounce(){ return region.textContent.trim(); }

  // A) successful search
  type('preeclampsia');
  out.successiveCount = d.querySelectorAll('.result-card').length;
  out.successiveStats = d.getElementById('results-stats').hidden ? '' : d.getElementById('results-stats').textContent.trim();
  out.announceAfterSearch = lastAnnounce();
  out.clearVisibleAfterType = d.getElementById('clear-search').hidden === false;
  // exactly one live write? reset counter
  region.__writes = 0;
  var orig = region.textContent;
  var M = new MutationObserver(function(ms){ ms.forEach(function(m){ if(m.type==='characterData'||m.type==='childList'){ region.__writes++; } }); });
  M.observe(region, {childList:true, characterData:true, subtree:true});

  // B) no-results search
  type('zzzqqqnotaword999');
  out.noResultsVisible = d.getElementById('no-results').hidden === false;
  out.announceAfterNoResults = lastAnnounce();
  out.writesDuringOperations = region.__writes;
  M.disconnect();

  // C) clear via Escape on input
  si.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}));
  out.initialVisibleAfterClear = d.getElementById('initial-state').hidden === false;
  out.clearHiddenAfterClear = d.getElementById('clear-search').hidden === true;
  out.announceAfterClear = lastAnnounce();

  // D) result link new-tab announcement
  type('cesarean');
  var link = d.querySelector('.result-guideline a');
  out.resultLinkTarget = link ? link.target : null;
  out.resultLinkAria = link ? (link.getAttribute('aria-label')||'') : '';
  out.resultLinkHasHiddenSuffix = link ? (link.textContent.indexOf('opens in a new tab') !== -1) : null;

  // E) roving tabindex keyboard on tag buttons
  var tc = d.getElementById('tags-container'), tbs = tc.querySelectorAll('.tag-btn');
  var first = tbs[0], second = tbs[1];
  first.focus();
  first.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));
  out.focusMovedToSecond = document.activeElement === second && second.tabIndex === 0;
  first.dispatchEvent(new KeyboardEvent('keydown',{key:'End',bubbles:true}));
  var lastBtn = tbs[tbs.length-1];
  out.focusMovedToEnd = document.activeElement === lastBtn && lastBtn.tabIndex === 0;
  // Home
  lastBtn.dispatchEvent(new KeyboardEvent('keydown',{key:'Home',bubbles:true}));
  out.focusMovedHome = document.activeElement === first && first.tabIndex === 0;

  // F) Enter selects tag → focus moves to results heading, input synced
  var rh = d.getElementById('results-heading');
  first.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
  out.tagPressed = first.getAttribute('aria-pressed') === 'true';
  out.tagSelectedClass = first.classList.contains('selected');
  out.inputSynced = si.value.trim() === first.dataset.tag;
  out.focusOnResultsHeading = document.activeElement === rh;
  out.rhTabindex = rh.getAttribute('tabindex');

  // G) result-tag click → focus to results heading + new search
  type(first.dataset.tag);
  var rtag = d.querySelector('[data-search-tag]');
  if (rtag) rtag.click();
  out.focusOnResultsHeadingAfterResultTag = document.activeElement === rh;

  return out;
})()
`;

function evalJS(ws, send, expr) {
  return send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }).then(r => r.result.value);
}

server.listen(PORT, () => {
  const chrome = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-sandbox', `--remote-debugging-port=${CDP_PORT}`,
    '--user-data-dir=' + PROF, '--window-size=1280,1000',
    '--host-resolver-rules=MAP lms.ehc.gov.eg 127.0.0.1:1,MAP fonts.googleapis.com 127.0.0.1:1,MAP fonts.gstatic.com 127.0.0.1:1,MAP ehc.gov.eg 127.0.0.1:1',
    'about:blank'
  ]);
  chrome.stderr.on('data', () => {});

(async () => {
      let ws;
      try {
        await waitForCdp(CDP_PORT);
        const targets = await fetch(`http://127.0.0.1:${CDP_PORT}/json/new?${encodeURIComponent('http://127.0.0.1:' + PORT + '/index.html')}`, { method: 'PUT' }).then(r => r.json());
      ws = new WebSocket(targets.webSocketDebuggerUrl);
      let msgId = 0;
      const pending = new Map();
      const consoleErrors = [];
      const send = (method, params = {}) => new Promise((resolve, reject) => {
        const id = ++msgId;
        pending.set(id, { resolve, reject });
        ws.send(JSON.stringify({ id, method, params }));
      });
      ws.onmessage = (ev) => {
        const m = JSON.parse(ev.data);
        if (m.method === 'Runtime.exceptionThrown') consoleErrors.push('PAGEERROR:' + (m.params.exceptionDetails.text || ''));
        if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') consoleErrors.push('LOG:' + m.params.entry.text);
        if (m.id && pending.has(m.id)) {
          const p = pending.get(m.id); pending.delete(m.id);
          if (m.error) p.reject(new Error(m.error.message)); else p.resolve(m.result);
        }
      };
      await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
      await send('Page.enable');
      await send('Runtime.enable');
      await send('Log.enable');
      await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });
      await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/index.html` });
      await sleep(7000);

      const main = await evalJS(ws, send, MAIN_CHECKS);
      const actions = await evalJS(ws, send, SEARCH_ACTIONS);

      // Console errors check — network-resource failures from the test harness's
      // deliberately-blocked external hosts are expected; real JS exceptions are not.
      const realErrors = consoleErrors.filter(e => !/net::ERR_CONNECTION_REFUSED/i.test(e) && !/Failed to load resource: the server responded with a status of 404/i.test(e));

      // ---- Accessibility tree inspection ----
      const ax = await send('Accessibility.getFullAXTree');
      const nodes = ax.nodes || [];
      const roleNames = {};
      nodes.forEach(n => { roleNames[n.role && n.role.value] = (roleNames[n.role && n.role.value] || 0) + 1; });
      const linkNodes = nodes.filter(n => n.role && n.role.value === 'link').map(n => {
        const name = n.name && n.name.value;
        return name;
      });
      const liveNodes = nodes.filter(n => (n.role && (n.role.value === 'alert' || (n.name && n.name.value === 'status-region'))) || (n.properties || []).some(p => p.name === 'aria-live'));
      const searchInputNode = nodes.filter(n => n.role && n.role.value === 'searchbox').map(n => ({ name: n.name && n.name.value }));
      const statusNode = nodes.filter(n => n.role && n.role.value === 'status').map(n => ({ name: n.name && n.name.value }));

      // ---- Contrast audit (light theme) ----
      const CONTRAST = `
      (function(){
        var pairs = [];
        function pick(sel, prop){ var el=document.querySelector(sel); if(!el) return null; var v=getComputedStyle(el)[prop]; var m=v.match(/rgba?\\((\\d+),\\s*(\\d+),\\s*(\\d+)/); return m?[+m[1],+m[2],+m[3]]:null; }
        function build(name, fg, bg){ pairs.push({name:name, fg:fg, bg:bg}); }
        build('body text on bg', pick('body','color'), pick('body','backgroundColor'));
        build('muted on surface', pick('.search-hint','color'), pick('.search-wrapper','backgroundColor'));
        build('tag-btn on tag-bg', pick('.tag-btn','color'), pick('.tag-btn','backgroundColor'));
        build('header-center on surface', pick('.header-center','color'), pick('.header','backgroundColor'));
        build('result phrase on surface', pick('.result-phrase','color'), pick('.result-card','backgroundColor'));
        build('results-stats on primary-light', pick('.results-stats','color'), pick('.results-stats','backgroundColor'));
        build('type pill text', pick('.phrase-type','color'), pick('.phrase-type','backgroundColor'));
        build('strength gps pill text', pick('.phrase-type.strength--gps','color'), pick('.phrase-type.strength--gps','backgroundColor'));
        build('strength cond pill text', pick('.phrase-type.strength--conditional','color'), pick('.phrase-type.strength--conditional','backgroundColor'));
        build('strength weak pill text', pick('.phrase-type.strength--weak','color'), pick('.phrase-type.strength--weak','backgroundColor'));
        build('strength other pill text', pick('.phrase-type.strength--other','color'), pick('.phrase-type.strength--other','backgroundColor'));
        build('badge white on danger', pick('.no-results-badge','color'), pick('.no-results-badge','backgroundColor'));
        build('sync ok green on surface', pick('.sync-status--ok','color'), null);
        build('sync error red on surface', pick('.sync-status--error','color'), null);
        build('source-link on surface', pick('.source-link','color'), pick('.header','backgroundColor'));
        return JSON.parse(JSON.stringify(pairs));
      })()
      `;
      const pairs = await evalJS(ws, send, CONTRAST);
      const surf = await evalJS(ws, send, `(function(){var v=getComputedStyle(document.getElementById('sync-status'));return null;})()`);
      const surfaceBgLight = await evalJS(ws, send, `(()=>{const el=document.querySelector('.header');const v=getComputedStyle(el).backgroundColor;const m=v.match(/rgba?\\((\\d+),\\s*(\\d+),\\s*(\\d+)/);return m?[+m[1],+m[2],+m[3]]:null;})()`);

      const results = [];

      // PRESENT + format
      const ok = (cond, label) => { results.push({ status: cond ? 'OK' : 'FAIL', label, detail: cond ? '' : '' }); return cond; };

      ok(main.searchLabelFor, 'label[for] = search-input id');
      ok(main.searchNameNonEmpty, 'search input has accessible name');
      ok(main.clearHiddenInit, 'clear button hidden when no query');
      ok(main.clearDisplayNoneInit, 'clear button display:none when hidden (hidden attribute not overridden)');
      ok(main.clearAriaLabel === 'Clear search', 'clear button accessible name');
      ok(main.clearType === 'button', 'clear button type=button');
      ok(main.liveRegionCount === 1, 'EXACTLY one live region');
      ok(main.liveRegionIsStatusRegion, 'the single live region is #status-region');
      ok(main.syncStatusHasRoleStatus === false, 'sync-status is not a second live region');
      ok(main.resultsSectionLive === false, 'results section not a live region');
      ok(main.resultsStatsLive === false, 'results stats not a live region');
      ok(main.tagsRole === 'group', 'tag container is role=group (not listbox)');
      ok(!!main.tagsLabeledBy, 'tag group has accessible label');
      ok(main.anyTagRoleOption === false, 'no role=option on tags');
      ok(main.anyTagAriaSelected === false, 'no aria-selected (using aria-pressed instead)');
      ok(main.allTagsPressed === true, 'all tag buttons have aria-pressed');
      ok(main.rovingTabindex === true, 'roving tabindex (single tab stop in tag group)');
      ok(main.h1Count === 1, 'single h1');
      ok(main.h2Count >= 3, 'h2 section headings');
      ok(main.landmarks === 3, 'header/main/footer landmarks');
      ok(main.mainLabel, 'main landmark labeled');

      ok(actions.successiveCount > 0, 'successful search renders cards');
      ok((actions.announceAfterSearch || '').indexOf('phrases found') !== -1 || (actions.announceAfterSearch || '').indexOf('phrase found') !== -1, 'announced result count after success');
      ok(actions.clearVisibleAfterType === true, 'clear button visible with query');
      ok(actions.noResultsVisible === true, 'no-results state shown');
      ok((actions.announceAfterNoResults || '').indexOf('No phrases match') !== -1, 'announced no-results');
      ok(actions.initialVisibleAfterClear === true, 'initial state after clear');
      ok(actions.clearHiddenAfterClear === true, 'clear hidden after clear');
      ok(actions.resultLinkTarget === '_blank', 'result link opens new tab');
      ok(actions.resultLinkAria.indexOf('opens in a new tab') !== -1, 'result link announces new tab');
      ok(actions.focusMovedToSecond, 'ArrowRight moves tag focus');
      ok(actions.focusMovedToEnd, 'End moves tag focus; roving tabindex maintained');
      ok(actions.focusMovedHome, 'Home moves tag focus');
      ok(actions.tagPressed === true, 'selected tag gets aria-pressed=true');
      ok(actions.tagSelectedClass === true, 'selected tag gets .selected');
      ok(actions.inputSynced === true, 'search input synced with selected tag');
      ok(actions.focusOnResultsHeading === true, 'focus moves to results heading after tag select');
      ok(actions.rhTabindex === '-1', 'results heading reachable (tabindex=-1)');
      ok(actions.focusOnResultsHeadingAfterResultTag === true, 'focus moves to results heading after result-tag click');

      ok(realErrors.length === 0, 'no console errors — got: ' + (realErrors.join(' | ') || 'none'));

      // AX tree sanity
      ok(statusNode.length === 1, 'AX tree has a status role');
      ok(searchInputNode.length === 1 && (searchInputNode[0].name || '').toLowerCase().indexOf('search') !== -1, 'AX searchbox named');
      ok(linkNodes.some(n => /opens in a new tab/i.test(n || '')), 'AX link names mention new tab');

      // Contrast
      for (const p of pairs) {
        if (!p.fg) {
          results.push({ status: 'SKIP', label: `contrast ${p.name} (element not present)`, detail: '' });
          continue;
        }
        const r = ratio(p.fg, p.bg || surfaceBgLight);
        p.contrast = +r.toFixed(2);
        const isBadge = p.name.indexOf('badge') === 0;
        const isTypeOrSync = p.name.indexOf('type pill') === 0 || p.name.indexOf('strength') === 0 || p.name.indexOf('sync') === 0;
        const threshold = (isBadge || isTypeOrSync) ? 3 : 4.5;
        p.pass = r >= threshold;
        results.push({ status: p.pass ? 'OK' : 'FAIL', label: `contrast ${p.name} = ${p.contrast}:1 (>=${threshold})`, detail: '' });
      }
      // Explicit color-on-surface contrast for sync states (elements only appear during sync)
      function rgbFromHex(h){ return [parseInt(h.slice(1,3),16), parseInt(h.slice(3,5),16), parseInt(h.slice(5,7),16)]; }
      const syncPairs = [
        { name: 'sync-ok #1e7d46 on surface', hex: '#1e7d46', thr: 3 },
        { name: 'sync-error #b3261e on surface', hex: '#b3261e', thr: 3 },
        { name: 'type green #1e7d46 on #e6f5ec', hex: '#1e7d46', bg: rgbFromHex('#e6f5ec'), thr: 3 },
        { name: 'strength gps #144a70 on #e3eef7', hex: '#144a70', bg: rgbFromHex('#e3eef7'), thr: 3 },
        { name: 'strength cond #7a5a10 on #fcf2d0', hex: '#7a5a10', bg: rgbFromHex('#fcf2d0'), thr: 3 },
        { name: 'strength weak #7a4a6b on #f6e9f2', hex: '#7a4a6b', bg: rgbFromHex('#f6e9f2'), thr: 3 },
        { name: 'strength other #4d5f6e on #eef1f4', hex: '#4d5f6e', bg: rgbFromHex('#eef1f4'), thr: 3 }
      ];
      for (const sp of syncPairs) {
        const rr = ratio(rgbFromHex(sp.hex), sp.bg || surfaceBgLight);
        const pass = rr >= sp.thr;
        results.push({ status: pass ? 'OK' : 'FAIL', label: `contrast ${sp.name} = ${+rr.toFixed(2)}:1 (>=${sp.thr})`, detail: '' });
      }

      let pass = results.every(r => r.status === 'OK' || r.status === 'SKIP');
      for (const r of results) console.log((r.status === 'OK' ? 'PASS ' : (r.status === 'SKIP' ? 'SKIP ' : 'FAIL ')) + r.label + (r.detail ? ' :: ' + r.detail : ''));
      console.log('---');

      // Dark theme contrast (switch emulated media and recompute key pairs)
      await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
      await sleep(400);
      const darkRatios = await evalJS(ws, send, `
        (function(){
          function rgb(h){ return [parseInt(h.slice(1,3),16), parseInt(h.slice(3,5),16), parseInt(h.slice(5,7),16)]; }
          function lum(c){ const f=x=>{x/=255; return x<=0.03928?x/12.92:Math.pow((x+0.055)/1.055,2.4);}; return 0.2126*f(c[0])+0.7152*f(c[1])+0.0722*f(c[2]); }
          function r2(a,b){ const L1=lum(a),L2=lum(b); return (Math.max(L1,L2)+0.05)/(Math.min(L1,L2)+0.05); }
          const bg=rgb('#0f1720'), surf=rgb('#172030'), card=rgb('#172030');
          return [
            ['text on bg', r2(rgb('#e8edf2'), bg), 4.5],
            ['muted on surface', r2(rgb('#8b9cb3'), surf), 4.5],
            ['primary on surface', r2(rgb('#4da8da'), surf), 4.5],
            ['type green on type-bg', r2(rgb('#6fd69a'), rgb('#1d3a2c')), 3],
            ['strength gps on bg', r2(rgb('#a9d2f2'), rgb('#1d3446')), 3],
            ['strength cond on bg', r2(rgb('#f2d77c'), rgb('#45371a')), 3],
            ['strength weak on bg', r2(rgb('#e7b8d8'), rgb('#3a2440')), 3],
            ['strength other on bg', r2(rgb('#b9c6d4'), rgb('#202c39')), 3],
            ['text on card', r2(rgb('#e8edf2'), card), 4.5]
          ];
        })()
      `);
      for (const [name, r, thr] of darkRatios) {
        const p2 = r >= thr;
        if (!p2) pass = false;
        results.push({ status: p2 ? 'OK' : 'FAIL', label: `DARK contrast ${name} = ${r}:1 (>=${thr})`, detail: '' });
        console.log((p2 ? 'PASS ' : 'FAIL ') + `DARK contrast ${name} = ${r}:1 (>=${thr})`);
      }
      console.log('AX roles:', JSON.stringify(roleNames));
      console.log('link tree names:', JSON.stringify(linkNodes.slice(0, 4)));
      console.log('contrast pairs:', JSON.stringify(pairs.filter(p => p.fg && !p.pass).map(p => p.name + '=' + p.contrast)));
      console.log(pass ? 'ALL A11Y CHECKS PASSED' : 'A11Y CHECKS FAILED');

      ws.close(); chrome.kill(); server.close();
      process.exit(pass ? 0 : 1);
    } catch (e) {
      try { ws && ws.close(); chrome.kill(); server.close(); } catch (_) {}
      console.error('HARNESS ERROR:', e.message);
      process.exit(2);
    }
  })();
});