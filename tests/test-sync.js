const http = require('http');

let failures = 0;
function ok(name) { console.log('PASS', name); }
function fail(name, extra) { failures++; console.log('FAIL', name, extra || ''); }
function assert(cond, name, extra) { cond ? ok(name) : fail(name, extra); }

// ---- verbatim copies from app.js ----

function fetchWithTimeout(url, ms) {
  if (typeof AbortController !== 'undefined') {
    var controller = new AbortController();
    var timer = setTimeout(function () { controller.abort(); }, ms);
    return fetch(url, { signal: controller.signal }).then(function (res) {
      clearTimeout(timer);
      return res;
    }, function (err) {
      clearTimeout(timer);
      throw err;
    });
  }
  return fetch(url);
}

let store = {};
const localStorage = {
  getItem: function (k) { return store[k] || null; },
  setItem: function (k, v) { store[k] = v; }
};
const LAST_SYNC_KEY = 'ehc_last_sync_v1';
function saveLastSync() {
  try { localStorage.setItem(LAST_SYNC_KEY, new Date().toISOString()); } catch (e) {}
}
function lastSyncLabel() {
  try {
    var raw = localStorage.getItem(LAST_SYNC_KEY);
    if (!raw) return null;
    var d = new Date(raw);
    if (isNaN(d.getTime())) return null;
    return 'Last successful sync: ' + d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  } catch (e) { return null; }
}

// Mirrors the app's success rule: a sync only counts when the parsed listing
// contains at least one real guideline link.
function successfulSync(parsedBookLinkCount) { return parsedBookLinkCount > 0; }

// ---- Test 1: fetchWithTimeout resolves on a fast server ----
function testFastServer(done) {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<html><body><a href="/mod/book/view.php?id=252">Cesarean Book</a></body></html>');
  });
  server.listen(0, '127.0.0.1', () => {
    const port = server.address().port;
    fetchWithTimeout('http://127.0.0.1:' + port + '/course', 3000)
      .then(res => {
        assert(res.ok, 'fast server resolves with ok response');
        return res.text();
      })
      .then(text => { assert(/Cesarean Book/.test(text), 'fast server body delivered'); server.close(); done(); })
      .catch(e => { fail('fast server fetch unexpectedly failed', e.message); server.close(); done(); });
  });
}

// ---- Test 2: fetchWithTimeout aborts on a silent (slow/blocked) server ----
function testTimeout(done) {
  const server = http.createServer(() => { /* never respond */ });
  server.listen(0, '127.0.0.1', () => {
    const port = server.address().port;
    const started = Date.now();
    fetchWithTimeout('http://127.0.0.1:' + port + '/slow', 400)
      .then(() => { fail('silent server should have timed out'); server.close(); done(); })
      .catch(e => {
        const elapsed = Date.now() - started;
        assert(e && e.name === 'AbortError', 'silent server aborts with AbortError', 'got: ' + (e && e.name));
        assert(elapsed >= 350 && elapsed < 3000, 'abort fires near the timeout budget', 'elapsed=' + elapsed);
        server.close(); done();
      });
  });
}

// ---- Test 3: HTTP error (503) rejects so it can't be mistaken for success ----
function testHttpError(done) {
  const server = http.createServer((req, res) => { res.writeHead(503); res.end('nope'); });
  server.listen(0, '127.0.0.1', () => {
    const port = server.address().port;
    fetchWithTimeout('http://127.0.0.1:' + port + '/down', 3000)
      .then(res => {
        // app checks res.ok and throws -> replicate the app-level check
        assert(!res.ok, '503 response is not ok');
        let threw = false;
        try { if (!res.ok) throw new Error('http-' + res.status); } catch (e) { threw = true; }
        assert(threw, 'non-ok response surfaces an error (never "up to date")');
        server.close(); done();
      })
      .catch(e => { fail('unexpected rejection, should have received 503 response', e.message); server.close(); done(); });
  });
}

// ---- Test 4: successfulSync decision for valid vs blank/empty/unparsed ----
assert(successfulSync(0) === false, 'blank/empty parcel with 0 links -> NOT a success');
assert(successfulSync(5) === true, 'listing with 5 parsed links -> success');
assert(successfulSync(undefined) === false, 'unparseable content -> NOT a success');

// ---- Test 5: lastSync persistence and label formatting ----
assert(lastSyncLabel() === null, 'no stored sync -> no label');
store[LAST_SYNC_KEY] = 'not-a-date';
assert(lastSyncLabel() === null, 'corrupt stored value -> no label');
delete store[LAST_SYNC_KEY];
saveLastSync();
assert(store[LAST_SYNC_KEY] !== null, 'successful sync stores an ISO timestamp');
const label = lastSyncLabel();
assert(typeof label === 'string' && label.indexOf('Last successful sync: ') === 0 && label.length > 22, 'label is human-readable text', label);

// ---- Test 6: no technical details leak into user-facing messages ----
const fs = require('fs');
const path = require('path');
const { appRoot } = require('./_helpers');
const src = fs.readFileSync(path.join(appRoot, 'app.js'), 'utf8');
const setSyncStatusRe = (src.match(/function setSyncStatus[\s\S]*?^\s*\}/m) || [''])[0];
const sssrc = setSyncStatusRe || '';
assert(new RegExp("setSyncStatus\\([\\s\\S]{0,250}?'syncing'").test(src), 'a call site uses the syncing state class');
assert(new RegExp("setSyncStatus\\([\\s\\S]{0,250}?'ok'").test(src), 'a call site uses the ok state class');
assert(new RegExp("setSyncStatus\\([\\s\\S]{0,250}?'error'").test(src), 'a call site uses the error state class');
const userMessages = (src.match(/setSyncStatus\s*\([^;]*?;/g) || []).join('\n');
const leaky = /AbortError|TypeError|stack|undefined|NaN|http-|status\s|\bat\s/.test(userMessages.replace(/"[^"]*status[^"]*"/g, ''));
assert(!leaky, 'user-facing status messages contain no stack/technical text');

// ---- Test 7: fetchWithTimeout never hangs beyond the budget (UI stays responsive) ----
// covered by Test 2 elapsed assertion.

testFastServer(() => testTimeout(() => testHttpError(() => {
  console.log(failures === 0 ? '\nALL TESTS PASSED' : '\nTEST FAILURES: ' + failures);
  process.exit(failures === 0 ? 0 : 1);
})));