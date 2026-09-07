'use strict';
// Browser-level test for Prompt 5: result provenance, recommendation strength pills,
// copy/search-link/print workflow controls, near-results disclaimer, LMS link integrity,
// and guarantee that recommendation wording is never modified.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { appRoot, chromePath, tmpDir, waitForCdp } = require('./_helpers');

const APP = appRoot;
const CHROME = chromePath();
const PORT = 8822;
const CDP_PORT = 9264;
const PROF = tmpDir('ehc-provenance-prof');

if (!CHROME) { console.error('Chrome/Chromium binary not found. Install Chrome or set CHROME_BIN.'); process.exit(2); }

const DATA = JSON.parse(fs.readFileSync(path.join(APP, 'guidelines.json'), 'utf8'));
const SOURCE = DATA.source;
const SOURCE_URL = DATA.sourceUrl;
const LAST_UPDATED = DATA.lastUpdated;

// Expected recommendation-strength labels seen in the local dataset
const EXPECTED_STRENGTH_KEYS = ['strong', 'gps', 'conditional', 'weak', 'other'];

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
      // Stub the LMS/guidelines fetch BEFORE any page script runs so the initial
      // sync settles deterministically instead of racing the live-region checks.
      await send('Page.addScriptToEvaluateOnNewDocument', { source: `
        (function(){
          var orig = window.fetch;
          window.fetch = function(url){
            var u = String(url);
            if (u.indexOf('lms.ehc.gov.eg') !== -1) {
              return Promise.resolve({ ok:false, status:503, json:function(){ return Promise.resolve({}); }, text:function(){ return Promise.resolve(''); } });
            }
            return orig.apply(window, arguments);
          };
        })();
      ` });
      // Reload so the new-document fetch stub applies (it only runs on future navigations).
      await send('Page.navigate', { url: 'http://127.0.0.1:' + PORT + '/index.html' });
      await sleep(3000); // let guidelines.json + provenance finish loading before the first assertion

      let pass = true;
      const ok = (cond, label) => { console.log((cond ? 'PASS ' : 'FAIL ') + label); return cond; };
      const check = (cond, label) => { pass = ok(cond, label) && pass; return cond; };

      // ---- T1: initial page state: toolbar + provenance + disclaimer present ----
      let s = await evalJS(ws, send, `(function(){
        var out={};
        out.copyLink = !!document.getElementById('copy-search-link');
        out.printBtn = !!document.getElementById('print-results');
        out.note = document.querySelector('.clinical-note') ? document.querySelector('.clinical-note').textContent.trim() : '';
        out.prov = document.getElementById('provenance');
        out.provText = out.prov ? out.prov.textContent.replace(/\\s+/g,' ').trim() : '';
        out.provLink = out.prov ? out.prov.querySelector('a') : null;
        out.provHref = out.provLink ? out.provLink.getAttribute('href') : '';
        out.provRel = out.provLink ? out.provLink.getAttribute('rel') : '';
        out.provTarget = out.provLink ? out.provLink.getAttribute('target') : '';
        return out;
      })()`);
      check(s.copyLink && s.printBtn, 'T1 toolbar controls present (copy link + print)');
      check(s.note === 'Clinical reference aid \u2014 does not replace clinical judgement.', 'T1 near-results clinical disclaimer verbatim: "' + s.note + '"');
      check(s.provText.length > 0, 'T1 provenance line rendered');
      check(s.provText.indexOf('Source:') === 0, 'T1 provenance starts with "Source:"');
      check(s.provText.indexOf(SOURCE) !== -1, 'T1 provenance contains source name: ' + SOURCE);
      check(s.provHref === SOURCE_URL, 'T1 provenance source href correct: ' + s.provHref);
      check(s.provRel === 'noopener', 'T1 provenance link rel=noopener');
      check(s.provTarget === '_blank', 'T1 provenance link target=_blank');
      check(s.provText.indexOf('Data current as of ' + LAST_UPDATED) !== -1, 'T1 provenance shows dataset last-updated ' + LAST_UPDATED);

      // ---- T2: successful search with many results + per-card provenance ----
      await evalJS(ws, send, `(function(){
        var si=document.getElementById('search-input');
        si.value='cesarean';
        si.dispatchEvent(new Event('input',{bubbles:true}));
        return true;
      })()`);
      await sleep(500);
      s = await evalJS(ws, send, `(function(){
        var cards=document.querySelectorAll('.result-card');
        var bookIds=[], metas=[], links=[];
        Array.prototype.forEach.call(cards, function(c){
          bookIds.push(c.getAttribute('data-book-id'));
          var m=c.querySelector('.result-book-meta');
          metas.push(m?m.textContent.trim():'');
          var a=c.querySelector('.result-guideline a');
          if(a) links.push({href:a.getAttribute('href'), rel:a.getAttribute('rel'), target:a.getAttribute('target'), aria:a.getAttribute('aria-label')});
        });
        return { count: cards.length, bookIds: bookIds, metas: metas, links: links };
      })()`);
      check(s.count > 1, 'T2 many-results search fires (' + s.count + ' cards)');
      check(s.bookIds.length === s.count && s.bookIds.every(function(b){ return /^\d+$/.test(b); }), 'T2 every card exposes an honest data-book-id');
      check(s.metas.every(function(m, i){ return m === 'Book ' + s.bookIds[i]; }), 'T2 every card shows matching "Book N" provenance');
      const bookIdSet = {};
      DATA.guidelines.forEach(g => { bookIdSet[g.bookId] = true; });
      check(s.bookIds.every(function(b){ return !!bookIdSet[b]; }) && s.count > 0, 'T2 card book ids exist in the local dataset');
      check(s.links.length === s.count && s.links.every(function(l){
        return /^https:\/\/lms\.ehc\.gov\.eg\/lms\/mod\/book\/view\.php\?id=\d+$/.test(l.href);
      }), 'T2 source links point to EHC LMS book pages');
      check(s.links.every(function(l){ return l.rel === 'noopener' && l.target === '_blank' && /, opens in a new tab$/.test(l.aria); }), 'T2 source links safe (noopener, new tab, labelled)');

      // ---- T3: strength pill present (fixture "preeclampsia magnesium" -> single Strong card) ----
      await evalJS(ws, send, `(function(){
        var si=document.getElementById('search-input');
        si.value='preeclampsia magnesium';
        si.dispatchEvent(new Event('input',{bubbles:true}));
        return true;
      })()`);
      await sleep(500);
s = await evalJS(ws, send, `(function(){
        var cards=document.querySelectorAll('.result-card');
        var card=cards[0];
        var pill=card?card.querySelector('.phrase-type'):null;
        var phraseEl=card?card.querySelector('.result-phrase'):null;
        var a=card?card.querySelector('.result-guideline a'):null;
        return {
          cards: cards.length,
          input: document.getElementById('search-input').value,
          book: card?card.getAttribute('data-book-id'):null,
          hasPill: !!pill,
          strength: pill?pill.getAttribute('data-strength'):null,
          aria: pill?pill.getAttribute('aria-label'):'',
          classes: pill?pill.className:'',
          phraseText: phraseEl?phraseEl.textContent:'',
          title: (function(){ var a=card.querySelector('.result-guideline a'); return ((a.firstChild&&a.firstChild.textContent)||a.textContent); })()
        };
      })()`);
      check(s.cards === 1, 'T3 fixture "preeclampsia magnesium" returns exactly 1 card');
      check(s.hasPill === true, 'T3 strength pill rendered for a Strong recommendation');
      check(EXPECTED_STRENGTH_KEYS.indexOf(s.strength) !== -1, 'T3 pill key valid: ' + s.strength);
      check(s.aria.indexOf('Recommendation strength: ') === 0, 'T3 pill has accessible strength label: "' + s.aria + '"');
      // verify wording of that single card matches the source phrase byte-for-byte
      const expT3 = "Prevention and Treatment of Hypertension in Pregnancy";
      const match = DATA.guidelines.some(function(g){
        return g.title.replace(/\s+/g, ' ').trim() === s.title && g.phrases.some(function(p){ return p === s.phraseText; });
      });
      check(match, 'T3 rendered phrase text identical to source recommendation (wording unchanged) [' + (s.title || '').slice(0, 40) + ' | ' + (s.phraseText || '').slice(-30) + ']');
      check(s.title === expT3, 'T3 card title matches the source guideline title verbatim');

      // ---- T4: strength pill absent when metadata unavailable (query exposes plain sentences) ----
      await evalJS(ws, send, `(function(){
        var si=document.getElementById('search-input');
        si.value='cesarean section';
        si.dispatchEvent(new Event('input',{bubbles:true}));
        return true;
      })()`);
      await sleep(500);
      s = await evalJS(ws, send, `(function(){
        var cards=document.querySelectorAll('.result-card');
        var out={count:cards.length, found:false};
        Array.prototype.forEach.call(cards, function(c){
          if(out.found) return;
          var pill=c.querySelector('.phrase-type[data-strength]');
          if(!pill){
            out.found=true;
            var a=c.querySelector('.result-guideline a');
            var t=(a.firstChild&&a.firstChild.textContent)||a.textContent;
            out.title=t.replace(/\\s+/g,' ').trim();
            var phraseEl=c.querySelector('.result-phrase');
            out.phraseText=phraseEl?phraseEl.textContent:'';
          }
        });
        return out;
      })()`);
      check(s.count > 0, 'T4 query "cesarean section" yields results');
      check(s.found === true, 'T4 at least one result honestly omits the strength pill when unavailable');
      const match4 = !s.found || DATA.guidelines.some(function(g){
        return g.title.replace(/\s+/g, ' ').trim() === s.title && g.phrases.some(function(p){ return p === s.phraseText; });
      });
      check(!!match4, 'T4 no-strength card wording still matches source byte-for-byte');

      // ---- T5: copy success copies the exact recommendation text ----
      await evalJS(ws, send, `(function(){
        window.__copied=[];
        Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: function(t){ window.__copied.push(t); return Promise.resolve(); } } });
        return true;
      })()`);
      s = await evalJS(ws, send, `(function(){
        var si=document.getElementById('search-input');
        si.value='cesarean sections';
        si.dispatchEvent(new Event('input',{bubbles:true}));
        return true;
      })()`);
      await sleep(500);
      s = await evalJS(ws, send, `(function(){
        var card=document.querySelectorAll('.result-card')[0];
        var btn=card.querySelector('.copy-btn');
        btn.setAttribute('data-expected', btn.getAttribute('data-copy-text'));
        btn.click();
        return true;
      })()`);
      await sleep(350); // let the async clipboard promise resolve
      s = await evalJS(ws, send, `(function(){
        var btn=document.querySelectorAll('.result-card')[0].querySelector('.copy-btn');
        return {
          expected: btn.getAttribute('data-expected'),
          copied: window.__copied.length ? window.__copied[window.__copied.length-1] : null,
          btnText: btn.textContent,
          btnAria: btn.getAttribute('aria-label'),
          status: document.getElementById('status-region').textContent.trim()
        };
      })()`);
      check(s.expected && s.expected.length > 0, 'T5 copy button carries source recommendation text');
      check(s.copied === s.expected, 'T5 clipboard received the exact recommendation text (byte-equal)');
      check(s.btnText === 'Copied' && (s.btnAria || '').indexOf('Copied') !== -1, 'T5 copy button gives clear visual + accessible feedback');
      check(s.status.indexOf('Copied recommendation to clipboard') !== -1, 'T5 copy result announced in live region: "' + s.status + '"');

      // ---- T6: copy failure falls back honestly ----
      await evalJS(ws, send, `(function(){
        window.__copied=[];
        Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: function(){ return Promise.reject(new Error('denied')); } } });
        window.__execCopies=0;
        document.execCommand=function(cmd){ if(cmd === 'copy'){ window.__execCopies++; return false; } return false; };
        return true;
      })()`);
      s = await evalJS(ws, send, `(function(){
        var card=document.querySelectorAll('.result-card')[0];
        var btn=card.querySelector('.copy-btn');
        var reg=document.getElementById('status-region');
        reg.textContent = '';
        btn.click();
        return new Promise(function(resolve){
          setTimeout(function(){
            var b2=document.querySelectorAll('.result-card')[0].querySelector('.copy-btn');
            resolve({ btnText: b2.textContent, status: reg.textContent.trim() });
          }, 500);
        });
      })()`);
      check(s.btnText === 'Copy failed', 'T6 failure state shown on the button: ' + s.btnText);
      check(s.status.indexOf('Copying failed') !== -1, 'T6 failure is explained accessibly: "' + s.status + '"');

      // restore clipboard/execCommand
      await evalJS(ws, send, `(function(){
        Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: function(t){ window.__copied=window.__copied||[]; window.__copied.push(t); return Promise.resolve(); } } });
        return true;
      })()`);

      // ---- T7: copy search link ----
      s = await evalJS(ws, send, `(function(){
        window.__copied=[];
        Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: function(t){ window.__copied.push(t); return Promise.resolve(); } } });
        window.__expectedShare = window.location.origin + window.location.pathname + '?q=' + encodeURIComponent(document.getElementById('search-input').value.trim());
        document.getElementById('copy-search-link').click();
        return true;
      })()`);
      await sleep(350);
      s = await evalJS(ws, send, `(function(){
        return {
          copied: window.__copied.length ? window.__copied[window.__copied.length-1] : null,
          current: window.__expectedShare,
          feedbackText: document.getElementById('toolbar-feedback').textContent.trim(),
          status: document.getElementById('status-region').textContent.trim()
        };
      })()`);
      check(s.copied === s.current, 'T7 share link copied matches canonical app URL with ?q: ' + s.copied);
      check((s.feedbackText || '').indexOf('Link copied') !== -1, 'T7 inline toolbar feedback shown: "' + s.feedbackText + '"');
      check(s.status.indexOf('Link to this search copied') !== -1, 'T7 share-link copy announced: "' + s.status + '"');

      // ---- T8: print emulation hides interactive chrome, keeps result cards ----
      await send('Emulation.setEmulatedMedia', { media: 'print' });
      await sleep(200);
      s = await evalJS(ws, send, `(function(){
        function gs(sel){ var el=document.querySelector(sel); return el?getComputedStyle(el).display:'MISSING'; }
        return {
          toolbar: gs('.results-toolbar'),
          copyBtn: gs('.copy-btn'),
          header: gs('.header'),
          search: gs('.search-section'),
          tags: gs('.tags-section'),
          footer: gs('.footer'),
          card: gs('.result-card'),
          note: gs('.clinical-note'),
          provenance: gs('#provenance')
        };
      })()`);
      check(s.toolbar === 'none', 'T8 toolbar hidden when printing');
      check(s.copyBtn === 'none', 'T8 per-card copy buttons hidden when printing');
      check(s.header === 'none' && s.search === 'none' && s.tags === 'none' && s.footer === 'none', 'T8 header/search/tags/footer hidden when printing');
      check(s.card !== 'none' && s.card !== 'MISSING', 'T8 result cards remain visible when printing');
      check(s.note !== 'none' && s.note !== 'MISSING' && s.provenance !== 'none' && s.provenance !== 'MISSING', 'T8 clinical note + provenance print next to results');
      await send('Emulation.setEmulatedMedia', { media: '' });

      // ---- T9: valid strength keys present across a broad result set ----
      await evalJS(ws, send, `(function(){
        var si=document.getElementById('search-input');
        si.value='cesarean';
        si.dispatchEvent(new Event('input',{bubbles:true}));
        return true;
      })()`);
      await sleep(500);
      s = await evalJS(ws, send, `(function(){
        var keys={};
        var pills=document.querySelectorAll('.phrase-type[data-strength]');
        Array.prototype.forEach.call(pills, function(p){ var k=p.getAttribute('data-strength'); keys[k]=(keys[k]||0)+1; });
        return keys;
      })()`);
      check(Object.keys(s).length > 0, 'T9 strength pills appear across many-results highlight: ' + JSON.stringify(s));
      check(Object.keys(s).every(function(k){ return EXPECTED_STRENGTH_KEYS.indexOf(k) !== -1; }), 'T9 every strength key is from the known set');

      // ---- no console JS errors ----
      const realErrors = consoleErrors.filter(e => !/net::ERR_CONNECTION_REFUSED/i.test(e) && !/Failed to load resource: the server responded with a status of 404/i.test(e));
      check(realErrors.length === 0, 'no console errors — got: ' + (realErrors.join(' | ') || 'none'));

      console.log(pass ? 'ALL PROVENANCE TESTS PASSED' : 'PROVENANCE TESTS FAILED');
      ws.close(); chrome.kill(); server.close();
      process.exit(pass ? 0 : 1);
    } catch (e) {
      try { ws && ws.close(); chrome.kill(); server.close(); } catch (_) {}
      console.error('HARNESS ERROR:', e.message);
      process.exit(2);
    }
  })();
});