const path = require('path');
const { appRoot } = require('./_helpers');
const d = require(path.join(appRoot, 'guidelines.json'));
let allPhrases = [];
d.guidelines.forEach(g => (g.phrases || []).forEach(p => allPhrases.push({
  phrase: p,
  guidelineBookId: g.bookId,
  guidelineTitle: g.title,
  tags: (g.tags || [])
})));

function normalizeForMatch(str) { return String(str).toLowerCase().replace(/ae/g, 'e'); }
function escapeRegex(str) { return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

function filterByWords(uniqueWords, usePrefix) {
  return allPhrases.filter(function (item) {
    var text = normalizeForMatch(item.phrase);
    return uniqueWords.every(function (w) {
      if (text.indexOf(w) !== -1) return true;
      if (usePrefix && w.length >= 4) {
        return new RegExp('(^|[^a-z])' + escapeRegex(w) + '[a-z]*').test(text);
      }
      return false;
    });
  });
}

function search(query) {
  var q = (query || '').trim().toLowerCase();
  var uniqueWords = [];
  q.split(/\s+/).filter(Boolean).forEach(function (w) {
    var wn = normalizeForMatch(w);
    if (uniqueWords.indexOf(wn) === -1) uniqueWords.push(wn);
  });
  var results = filterByWords(uniqueWords, false);
  var prefix = false;
  if (results.length === 0 && uniqueWords.length === 1 && uniqueWords[0].length >= 4) {
    var prefixed = filterByWords(uniqueWords, true);
    if (prefixed.length) { results = prefixed; prefix = true; }
  }
  console.log(JSON.stringify(q), '->', results.length, 'results' + (prefix ? ' (via prefix)' : ''));
  if (results.length && results.length <= 4) {
    results.slice(0, 3).forEach(r => console.log('   *', r.phrase.slice(0, 90)));
  }
  return results;
}

search('hyper');
search('hyperpla');
search('gestat');
search('hypers');
search('methotrexate');
search('cesarean');
search('preeclamp');
search('metformin');
search('art');

// ensure prefix fallback never triggers for <4 chars
search('hi');