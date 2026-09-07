'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { appRoot, chromePath, tmpDir } = require('./_helpers');

const APP = appRoot;
const CHROME = chromePath();
const PORT = 8803;
const CDP_PORT = 9245;
const PROF = tmpDir('ehc-shots-prof');
// Snapshots are written to the OS temp dir so they are never committed to the repo.
const OUT = process.env.EHC_SHOTS_DIR ? path.resolve(process.env.EHC_SHOTS_DIR) : tmpDir('ehc-shots');
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

if (!CHROME) { console.error('Chrome/Chromium binary not found. Install Chrome or set CHROME_BIN.'); process.exit(2); }

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8' };
const server = http.createServer((req, res) => {
  const u = req.url.split('?')[0];
  let file = path.join(APP, u === '/' ? 'index.html' : u.replace(/^\//, ''));
  if (!fs.existsSync(file)) { res.writeHead(404); res.end('not found'); return; }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});

server.listen(PORT, () => {
  const chrome = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-sandbox', `--remote-debugging-port=${CDP_PORT}`,
    '--user-data-dir=' + PROF, '--window-size=500,900',
    '--host-resolver-rules=MAP lms.ehc.gov.eg 127.0.0.1:1,MAP fonts.googleapis.com 127.0.0.1:1,MAP fonts.gstatic.com 127.0.0.1:1',
    'about:blank'
  ]);
  chrome.stderr.on('data', () => {});
  setTimeout(async () => {
    try {
      const targets = await fetch(`http://127.0.0.1:${CDP_PORT}/json/new?${encodeURIComponent('about:blank')}`, { method: 'PUT' }).then(r => r.json());
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
      await send('Emulation.setDeviceMetricsOverride', { width: 500, height: 900, deviceScaleFactor: 1, mobile: false });

      for (const w of [320, 375, 390, 768, 1280]) {
        await send('Emulation.setDeviceMetricsOverride', { width: w, height: 900, deviceScaleFactor: 1, mobile: false });
        await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/index.html` });
        await new Promise(r => setTimeout(r, 7000));
        const lm = await send('Page.getLayoutMetrics');
        const cssHeight = Math.round(lm.cssContentSize.height);
        if (cssHeight > 400) {
          await send('Emulation.setDeviceMetricsOverride', { width: w, height: cssHeight, deviceScaleFactor: 1, mobile: false });
          await new Promise(r => setTimeout(r, 600));
        }
        const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
        const file = path.join(OUT, w + '.png');
        fs.writeFileSync(file, Buffer.from(shot.data, 'base64'));
        console.log('saved', w, fs.statSync(file).size + 'b');
      }
      ws.close(); chrome.kill(); server.close();
      process.exit(0);
    } catch (e) {
      try { chrome.kill(); server.close(); } catch (_) {}
      console.error('ERR', e.message); process.exit(1);
    }
  }, 1500);
});