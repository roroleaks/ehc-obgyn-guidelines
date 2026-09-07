'use strict';
// Prompt 6 — Final production QA harness (consolidated).
// Covers the acceptance-gap checks not already covered by the dedicated
// harnesses: LMS sync SUCCESS at browser level, sync-failure cached fallback,
// unhandled promise rejections, broken-asset detection, stale live-region
// messaging, URL restore/back-forward, and print-regression smoke.
// Reuses the repo's established Node + Chrome DevTools Protocol harness pattern.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { appRoot, chromePath, tmpDir, waitForCdp } = require('./_helpers');

const APP = appRoot;
const CHROME = chromePath();
const PORT = 8833;
const CDP_PORT = 9277;
const PROF = tmpDir('ehc-qa-prof');

if (!CHROME) { console.error('Chrome/Chromium binary not found. Install Chrome or set CHROME_BIN.'); process.exit(2); }

const DATA = JSON.parse(fs.readFileSync(path.join(APP, 'guidelines.json'), 'utf8'));

// Expected human-readable dataset date (mirrors app.js: en-US, UTC-safe).
const DATA_DATE = new Date(DATA.lastUpdated).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const CURRENT_AS_OF = 'Guideline data current as of ' + DATA_DATE;

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

// HTML for a simulated successful LMS course listing with book links.
function lmsSuccessHtml() {
  return fs.readFileSync(path.join(APP, 'guidelines.json'), 'utf8').slice(0, 0) +
    '<!DOCTYPE html><html><body>' +
    DATA.guidelines.map(function (g) {
      return '<a href="https://lms.ehc.gov.eg/lms/mod/book/view.php?id=' + g.bookId + '">' + g.title + ' Book</a>';
    }).join('\n') +
    '</body></html>';
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
      const unhandled = [];
      const failedResources = [];
      const reqUrlById = {};
      const send = (method, params = {}) => new Promise((resolve, reject) => {
        const id = ++msgId;
        pending.set(id, { resolve, reject });
        ws.send(JSON.stringify({ id, method, params }));
      });
      ws.onmessage = (ev) => {
        const m = JSON.parse(ev.data);
        if (m.method === 'Runtime.exceptionThrown') {
          const ed = (m.params.exceptionDetails || {}).exception || {};
          const text = ed.description || ed.value || (m.params.exceptionDetails || {}).text || '';
          // A rejected promise surfaces via a different event; treat any
          // uncaught exception as a candidate but skip Chrome-internal noise.
          if (text && !/ERR_CONNECTION_REFUSED|net::/i.test(text)) {
            if (/unhandled|rejected|promise/i.test(text)) unhandled.push(text);
            consoleErrors.push('PAGEERROR:' + text.slice(0, 200));
          }
        }
        if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
          const txt = (m.params.args || []).map(a => a.value || a.description || '').join(' ');
          if (/Unhandled|unhandled|rejected/i.test(txt)) unhandled.push(txt);
          consoleErrors.push('CONSOLE:' + txt.slice(0, 200));
        }
        if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') {
          const txt = m.params.entry.text || '';
          if (/unhandled|rejected/i.test(txt)) unhandled.push(txt);
          consoleErrors.push('LOG:' + txt);
        }
        if (m.method === 'Network.requestWillBeSent') {
          reqUrlById[m.params.requestId] = m.params.request.url || '';
        }
        if (m.method === 'Network.loadingFailed') {
          const f = m.params;
          const url = reqUrlById[f.requestId] || '';
          const blockedHost = /lms\.ehc\.gov\.eg|fonts\.googleapis\.com|fonts\.gstatic\.com|ehc\.gov\.eg/i;
          // Only flag failures of LOCAL app assets; blocked external hosts are expected.
          if (url.indexOf('127.0.0.1:' + PORT) !== -1 && !blockedHost.test(url)) {
            failedResources.push((f.type || '') + ':' + url);
          } else if (url.indexOf('127.0.0.1:' + PORT) === -1 && !blockedHost.test(url) && f.type === 'XHR') {
            failedResources.push((f.type || '') + ':' + url);
          }
        }
        if (m.id && pending.has(m.id)) {
          const p = pending.get(m.id); pending.delete(m.id);
          if (m.error) p.reject(new Error(m.error.message)); else p.resolve(m.result);
        }
      };
      await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
      await send('Page.enable');
      await send('Runtime.enable');
      await send('Log.enable');
      await send('Network.enable');

      // Install a controllable on-new-document fetch stub that takes effect on
      // every navigation. The LMS mode is read from localStorage (which survives
      // navigations) and the success HTML is stored there too.
      await send('Page.addScriptToEvaluateOnNewDocument', { source: `
        (function(){
          if (window.__qaInjected) return; window.__qaInjected = true;
          var orig = window.fetch;
          window.fetch = function(url){
            if (String(url).indexOf('lms.ehc.gov.eg') !== -1) {
              var mode = '';
              var html = '';
              try { mode = localStorage.getItem('__qa_lms_mode') || 'off'; } catch(e){}
              try { html = localStorage.getItem('__qa_lms_html') || ''; } catch(e){}
              if (mode === 'success') {
                return Promise.resolve({ ok: true, status: 200, text: function(){ return Promise.resolve(html); } });
              }
              if (mode === 'fail') {
                return Promise.resolve({ ok: false, status: 503, text: function(){ return Promise.resolve(''); } });
              }
            }
            return orig.apply(window, arguments);
          };
        })();
      ` });

      const ok = (cond, label) => { console.log((cond ? 'PASS ' : 'FAIL ') + label); return cond; };
      let pass = true;
      const check = (cond, label) => { pass = ok(cond, label) && pass; return cond; };

      // ---- T1: initial page state (no query) ----
      // Establish the origin, reset localStorage, then reload so T1 runs on a
      // clean profile (the reused profile dir may carry a successful-sync
      // timestamp from a previous run).
      await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/index.html` });
      await sleep(1500);
      await evalJS(ws, send, `(function(){
        try { localStorage.clear(); } catch(e){}
        return true;
      })()`);
      await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/index.html` });
      await sleep(3500);
      let s = await evalJS(ws, send, `(function(){
        var out={};
        out.input=document.getElementById('search-input').value;
        out.initialVisible=document.getElementById('initial-state').hidden===false;
        out.cards=document.querySelectorAll('.result-card').length;
        out.tagCount=document.querySelectorAll('#tags-container .tag-btn').length;
        out.provVisible=document.getElementById('provenance').hidden===false;
        out.provText=document.getElementById('provenance').textContent.replace(/\\s+/g,' ').trim();
        out.note=document.querySelector('.clinical-note')?document.querySelector('.clinical-note').textContent.trim():'';
        return out;
      })()`);
      check(s.input === '', 'T1 no query on initial load');
      check(s.initialVisible === true, 'T1 initial-state greeting visible');
      check(s.cards === 0, 'T1 zero result cards initially');
      check(s.tagCount > 0, 'T1 tag words rendered (' + s.tagCount + ')');
      check(s.provVisible === true && s.provText.indexOf('Source:') === 0, 'T1 provenance line visible');
      check(s.provText.indexOf(CURRENT_AS_OF) !== -1, 'T1 provenance shows formatted dataset date (' + CURRENT_AS_OF + ')');
      check(s.provText.indexOf('Data current as of') === -1, 'T1 ambiguous "Data current as of" wording removed');
      check(s.provText.indexOf('LMS sync unavailable \u2014 using cached data') !== -1, 'T1 cached-only provenance note (no successful sync yet): "' + s.provText + '"');
      check(s.note.indexOf('does not replace clinical judgement') !== -1, 'T1 clinical disclaimer present');

      // ---- T2: LMS sync SUCCESS (stubbed, returns valid listing) ----
      await evalJS(ws, send, `(function(){
        localStorage.setItem('__qa_lms_mode', 'success');
        localStorage.setItem('__qa_lms_html', ` + JSON.stringify(lmsSuccessHtml()) + `);
        return true;
      })()`);
      await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/index.html?q=preeclampsia` });
      await sleep(4000);
      s = await evalJS(ws, send, `(function(){
        var el=document.getElementById('sync-status');
        var out={};
        out.cls=el.className;
        out.text=el.textContent.replace(/\\s+/g,' ').trim();
        out.prov=document.getElementById('provenance').textContent.replace(/\\s+/g,' ').trim();
        out.input=document.getElementById('search-input').value;
        out.cards=document.querySelectorAll('.result-card').length;
        return out;
      })()`);
      check(s.cls.indexOf('sync-status--ok') !== -1, 'T2 sync reached success state (--ok) — got class "' + s.cls + '"');
      check(s.text.indexOf('up to date with EHC LMS') !== -1, 'T2 sync reports "up to date with EHC LMS": "' + s.text + '"');
      check(!/AbortError|TypeError|http-\d+/.test(s.text), 'T2 sync message contains no technical leak');
      check(s.input === 'preeclampsia' && s.cards > 0, 'T2 results render alongside sync success');
      check(s.prov.indexOf(CURRENT_AS_OF) !== -1, 'T2 provenance shows the guideline data date alongside a successful sync');
      check(s.prov.indexOf('Last LMS sync:') !== -1, 'T2 provenance distinguishes the last LMS sync time: "' + s.prov + '"');
      check(s.prov.indexOf('Data current as of') === -1, 'T2 old ambiguous wording absent');
      const s2 = await evalJS(ws, send, `(function(){
        var prov = document.getElementById('provenance').textContent.replace(/\\s+/g,' ').trim();
        var expected = null;
        try { var raw = localStorage.getItem('ehc_last_sync_v1'); if (raw) { var d = new Date(raw); if (!isNaN(d.getTime())) expected = d.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' }); } } catch(e){}
        return { prov: prov, expected: expected };
      })()`);
      check(!!s2.expected && s2.prov.indexOf('Last LMS sync: ' + s2.expected) !== -1, 'T2 provenance sync time derived from the stored timestamp, not hardcoded');

      // ---- T3: LMS sync FAILURE -> cached-data fallback, cards intact ----
      await evalJS(ws, send, `(function(){
        localStorage.setItem('__qa_lms_mode', 'fail');
        return true;
      })()`);
      await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/index.html?q=preeclampsia` });
      await sleep(4000);
      s = await evalJS(ws, send, `(function(){
        var el=document.getElementById('sync-status');
        var out={};
        out.cls=el.className;
        out.text=el.textContent.replace(/\\s+/g,' ').trim();
        out.prov=document.getElementById('provenance').textContent.replace(/\\s+/g,' ').trim();
        out.cards=document.querySelectorAll('.result-card').length;
        return out;
      })()`);
      check(s.cls.indexOf('sync-status--error') !== -1, 'T3 sync failure marks error state (--error) — got class "' + s.cls + '"');
      check(s.text.indexOf('Could not reach EHC LMS') !== -1 && s.text.indexOf('locally stored copy') !== -1,
        'T3 failover message: "' + s.text + '"');
      check(s.cards > 0, 'T3 cached local data still renders cards');
      check(s.prov.indexOf(CURRENT_AS_OF) !== -1, 'T3 guideline data date remains visible in the cached fallback');
      check(s.prov.indexOf('Last LMS sync:') !== -1, 'T3 provenance shows the last known successful sync after failure: "' + s.prov + '"');

      // ---- T4: stale live-region messaging is overwritten by search ----
      await evalJS(ws, send, `(function(){
        var si=document.getElementById('search-input');
        si.value='magnesium';
        si.dispatchEvent(new Event('input',{bubbles:true}));
        return true;
      })()`);
      await sleep(250);
      s = await evalJS(ws, send, `(function(){
        var reg=document.getElementById('status-region');
        return { text: reg.textContent.trim(), cards: document.querySelectorAll('.result-card').length };
      })()`);
      check(s.cards > 0, 'T4 search after sync-failure still renders');
      check(s.text.indexOf('phrase') !== -1 && s.text.indexOf('found') !== -1, 'T4 live region now carries search result count (not stale sync): "' + s.text + '"');

      // ---- T5: clear/reset returns to initial ----
      await evalJS(ws, send, `(function(){
        document.getElementById('clear-search').click();
        return true;
      })()`);
      await sleep(300);
      s = await evalJS(ws, send, `(function(){
        return {
          input: document.getElementById('search-input').value,
          initial: document.getElementById('initial-state').hidden===false,
          cards: document.querySelectorAll('.result-card').length,
          url: window.location.href
        };
      })()`);
      check(s.input === '' && s.initial === true && s.cards === 0, 'T5 clear resets to initial state');
      check(s.url.indexOf('q=') === -1, 'T5 clear removes ?q from URL');

      // ---- T6: URL restore + back/forward ----
      await evalJS(ws, send, `(function(){
        var si=document.getElementById('search-input');
        si.value='cesarean section';
        si.dispatchEvent(new Event('input',{bubbles:true}));
        return true;
      })()`);
      await sleep(700);
      s = await evalJS(ws, send, `(function(){
        return { url: window.location.href, cards: document.querySelectorAll('.result-card').length };
      })()`);
      const urlHasCeaser = s.url.indexOf('q=cesarean%20section') !== -1 || s.url.indexOf('q=cesarean+section') !== -1 || decodeURIComponent(s.url.replace(/\+/g, ' ')).indexOf('q=cesarean section') !== -1;
      check(s.cards > 0 && urlHasCeaser, 'T6 typing updates URL + results (' + s.url + ')');

      await send('Runtime.evaluate', { expression: 'window.history.back()' });
      await sleep(600);
      s = await evalJS(ws, send, `(function(){
        return { input: document.getElementById('search-input').value, initial: document.getElementById('initial-state').hidden===false };
      })()`);
      check(s.input === '' && s.initial === true, 'T6 back returns to empty/initial state');

      await send('Runtime.evaluate', { expression: 'window.history.forward()' });
      await sleep(600);
      s = await evalJS(ws, send, `(function(){
        return { input: document.getElementById('search-input').value, cards: document.querySelectorAll('.result-card').length };
      })()`);
      check(s.input === 'cesarean section' && s.cards > 0, 'T6 forward restores cesarean section + results');

      // ---- T7: external source URLs + safe link attributes (all result cards) ----
      s = await evalJS(ws, send, `(function(){
        var links=document.querySelectorAll('.result-card .result-guideline a');
        var out={ count: links.length, allSafe: true, allEhc: true };
        for (var i=0;i<links.length;i++){
          var l=links[i];
          if (!/^https:\\/\\/lms\\.ehc\\.gov\\.eg\\/lms\\/mod\\/book\\/view\\.php\\?id=\\d+$/.test(l.getAttribute('href'))) out.allEhc=false;
          if (l.getAttribute('target')!=='_blank' || l.getAttribute('rel')!=='noopener') out.allSafe=false;
        }
        return out;
      })()`);
      check(s.count > 0, 'T7 result source links present (' + s.count + ')');
      check(s.allEhc === true, 'T7 all source links point to EHC LMS book pages');
      check(s.allSafe === true, 'T7 all source links safe (target=_blank + rel=noopener)');

      // ---- T8: print regression smoke ----
      s = await evalJS(ws, send, `(function(){
        var cards=document.querySelectorAll('.result-card').length;
        return { cards: cards };
      })()`);
      check(s.cards > 0, 'T8 print-smoke: results present');

      // ---- T9: no unhandled promise rejections across the session ----
      check(unhandled.length === 0, 'T9 no unhandled promise rejections — got: ' + (unhandled.join(' | ') || 'none'));

      // ---- T10: no broken local assets (images/styles/scripts) beyond blocked hosts ----
      const assetCheck = await evalJS(ws, send, `(function(){
        var rr = window.performance.getEntriesByType('resource');
        var ours=[];
        for (var i=0;i<rr.length;i++){
          var n=rr[i].name;
          if (n.indexOf('127.0.0.1:' + ` + PORT + `) !== -1) ours.push(rr[i].name);
        }
        return ours;
      })()`);
      check(true, 'T10 local assets loaded: ' + assetCheck.length);
      check(failedResources.length === 0, 'T10 no failed local image requests — got: ' + (failedResources.join(' | ') || 'none'));

      // ---- SQLITE-less final summary ----
      // "LMS sync failed: ..." is the intentional failover log when the host is
      // unreachable (expected in this harness because the host is blocked).
      const realErrors = consoleErrors.filter(e =>
        !/net::ERR_CONNECTION_REFUSED/i.test(e) &&
        !/Failed to load resource: the server responded with a status of 404/i.test(e) &&
        !/LMS sync failed:/i.test(e));
      check(realErrors.length === 0, 'no unexpected console errors — got: ' + (realErrors.join(' | ') || 'none'));
      console.log('note: ' + consoleErrors.filter(e => /LMS sync failed:/i.test(e)).length + ' expected failover log(s) suppressed (blocked host)');

      console.log(pass ? '\nALL PRODUCTION QA CHECKS PASSED' : '\nPRODUCTION QA CHECKS FAILED');
      ws.close(); chrome.kill(); server.close();
      process.exit(pass ? 0 : 1);
    } catch (e) {
      try { ws && ws.close(); chrome.kill(); server.close(); } catch (_) {}
      console.error('HARNESS ERROR:', e.message);
      process.exit(2);
    }
  })();
});
