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

// --- verbatim copies from app.js ---
function normalizeForMatch(str) {
  return String(str).toLowerCase().replace(/ae/g, 'e');
}
function colorizeType(html) {
  return html.replace(/\(([^()]*)\)(\s*\.?)$/, '<span class="phrase-type">($1)</span>$2');
}
function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, function (c) {
    var map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
    return map[c];
  });
}
function escapeRegex(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
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
  var regex = new RegExp('(' + patterns.join('|') + ')', 'gi');
  return escaped.replace(regex, '<mark>$1</mark>');
}
function phraseRelevantTags(phraseText, guidelineTags, searchQuery) {
  var phraseLower = phraseText.toLowerCase();
  var queryLower = (searchQuery || '').toLowerCase();
  var output = [];
  var seen = {};
  if (queryLower) {
    var queryCandidates = [];
    allTags.forEach(function (t) {
      var tl = t.toLowerCase();
      if (tl === queryLower) { queryCandidates.push({ tag: t, pref: 0 }); }
      else if (tl.indexOf(queryLower) !== -1) { queryCandidates.push({ tag: t, pref: 1 }); }
      else if (queryLower.indexOf(tl) !== -1 && tl.length >= 3) { queryCandidates.push({ tag: t, pref: 2 }); }
    });
    queryCandidates.sort(function (a, b) { return a.pref - b.pref; });
    var tagToAdd = queryCandidates.length ? queryCandidates[0].tag : searchQuery;
    output.push(tagToAdd);
    seen[(tagToAdd.toLowerCase().replace(/ae/g, 'e'))] = true;
  }
  var scored = [];
  allTags.forEach(function (tag) {
    var key = tag.toLowerCase();
    var normKey = key.replace(/ae/g, 'e');
    if (seen[normKey]) return;
    var tagWords = key.split(/\s+/).filter(Boolean);
    var meaningful = tagWords.filter(function (w) { return w.length >= 3; });
    if (meaningful.length === 0) return;
    var matches = meaningful.filter(function (w) {
      if (w.length >= 6) return phraseLower.indexOf(w) !== -1;
      return new RegExp('(^|[^A-Za-z])' + w + '($|[^A-Za-z])').test(phraseLower);
    }).length;
    if (matches === meaningful.length) {
      var inGuideline = guidelineTags.some(function (gt) {
        return gt.toLowerCase() === key;
      });
      scored.push({ tag: tag, score: meaningful.length + (inGuideline ? 0.5 : 0) + (meaningful.length > 1 ? 0.2 : 0) });
    }
  });
  scored.sort(function (a, b) { return b.score - a.score || a.tag.localeCompare(b.tag); });
  scored.forEach(function (s) {
    if (output.length < 6) {
      var key = s.tag.toLowerCase().replace(/ae/g, 'e');
      if (!seen[key]) { output.push(s.tag); seen[key] = true; }
    }
  });
  return output;
}
// --- end copies ---

function renderResults(results, query) {
  resultsStats = 'Showing ' + results.length + (results.length === 1 ? ' phrase' : ' phrases') + ' containing all terms: "' + query + '"';
  resultsContainer = results.map(function (item, idx) {
    var displayTags = phraseRelevantTags(item.phrase, item.tags, query);
    return '<article>' +
      '<a href="https://lms.ehc.gov.eg/lms/mod/book/view.php?id=' + item.guidelineBookId + '">' + item.guidelineTitle + '</a>' +
      '<p>' + colorizeType(highlightText(item.phrase, query)) + '</p>' +
      '<div>' + displayTags.map(function (t) { return '<button data-t="' + t + '">' + t + '</button>'; }).join('') + '</div></article>';
  }).join('');
}

['hyper', 'preeclampsia'].forEach(function (q) {
  var words = q.trim().split(/\s+/).filter(Boolean);
  var uniqueWords = [];
  words.forEach(function (w) { var wn = normalizeForMatch(w); if (uniqueWords.indexOf(wn) === -1) uniqueWords.push(wn); });
  var results = allPhrases.filter(function (item) {
    var text = normalizeForMatch(item.phrase);
    return uniqueWords.every(function (w) { return text.indexOf(w) !== -1; });
  });
  try {
    renderResults(results, q);
    console.log(q, 'OK cards=', resultsContainer.length + ' stats="' + resultsStats + '"');
  } catch (e) {
    console.log(q, 'THREW:', e.message);
  }
});

// Simulate a phrase with undefined tags (an ingested live book edge case)
allPhrases.push({ phrase: 'Hyperplasia of the endometrium should be investigated.', guidelineBookId: 'lms-live-999', guidelineTitle: 'Test', tags: undefined });
try {
  renderResults(allPhrases, 'hyper');
  console.log('with-tags-undefined OK');
} catch (e) {
  console.log('with-tags-undefined THREW:', e.message);
}