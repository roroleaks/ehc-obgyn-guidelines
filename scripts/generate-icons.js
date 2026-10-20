'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { appRoot, chromePath, waitForCdp, tmpDir } = require('../tests/_helpers');

const APP = appRoot;
const CHROME = chromePath();
const PORT = 8844;
const CDP_PORT = 9288;
const PROF = tmpDir('ehc-icon-prof');

const SIZES = [
  { name: 'icon-512.png', size: 512 },
  { name: 'icon-192.png', size: 192 },
  { name: 'apple-touch-icon.png', size: 180 },
  { name: 'favicon-32x32.png', size: 32 },
  { name: 'favicon-16x16.png', size: 16 }
];

const server = http.createServer((req, res) => {
  const u = req.url.split('?')[0];
  let file = path.join(APP, u === '/' ? 'index.html' : u.replace(/^\//, ''));
  if (!fs.existsSync(file)) { res.writeHead(404); res.end('not found'); return; }
  res.writeHead(200, { 'Content-Type': 'image/jpeg' });
  fs.createReadStream(file).pipe(res);
});

server.listen(PORT, async () => {
  const chrome = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-sandbox', `--remote-debugging-port=${CDP_PORT}`,
    '--user-data-dir=' + PROF, 'about:blank'
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

    const imgB64 = fs.readFileSync(path.join(APP, 'app-icon.jpg')).toString('base64');
    const html = `<!DOCTYPE html><html><body><img id="src" src="data:image/jpeg;base64,${imgB64}"><canvas id="c"></canvas></body></html>`;
    await send('Page.navigate', { url: 'data:text/html;charset=utf-8,' + encodeURIComponent(html) });
    await new Promise(r => setTimeout(r, 2000));

    for (const item of SIZES) {
      const expr = `(function(){
        const img = document.getElementById('src');
        const c = document.getElementById('c');
        c.width = ${item.size};
        c.height = ${item.size};
        const ctx = c.getContext('2d');
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.clearRect(0, 0, ${item.size}, ${item.size});
        ctx.drawImage(img, 0, 0, ${item.size}, ${item.size});
        return c.toDataURL('image/png').split(',')[1];
      })()`;
      const res = await send('Runtime.evaluate', { expression: expr, returnByValue: true });
      const b64 = res && res.result && res.result.value;
      if (b64) {
        const outPath = path.join(APP, item.name);
        fs.writeFileSync(outPath, Buffer.from(b64, 'base64'));
        console.log('Generated', item.name, 'size:', fs.statSync(outPath).size, 'bytes');
      } else {
        console.error('Failed to generate', item.name);
      }
    }

    ws.close(); chrome.kill(); server.close();
    process.exit(0);
  } catch (err) {
    console.error(err);
    try { chrome.kill(); server.close(); } catch (_) {}
    process.exit(1);
  }
});
