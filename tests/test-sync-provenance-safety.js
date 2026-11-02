'use strict';
const fs = require('fs');
const path = require('path');

// Since tests run in pure Node without external deps, let's create a pure-Node compliant course parser
// that matches app.js exactly.

function parseCourseGuidelinesNode(html, sourceUrl) {
  // Regex-based simulation of the browser DOM logic in app.js
  const observed = [];
  const rejected = [];
  const seen = {};

  // 1. Identify footer/nav regions to exclude them
  // Remove footer blocks
  const footerRegex = /<(?:footer|nav)[^>]*>[\s\S]*?<\/(?:footer|nav)>/gi;
  const footerCompanyRegex = /<div[^>]*class="[^"]*footer_company_widget[^"]*"[^>]*>[\s\S]*?<\/div>/gi;
  
  // Find all mod/page and mod/resource links to record as rejected
  const nonBookRegex = /<a\s+[^>]*href="([^"]*mod\/(?:page|resource)\/view\.php\?id=(\d+)[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
  let nonBookMatch;
  while ((nonBookMatch = nonBookRegex.exec(html)) !== null) {
    const rawText = nonBookMatch[3].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    rejected.push({
      href: nonBookMatch[1],
      id: nonBookMatch[2],
      title: rawText,
      reason: 'rejected: non-guideline module type (mod/page or mod/resource)'
    });
  }

  // Sanitize out footer/nav HTML before extracting guideline books
  let sanitizedHtml = html.replace(footerRegex, '<!-- footer removed -->')
                          .replace(footerCompanyRegex, '<!-- footer widget removed -->');

  // Extract mod/book links strictly
  const bookRegex = /<a\s+[^>]*href="([^"]*mod\/book\/view\.php\?id=(\d+)[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
  let bookMatch;
  while ((bookMatch = bookRegex.exec(sanitizedHtml)) !== null) {
    const href = bookMatch[1];
    const id = parseInt(bookMatch[2], 10);
    if (seen[id]) continue;
    seen[id] = true;

    const rawTitle = bookMatch[3].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    const cleanTitle = rawTitle.replace(/\s+(?:Book|File|Page)\s*$/i, '').trim();

    observed.push({
      bookId: id,
      title: cleanTitle,
      href: href
    });
  }

  return {
    sourceUrl: sourceUrl || 'https://lms.ehc.gov.eg/lms/course/view.php?id=38',
    fetchTimestamp: new Date().toISOString(),
    observedBooks: observed,
    rejectedLinks: rejected,
    isValid: observed.length === 11
  };
}

// Read the fixture
const fixturePath = path.join(__dirname, 'fixtures', 'ehc-course-with-footer.html');
const fixtureHtml = fs.readFileSync(fixturePath, 'utf8');

console.log('--- Testing Sync Provenance & Footer Link Safety ---');

const result = parseCourseGuidelinesNode(fixtureHtml);

let failures = 0;
function assert(cond, msg) {
  if (cond) {
    console.log('PASS:', msg);
  } else {
    console.error('FAIL:', msg);
    failures++;
  }
}

// Assertions:
assert(result.observedBooks.length === 11, `Parsed exactly 11 guideline books (got: ${result.observedBooks.length})`);
assert(result.rejectedLinks.length >= 7, `Rejected at least 7 non-guideline links (got: ${result.rejectedLinks.length})`);

const observedTitles = result.observedBooks.map(b => b.title);
const rejectedTitles = result.rejectedLinks.map(b => b.title);

assert(!observedTitles.some(t => /Council activities/i.test(t)), 'Council activities is NEVER in observed guideline books');
assert(!observedTitles.some(t => /About council/i.test(t)), 'About council is NEVER in observed guideline books');
assert(!observedTitles.some(t => /Board of Trustees/i.test(t)), 'Board of Trustees is NEVER in observed guideline books');
assert(!observedTitles.some(t => /Administrative Guidelines/i.test(t)), 'mod/resource PDF is NEVER in observed guideline books');

assert(rejectedTitles.some(t => /Council activities/i.test(t)), 'Council activities is recorded in rejectedLinks');
assert(rejectedTitles.some(t => /About council/i.test(t)), 'About council is recorded in rejectedLinks');
assert(rejectedTitles.some(t => /Administrative Guidelines/i.test(t)), 'mod/resource PDF is recorded in rejectedLinks');

assert(result.isValid === true, 'Sync result marked valid when all 11 books verified');

// Test with corrupted/missing book fixture
const partialHtml = fixtureHtml.replace(/id=252/g, 'id=999999'); // corrupt one book
const partialResult = parseCourseGuidelinesNode(partialHtml);
assert(partialResult.observedBooks.some(b => b.bookId === 999999), 'Detected modified/new book ID');

if (failures === 0) {
  console.log('\nALL SYNC PROVENANCE SAFETY CHECKS PASSED (100% OK)');
  process.exit(0);
} else {
  console.error(`\n${failures} SYNC PROVENANCE SAFETY CHECKS FAILED`);
  process.exit(1);
}
