'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { execFile, spawn } = require('child_process');
const { appRoot, chromePath, tmpDir, waitForCdp } = require('./_helpers');

const APP = appRoot;
const CHROME = chromePath();
const PORT = 8801;
const CDP_PORT = 9224;
const PROF = tmpDir('ehc-viewport-prof');

if (!CHROME) { console.error('Chrome/Chromium binary not found. Install Chrome or set CHROME_BIN.'); process.exit(2); }

const HARNESS = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
body{margin:0;font-family:Arial,sans-serif;font-size:11px;background:#f0f0f0}
.row{display:block;margin:0 0 14px;border:1px solid #888;background:#fff}
.row .cap{font-weight:bold;padding:3px 8px;background:#e8e8e8}
iframe{display:block;border:0;background:#fff}
pre{padding:10px;background:#222;color:#0f0}
</style></head><body>
<div id="rows"></div>
<pre id="out"></pre>
<script>
var WIDTHS=[320,375,390,768,1280];
var results=[];
window.__err=[];
window.addEventListener('error',function(e){window.__err.push(e.message);});
function addRow(w,h){var row=document.createElement('div');row.className='row';
row.innerHTML='<div class="cap">'+w+'px</div>';
var f=document.createElement('iframe');f.width=w;f.height=h;f.style.width=w+'px';f.style.height=h+'px';
f.src='/index.html';f.setAttribute('data-w',w);row.appendChild(f);
document.getElementById('rows').appendChild(row);return f;}
function sleep(ms){return new Promise(function(r){setTimeout(r,ms);});}
async function runWidth(iframe){
  var wd=null,out={};
  var w=parseInt(iframe.getAttribute('data-w'),10);out.width=w;
  var start=Date.now();
  while(Date.now()-start<20000){
    try{wd=iframe.contentWindow.document;
      if(wd&&wd.querySelectorAll('#tags-container .tag-btn').length>0)break;}
    catch(e){window.__err.push('poll:'+e.message);break;}
    await sleep(60);
  }
  if(!wd){out.error='iframe not loaded';return out;}
  var cdw=iframe.contentDocument;
  var de=cdw.documentElement, bd=cdw.body;
  out.scrollW=de.scrollWidth;out.clientW=de.clientWidth;
  out.noHOverflow=de.scrollWidth<=de.clientWidth+1&&bd.scrollWidth<=bd.clientWidth+1;
  var hc=cdw.querySelector('.header-center'),hi=cdw.querySelector('.header-info'),h1=cdw.querySelector('.header-info h1');
  out.headerInfoBelowTitle=!!(hi&&hc&&hi.getBoundingClientRect().top>=hc.getBoundingClientRect().bottom-1);
  var h1s = cdw.defaultView.getComputedStyle(h1);
  var h1Pos = h1s.position;
  out.h1VisuallyHidden = h1Pos === 'absolute';
  out.h1Clipped = h1Pos !== 'absolute' && h1.scrollWidth > h1.clientWidth + 1;
  var tog=cdw.querySelector('#tags-toggle'),tc=cdw.querySelector('#tags-container');
  out.toggleVisible=!!(tog&&cdw.defaultView.getComputedStyle(tog).display!=='none');
  out.tagsCollapsedInitial=!!(tc&&parseFloat(cdw.defaultView.getComputedStyle(tc).maxHeight)===0);
  var btn=cdw.querySelector('.tag-btn');
  out.tagBtnH=btn?Math.round(btn.getBoundingClientRect().height):null;
  var si=cdw.getElementById('search-input'),cb=cdw.getElementById('clear-search');
  if(si){si.value='preeclampsia';si.dispatchEvent(new Event('input',{bubbles:true}));}
  if(cb){out.clearBtnVisible=cb.hidden===false;out.clearBtnH=Math.round(cb.getBoundingClientRect().height);}
  var rt0=cdw.querySelector('.result-tag');
  if(!rt0){await sleep(120);rt0=cdw.querySelector('.result-tag');}
  out.resultTagH=rt0?Math.round(rt0.getBoundingClientRect().height):null;
  if(w<=640){
    if(tog){tog.click();await sleep(200);}
    out.tagsOpen=!!(tc&&cdw.defaultView.getComputedStyle(tc).overflow!=='hidden');
    var tsi=iframe.contentWindow;
    tsi.scrollTo(0,1400);
    await sleep(300);
    var ss=cdw.querySelector('.search-section');
    var r=ss.getBoundingClientRect();
    out.scrollY=tsi.scrollY;out.searchTop=Math.round(r.top);
    out.stickySearch=Math.abs(r.top)<2;
  }
  return out;
}
(async function(){
  try{
    var iframes=[];
    for(var i=0;i<WIDTHS.length;i++){iframes.push(addRow(WIDTHS[i],WIDTHS[i]<=640?600:900));}
    for(var j=0;j<iframes.length;j++){results.push(await runWidth(iframes[j]));}
    document.body.dataset.result=JSON.stringify(results);
    document.getElementById('out').textContent='RESULT READY';
  }catch(e){window.__err.push('top:'+e.message);document.body.dataset.result='ERR:'+window.__err.join(';');}
})();
</script></body></html>`;

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8' };

const server = http.createServer((req, res) => {
  const u = req.url.split('?')[0];
  if (u === '/check2.html') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(HARNESS); return; }
  let file = path.join(APP, u === '/' ? 'index.html' : u.replace(/^\//, ''));
  if (!fs.existsSync(file)) { res.writeHead(404); res.end('not found'); return; }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});

server.listen(PORT, () => {
  const chrome = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-sandbox', `--remote-debugging-port=${CDP_PORT}`,
    '--user-data-dir=' + PROF, '--window-size=1280,1200',
    '--host-resolver-rules=MAP lms.ehc.gov.eg 127.0.0.1:1,MAP fonts.googleapis.com 127.0.0.1:1,MAP fonts.gstatic.com 127.0.0.1:1',
    'about:blank'
  ]);
  chrome.stderr.on('data', (d) => { if (process.env.CDP_VERBOSE) process.stderr.write(d); });

  (async () => {
    try {
      await waitForCdp(CDP_PORT);
      const targets = await fetch(`http://127.0.0.1:${CDP_PORT}/json/new?${encodeURIComponent('http://127.0.0.1:' + PORT + '/check2.html')}`, { method: 'PUT' }).then(r => r.json());
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
      await new Promise(r => setTimeout(r, 25000));
      const expr = `(function(){var d=document.body.dataset.result;if(d)return d;return 'PENDING:'+(window.__err?window.__err.join(';'):'')})()`;
      let result = null;
      for (let i = 0; i < 40; i++) {
        const res = await send('Runtime.evaluate', { expression: expr, returnByValue: true });
        const v = res && res.result && res.result.value;
        if (v && !v.startsWith('PENDING')) { result = v; break; }
        await new Promise(r => setTimeout(r, 500));
      }
      ws.close();
      chrome.kill();
      server.close();
      if (!result) { console.error('NO RESULT'); process.exit(2); }
      if (result.startsWith('ERR:')) { console.error(result); process.exit(3); }
      const rows = JSON.parse(result);
      let pass = true;
      for (const r of rows) {
        const problems = [];
        if (r.error) problems.push('LOAD ERROR ' + r.error);
        if (!r.noHOverflow) problems.push('HORIZONTAL OVERFLOW scrollW=' + r.scrollW + ' clientW=' + r.clientW);
        if (!r.headerInfoBelowTitle && r.width <= 640) problems.push('source row not below title row');
        if (r.width === 320 && r.h1Clipped) problems.push('h1 clipped at 320');
        if (r.toggleVisible !== true && r.width <= 640) problems.push('tags toggle not visible');
        if (r.tagsCollapsedInitial !== true && r.width <= 640) problems.push('tags not collapsed on mobile');
        if (r.tagsOpen !== true && r.width <= 640) problems.push('tags not expandable on mobile');
        if (r.stickySearch !== true && r.width <= 640) problems.push('search not sticky on mobile');
        if (r.tagBtnH !== null && r.tagBtnH < 44) problems.push('tag-btn too small ' + r.tagBtnH + 'px');
        if (r.clearBtnH !== null && r.clearBtnH < 44 && r.width <= 640) problems.push('clear-btn too small ' + r.clearBtnH + 'px');
        if (r.resultTagH !== null && r.resultTagH < 40 && r.width <= 640) problems.push('result-tag too small ' + r.resultTagH + 'px');
        if (r.h1Clipped === true && r.width > 640 && r.width <= 1024) problems.push('h1 still nowrap/clip at ' + r.width);
        const status = problems.length ? 'FAIL' : 'OK';
        if (problems.length) pass = false;
        console.log('[' + r.width + 'px] ' + status + (problems.length ? ' -> ' + problems.join('; ') : ''));
        if (problems.length) console.log('   ' + JSON.stringify(r));
      }
      console.log(pass ? 'ALL VIEWPORT CHECKS PASSED' : 'VIEWPORT CHECKS FAILED');
      process.exit(pass ? 0 : 1);
    } catch (e) {
      try { chrome.kill(); server.close(); } catch (_) {}
      console.error('CDP ERROR', e.message);
      process.exit(4);
    }
  })();
});