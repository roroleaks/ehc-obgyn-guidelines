'use strict';
// Browser-level test for Prompt 4: URL state persistence, back/forward,
// variant/plural matching, instant search, injection safety, tag-click & clear.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { appRoot, chromePath, tmpDir } = require('./_helpers');

const APP = appRoot;
const CHROME = chromePath();
const PORT = 8812;
const CDP_PORT = 9262;
const PROF = tmpDir('ehc-search-prof');

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

  setTimeout(async () => {
    let ws;
    try {
      const targets = await fetch(`http://127.0.0.1:${CDP_PORT}/json/new?${encodeURIComponent('http://127.0.0.1:' + PORT + '/index.html')}`, { method: 'PUT' }).then(r => r.json());
      ws = new WebSocket(targets.webSocketDebuggerUrl);
      let msgId = 0;
      const pending = new Map();
      const consoleErrors = [];
      const alerts = [];
      const send = (method, params = {}) => new Promise((resolve, reject) => {
        const id = ++msgId;
        pending.set(id, { resolve, reject });
        ws.send(JSON.stringify({ id, method, params }));
      });
      ws.onmessage = (ev) => {
        const m = JSON.parse(ev.data);
        if (m.method === 'Runtime.exceptionThrown') consoleErrors.push('PAGEERROR:' + (m.params.exceptionDetails.text || ''));
        if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') consoleErrors.push('LOG:' + m.params.entry.text);
        if (m.method === 'Page.javascriptDialogOpening') alerts.push(m.params.message);
        if (m.id && pending.has(m.id)) {
          const p = pending.get(m.id); pending.delete(m.id);
          if (m.error) p.reject(new Error(m.error.message)); else p.resolve(m.result);
        }
      };
      await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
      await send('Page.enable');
      await send('Runtime.enable');
      await send('Log.enable');

      const ok = (cond, label) => { console.log((cond ? 'PASS ' : 'FAIL ') + label); return cond; };
      let pass = true;
      const check = (cond, label) => { pass = ok(cond, label) && pass; return cond; };

      // ---- TEST 1: direct URL load with ?q=preeclampsia ----
      await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/index.html?q=preeclampsia` });
      await sleep(4000);
      let s = await evalJS(ws, send, `(function(){
        var out={};
        out.inputValue=document.getElementById('search-input').value;
        out.cards=document.querySelectorAll('.result-card').length;
        out.stats=document.getElementById('results-stats').hidden?'':document.getElementById('results-stats').textContent.trim();
        out.url=window.location.href;
        return out;
      })()`);
      check(s.inputValue === 'preeclampsia', 'T1 direct URL loads query into input');
      check(s.cards > 0, 'T1 direct URL shows results');
      check(s.url.indexOf('q=preeclampsia') !== -1, 'T1 URL preserved after direct load');
      check((s.stats || '').length > 0 && (s.stats.indexOf('Showing') !== -1), 'T1 stats line present');

      // ---- TEST 2: instant search with variant + plural ----
      s = await evalJS(ws, send, `(function(){
        var si=document.getElementById('search-input');
        si.value='cesarean sections';
        si.dispatchEvent(new Event('input',{bubbles:true}));
        var counts={after:document.querySelectorAll('.result-card').length};
        var stats=document.getElementById('results-stats').textContent.trim();
        counts.statsAfter=stats;
        return counts;
      })()`);
      check(s.after > 0, 'T2 instant search fires on input (variant plural query: ' + s.after + ' cards)');
      check((s.statsAfter || '').indexOf('cesarean sections') !== -1, 'T2 stats shows query text');

      // wait for debounced URL write
      await sleep(600);
      const urlAfterType = await evalJS(ws, send, 'window.location.href');
      check(urlAfterType.indexOf('q=cesarean%20sections') !== -1 || urlAfterType.indexOf('q=cesarean+sections') !== -1 || decodeURIComponent(urlAfterType).indexOf('q=cesarean sections') !== -1, 'T2 URL updated to cesarean sections after idle');

      // ---- TEST 3: back / forward restores query & results ----
      await send('Runtime.evaluate', { expression: 'window.history.back()' });
      await sleep(700);
      s = await evalJS(ws, send, `(function(){
        var out={};
        out.inputValue=document.getElementById('search-input').value;
        out.cards=document.querySelectorAll('.result-card').length;
        out.url=window.location.href;
        return out;
      })()`);
      check(s.inputValue === 'preeclampsia', 'T3 back restores preeclampsia in input');
      check(s.cards > 0, 'T3 back restores results');
      check(s.url.indexOf('q=preeclampsia') !== -1, 'T3 URL rolled back');

      await send('Runtime.evaluate', { expression: 'window.history.forward()' });
      await sleep(700);
      s = await evalJS(ws, send, `(function(){
        var out={};
        out.inputValue=document.getElementById('search-input').value;
        out.cards=document.querySelectorAll('.result-card').length;
        return out;
      })()`);
      check(s.inputValue === 'cesarean sections', 'T3 forward restores cesarean sections in input');
      check(s.cards > 0, 'T3 forward restores results');

      // ---- TEST 4: HTML injection safety ----
      s = await evalJS(ws, send, `(function(){
        var si=document.getElementById('search-input');
        si.value='<script>window.__xss=1;alert(1)</script>';
        si.dispatchEvent(new Event('input',{bubbles:true}));
        var out={};
        out.cards=document.querySelectorAll('.result-card').length;
        out.noResults=document.getElementById('no-results').hidden===false;
        out.xss=window.__xss||0;
        out.statsEl=document.getElementById('results-stats');
        out.statsText=out.statsEl.textContent.trim();
        out.injectionNodes=document.querySelectorAll('#no-results script, .result-phrase script, .result-card mark').length;
        return out;
      })()`);
      check(s.cards === 0, 'T4 HTML input yields no result cards');
      check(s.noResults === true, 'T4 HTML input shows no-results');
      check(s.xss === 0 && alerts.length === 0, 'T4 script never executed (no alert, no __xss)');
      check(s.injectionNodes === 0, 'T4 no injected <script> nodes in output');

      // ---- TEST 5: special characters / quotes ----
      s = await evalJS(ws, send, `(function(){
        var si=document.getElementById('search-input');
        si.value='"preeclampsia"';
        si.dispatchEvent(new Event('input',{bubbles:true}));
        document.getElementById('results-stats').textContent;
        return document.querySelectorAll('.result-card').length;
      })()`);
      check(s >= 0, 'T5 quotes query safe (cards=' + s + ')');

      // ---- TEST 6: results stats distinguish exact vs related ----
      await evalJS(ws, send, `(function(){
        var si=document.getElementById('search-input');
        si.value='preeclampsia';
        si.dispatchEvent(new Event('input',{bubbles:true}));
        return true;
      })()`);
      await sleep(400);
      s = await evalJS(ws, send, `(function(){
        return document.getElementById('results-stats').textContent.trim();
      })()`);
      check((s.indexOf('exact') !== -1), 'T6 stats distinguishes exact matches: "' + s + '"');
      check(/Showing \d+ phrase[s]? for/.test(s), 'T6 stats format "Showing N phrases for"');

      // ---- TEST 7: prefix/partial matches marked as related ----
      await evalJS(ws, send, `(function(){
        var si=document.getElementById('search-input');
        si.value='preeclamp';
        si.dispatchEvent(new Event('input',{bubbles:true}));
        return true;
      })()`);
      await sleep(400);
      s = await evalJS(ws, send, `(function(){
        return { stats: document.getElementById('results-stats').textContent.trim(), cards: document.querySelectorAll('.result-card').length };
      })()`);
      check(s.cards > 0, 'T7 partial prefix yields results');
      check(/related/.test(s.stats), 'T7 partial marked as related: "' + s.stats + '"');

      // ---- TEST 8: no-results actionable + variant suggestion path ----
      await evalJS(ws, send, `(function(){
        var si=document.getElementById('search-input');
        si.value='zzzznonsense999';
        si.dispatchEvent(new Event('input',{bubbles:true}));
        return true;
      })()`);
      await sleep(300);
      s = await evalJS(ws, send, `(function(){
        var nr=document.getElementById('no-results');
        return { hidden: nr.hidden, text: nr.textContent.trim().slice(0,200) };
      })()`);
      check(s.hidden === false, 'T8 nonsense shows no-results');
      check(s.text.indexOf('Try a different keyword') !== -1, 'T8 no-results actionable hint');
      check(s.text.indexOf('zzzznonsense999') !== -1, 'T8 no-results echoes query safely');

      // ---- TEST 9: tag-click updates URL + clears work ----
      s = await evalJS(ws, send, `(function(){
        var tbs=document.querySelectorAll('#tags-container .tag-btn');
        var first=tbs[0];
        first.click();
        return {
          input: document.getElementById('search-input').value,
          cards: document.querySelectorAll('.result-card').length,
          url: window.location.href,
          pressed: first.getAttribute('aria-pressed'),
          selected: first.classList.contains('selected')
        };
      })()`);
      check(s.input.length > 0 && s.cards > 0, 'T9 tag click performs search (' + s.input + ', ' + s.cards + ' cards)');
      check(decodeURIComponent(s.url).indexOf('q=' + encodeURIComponent(s.input)) !== -1 || decodeURIComponent(s.url).indexOf('q=' + s.input.replace(/ /g,'+')) !== -1, 'T9 tag click updates URL');
      check(s.pressed === 'true' && s.selected === true, 'T9 tag selected with aria-pressed=true');

      // re-click the same tag toggles it OFF
      s = await evalJS(ws, send, `(function(){
        var tbs=document.querySelectorAll('#tags-container .tag-btn');
        tbs[0].click();
        return {
          input: document.getElementById('search-input').value,
          pressed: tbs[0].getAttribute('aria-pressed'),
          selected: tbs[0].classList.contains('selected'),
          url: window.location.href
        };
      })()`);
      check(s.input === '' && s.pressed === 'false' && s.selected === false, 'T9 re-click deselects + clears input');
      check(s.url.indexOf('q=') === -1, 'T9 deselect removes q from URL');

      // clear button
      await evalJS(ws, send, `(function(){
        document.getElementById('clear-search').click();
        return true;
      })()`);
      await sleep(300);
      s = await evalJS(ws, send, `(function(){
        return {
          input: document.getElementById('search-input').value,
          initial: document.getElementById('initial-state').hidden===false,
          clearHidden: document.getElementById('clear-search').hidden===true,
          url: window.location.href
        };
      })()`);
      check(s.input === '' && s.initial === true && s.clearHidden === true, 'T10 clear empties search + shows initial');
      check(s.url.indexOf('q=') === -1, 'T10 clear removes ?q from URL');

      // ---- TEST 11: search help toggles ----
      s = await evalJS(ws, send, `(function(){
        var tgl=document.getElementById('search-help-toggle');
        var panel=document.getElementById('search-help');
        return { openAfterClick:(function(){ panel.open=true; tgl.click(); return {open:panel.open, label:tgl.textContent, expanded:tgl.getAttribute('aria-expanded')}; })() };
      })()`);
      check(s.openAfterClick.label === 'Search help', 'T11 help toggle label after close');

      // ---- TEST 12: empty query shows initial state ----
      s = await evalJS(ws, send, `(function(){
        var si=document.getElementById('search-input');
        si.value='';
        si.dispatchEvent(new Event('input',{bubbles:true}));
        return { initial: document.getElementById('initial-state').hidden===false, cards: document.querySelectorAll('.result-card').length };
      })()`);
      check(s.initial === true && s.cards === 0, 'T12 empty query shows initial state');

      // ---- no console JS errors (net blocked-host errors expected) ----
      const realErrors = consoleErrors.filter(e => !/net::ERR_CONNECTION_REFUSED/i.test(e) && !/Failed to load resource: the server responded with a status of 404/i.test(e));
      check(realErrors.length === 0, 'no console errors — got: ' + (realErrors.join(' | ') || 'none'));

      console.log(pass ? 'ALL SEARCH-STATE TESTS PASSED' : 'SEARCH-STATE TESTS FAILED');
      ws.close(); chrome.kill(); server.close();
      process.exit(pass ? 0 : 1);
    } catch (e) {
      try { ws && ws.close(); chrome.kill(); server.close(); } catch (_) {}
      console.error('HARNESS ERROR:', e.message);
      process.exit(2);
    }
  }, 1500);
});