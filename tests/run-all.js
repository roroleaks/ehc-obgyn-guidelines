'use strict';
// Sequential QA harness runner.
// Runs every harness listed below in one Node process chain so CI and local runs
// share identical behavior. Each harness is spawned with `node <file>` from this
// directory (tests/), output is replayed to the console, and any non-zero exit,
// missing success marker, or "FAIL" output line fails the overall run.
// No third-party dependencies are required — only Node built-ins.
const { spawnSync } = require('child_process');
const path = require('path');

const HARNESSES = [
  // Node-only simulations / data checks (fast, no browser).
  { file: 'test-highlight.js' },
  { file: 'test-tags-click.js' },
  { file: 'test-search.js' },
  { file: 'test-prefix.js' },
  { file: 'test-render.js' },
  { file: 'test-all-phrases.js', required: [/Issues: 0\b/] },
  { file: 'test-search4.js', markers: ['ALL SEARCH4 ASSERTIONS PASSED'] },
  { file: 'test-sync.js', noFailLines: true },
  // Browser (CDP) harnesses — self-start a local HTTP server + headless Chrome.
  { file: 'viewport-cdp.js', markers: ['ALL VIEWPORT CHECKS PASSED'] },
  { file: 'viewport-shots-cdp.js' },
  { file: 'a11y-test.js', markers: ['ALL A11Y CHECKS PASSED'] },
  { file: 'search-state-test.js', markers: ['ALL SEARCH-STATE TESTS PASSED'] },
  { file: 'test-provenance.js', markers: ['ALL PROVENANCE TESTS PASSED'] },
  { file: 'qa-final.js', markers: ['ALL PRODUCTION QA CHECKS PASSED'] }
];

// Per-harness cap (ms). Browser suite workflows can be slow on cold start.
const DEFAULT_TIMEOUT = 300000;

function runHarness(h) {
  const started = Date.now();
  const res = spawnSync(process.execPath, [h.file], {
    cwd: __dirname,
    encoding: 'utf8',
    timeout: h.timeoutMs || DEFAULT_TIMEOUT,
    windowsHide: true
  });
  process.stdout.write(res.stdout || '');
  process.stderr.write(res.stderr || '');

  const combined = (res.stdout || '') + (res.stderr || '');
  const reasons = [];
  if (res.error) {
    reasons.push(res.error.code === 'ETIMEDOUT' ? 'timed out' : res.error.message);
  } else if (res.status !== 0) {
    reasons.push('exit code ' + res.status);
  }
  if (h.noFailLines && /\bFAIL\b/m.test(combined)) {
    reasons.push('FAIL line(s) in output');
  }
  for (const m of h.markers || []) {
    if (combined.indexOf(m) === -1) reasons.push('missing marker "' + m + '"');
  }
  for (const r of h.required || []) {
    if (!r.test(combined)) reasons.push('no match for /' + r.source + '/');
  }

  const secs = ((Date.now() - started) / 1000).toFixed(1);
  if (reasons.length) {
    console.log('== FAIL: ' + h.file + ' [' + secs + 's] — ' + reasons.join('; '));
    return { file: h.file, ok: false };
  }
  console.log('== PASS: ' + h.file + ' [' + secs + 's]');
  return { file: h.file, ok: true };
}

function run(list) {
  const results = (list || HARNESSES).map(runHarness);
  const failed = results.filter(r => !r.ok);
  if (failed.length) {
    console.log('\nFAILED harnesses: ' + failed.map(f => f.file).join(', '));
    return 1;
  }
  console.log('\nALL QA HARNESSES PASSED (' + results.length + '/' + results.length + ')');
  return 0;
}

module.exports = { run, HARNESSES };

if (require.main === module) {
  // Self-test hook (used by CI validation): verifies a deliberately failing
  // harness yields a non-zero exit code.
  if (process.env.EHC_RUNNER_SELFTEST) {
    process.exit(run([{ file: '__fixture_failing__', markers: ['impossible marker'] }]));
  }
  process.exit(run(HARNESSES));
}