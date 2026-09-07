const path = require('path');
const { appRoot } = require('./_helpers');
const d = require(path.join(appRoot, 'guidelines.json'));
const allTags = d.allTags;
let allPhrases = [];
d.guidelines.forEach(g => (g.phrases || []).forEach(p => allPhrases.push({
  phrase: p,
  guidelineBookId: g.bookId,
  guidelineTitle: g.title,
  tags: (g.tags || [])
})));

function normalizeForMatch(str) { return String(str).toLowerCase().replace(/ae/g, 'e'); }
function escapeHtml(str) { return String(str).replace(/[&<>"']/g, function (c) { var map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }; return map[c]; }); }
function escapeRegex(str) { return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function colorizeType(html) { return html.replace(/\(([^()]*)\)(\s*\.?)$/, '<span class="phrase-type">($1)</span>$2'); }

function highlightText(text, query) {
  var escaped = escapeHtml(text);
  if (!query) return escaped;
  var rawWords = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!rawWords.length) return escaped;
  var patterns = [];
  function pushPattern(p) { if (patterns.indexOf(p) === -1) patterns.push(p); }
  if (rawWords.length > 1) {
    pushPattern(escapeRegex(query.trim()));
    if (query.indexOf('ae') !== -1) pushPattern(escapeRegex(query.trim().replace(/ae/g, 'e')));
  }
  rawWords.forEach(function (w) {
    pushPattern(escapeRegex(w));
    if (w.indexOf('ae') !== -1) pushPattern(escapeRegex(w.replace(/ae/g, 'e')));
    else if (w.indexOf('e') !== -1) pushPattern(escapeRegex(w.replace('e', 'ae')));
  });
  // the rest omitted in this minimal harness
  return escaped;
}

function performSearch(query) {
  var q = (query || '').trim().toLowerCase();
  var words = q.split(/\s+/).filter(Boolean);
  var uniqueWords = [];
  words.forEach(function (w) {
    var wn = normalizeForMatch(w);
    if (uniqueWords.indexOf(wn) === -1) uniqueWords.push(wn);
  });
  var results = allPhrases.filter(function (item) {
    var text = normalizeForMatch(item.phrase);
    return uniqueWords.every(function (w) { return text.indexOf(w) !== -1; });
  });
  console.log('query:', JSON.stringify(q), '->', results.length, 'results');
  return results;
}

['hyper', 'hyperplasia', 'hyperemesis', 'preeclampsia', 'magnesium'].forEach(performSearch);