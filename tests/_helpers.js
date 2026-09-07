'use strict';
// Shared portable config for the QA harnesses so they run from a clean checkout
// on any OS (CI included) without local-only absolute paths.
//   - appRoot: the repository root (where index.html / app.js / guidelines.json live)
//   - chromePath(): resolves a Chrome/Chromium binary, honoring CHROME_BIN first
//   - tmpDir(name): a per-test scratch dir under the OS temp folder
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawnSync } = require('child_process');

const appRoot = path.join(__dirname, '..');

function chromePath() {
  if (process.env.CHROME_BIN && fs.existsSync(process.env.CHROME_BIN)) {
    return process.env.CHROME_BIN;
  }
  const candidates = {
    linux: [
      '/usr/bin/google-chrome',
      '/usr/bin/google-chrome-stable',
      '/usr/bin/chromium',
      '/usr/bin/chromium-browser',
      '/snap/bin/chromium'
    ],
    darwin: [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Chromium.app/Contents/MacOS/Chromium'
    ],
    win32: [
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files\\Chromium\\Application\\chrome.exe',
      'C:\\Users\\' + process.env.USERNAME + '\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe'
    ]
  };
  const list = candidates[process.platform] || [];
  for (const c of list) {
    if (c && fs.existsSync(c)) return c;
  }
  // Fall back to PATH lookup.
  const probe = spawnSync(
    process.platform === 'win32' ? 'where.exe' : 'which',
    ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'chrome'],
    { shell: process.platform === 'win32', windowsHide: true }
  );
  if (probe.status === 0 && probe.stdout) {
    const first = String(probe.stdout).split(/\r?\n/)[0].trim();
    if (first && fs.existsSync(first)) return first;
  }
  return null;
}

function tmpDir(name) {
  return path.join(os.tmpdir(), name);
}

// Polls the Chrome DevTools endpoint until it accepts connections (then an
// optional extra settle delay). Replaces fixed-delay bootstraps that race on
// cold starts (notably CI runners where the first Chrome spawn is slow).
async function waitForCdp(cdpPort, extraMs = 0, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch('http://127.0.0.1:' + cdpPort + '/json/version');
      if (r.ok) {
        if (extraMs) await new Promise(res => setTimeout(res, extraMs));
        return;
      }
    } catch (_) { /* port not open yet */ }
    await new Promise(res => setTimeout(res, 250));
  }
  throw new Error('CDP endpoint on port ' + cdpPort + ' did not become ready within ' + timeoutMs + 'ms');
}

module.exports = { appRoot, chromePath, tmpDir, waitForCdp };
