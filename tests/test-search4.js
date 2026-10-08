// Simulation of the Prompt 4 search algorithm (copied to mirror app.js exactly).
const path = require('path');
const { appRoot } = require('./_helpers');
const d = require(path.join(appRoot, 'guidelines.json'));
let allPhrases = [];
d.guidelines.forEach(g => (g.phrases || []).forEach(p => allPhrases.push({
  phrase: p, guidelineBookId: g.bookId, guidelineTitle: g.title, tags: (g.tags || [])
})));

const VARIANT_MAP = {
  caesarean: 'cesarean', csection: 'c-section',
  haemorrhage: 'hemorrhage', oedema: 'edema', anaemia: 'anemia',
  labour: 'labor', foetal: 'fetal', neonatal: 'newborn',
  sulphate: 'sulfate', bpd: 'biparietal diameter',
  pph: 'postpartum hemorrhage', mgso4: 'magnesium',
  mtx: 'methotrexate', txa: 'tranexamic acid',
  tvus: 'transvaginal ultrasound', lmwh: 'low molecular weight heparin',
  ctg: 'cardiotocography', gdm: 'gestational diabetes',
  vbac: 'vaginal birth after cesarean', tolac: 'trial of labor after cesarean',
  iud: 'intrauterine device', iugr: 'intrauterine growth restriction', fgr: 'fetal growth restriction',
  ivg: 'intravenous glucose', im: 'intramuscular',
  iu: 'international units', mcg: 'micrograms', hctz: 'hydrochlorothiazide',
  dilation: 'dilatation', dilatation: 'dilation'
};

function normalizeForMatch(str) { return String(str).toLowerCase().replace(/ae/g, 'e').replace(/oe/g, 'e'); }

let _variantSet = null;
function buildVariantSet() {
  if (_variantSet) return _variantSet;
  _variantSet = Object.create(null);
  Object.keys(VARIANT_MAP).forEach(function(k) {
    _variantSet[normalizeForMatch(k)] = true;
    _variantSet[normalizeForMatch(VARIANT_MAP[k])] = true;
  });
  return _variantSet;
}

function variantifyQuery(word) {
  var variants = [word];
  Object.keys(VARIANT_MAP).forEach(function(k) {
    if (normalizeForMatch(k) === word) variants.push(normalizeForMatch(VARIANT_MAP[k]));
    if (normalizeForMatch(VARIANT_MAP[k]) === word) variants.push(normalizeForMatch(k));
  });
  return variants;
}

function stripTrailingS(w) {
  if (w.length <= 2) return [w];
  var forms = [w];
  function add(f) { if (f && f.length >= 2 && forms.indexOf(f) === -1) forms.push(f); }

  if (w.slice(-1) === 's') {
    if (w.slice(-3) === 'ies' && w.length > 3) {
      add(w.slice(0, -3) + 'y');
    } else if (w.slice(-2) === 'es' && w.length > 3) {
      add(w.slice(0, -2));
      add(w.slice(0, -1));
    } else {
      add(w.slice(0, -1));
    }
  } else if (w.slice(-1) === 'y' && !/[aeiou]y$/.test(w)) {
    add(w.slice(0, -1) + 'ies');
  } else {
    add(w + 's');
    if (/(?:[sxz]|[sc]h)$/.test(w)) {
      add(w + 'es');
    }
  }
  return forms;
}

function wordForms(w) {
  var forms = [];
  function push(f) { if (forms.indexOf(f) === -1) forms.push(f); }
  variantifyQuery(w).forEach(push);
  stripTrailingS(w).forEach(push);
  return forms;
}
function phraseHasWordSubstring(phraseNorm, w) { return wordForms(w).some(f => phraseNorm.indexOf(f) !== -1); }
function phraseHasWordWhole(phraseNorm, w) {
  return wordForms(w).some(f => new RegExp('(^|[^a-z])' + f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '($|[^a-z])').test(phraseNorm));
}
function classifyResults(results, qWords) {
  var exact = 0, related = 0;
  results.forEach(function(item) {
    var pn = normalizeForMatch(item.phrase);
    if (qWords.every(w => phraseHasWordWhole(pn, w))) exact++;
    else related++;
  });
  return { exact: exact, prefix: 0, related: related };
}
function findVariantSuggestion(query) {
  var words = query.split(/\s+/).filter(Boolean);
  var vs = buildVariantSet();
  var suggestion = null;
  words.some(function(w) {
    var variants = variantifyQuery(w);
    return variants.some(function(v) { if (v !== w && vs[v]) { suggestion = { from: w, to: v }; return true; } return false; });
  });
  return suggestion;
}

function filterByWords(uniqueWords, usePrefix) {
  if (!uniqueWords.length) return [];
  return allPhrases.filter(function(item) {
    var text = normalizeForMatch(item.phrase);
    return uniqueWords.every(function(w) {
      if (phraseHasWordSubstring(text, w)) return true;
      if (usePrefix && w.length >= 4) return new RegExp('(^|[^a-z])' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[a-z]*').test(text);
      return false;
    });
  });
}

function scoreMedicalExpression(phraseText, qWords) {
  if (!qWords || qWords.length <= 1) return 0;
  var norm = normalizeForMatch(phraseText);
  var formLists = qWords.map(wordForms);
  if (qWords.length === 2) {
    var p1 = '(?:' + formLists[0].map(f => f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')';
    var p2 = '(?:' + formLists[1].map(f => f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')';
    var exactAdjacent = new RegExp('(^|[^a-z])' + p1 + '[\\s\\-]+' + p2 + '($|[^a-z])');
    if (exactAdjacent.test(norm)) return 1000;
    var nearAdjacent = new RegExp('(^|[^a-z])' + p1 + '[\\s\\-]+(?:and|or|of|in|to|the)?\\s*' + p2 + '($|[^a-z])');
    if (nearAdjacent.test(norm)) return 500;
  } else if (qWords.length > 2) {
    var parts = formLists.map(list => '(?:' + list.map(f => f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')');
    var exactMulti = new RegExp('(^|[^a-z])' + parts.join('[\\s\\-]+') + '($|[^a-z])');
    if (exactMulti.test(norm)) return 1000;
  }
  var allWhole = qWords.every(w => phraseHasWordWhole(norm, w));
  if (allWhole) return 100;
  return 10;
}

function performSearch(query) {
  var q = (query || '').trim().toLowerCase();
  if (!q) return { query: q, showInitial: true, results: [], isPrefix: false, classification: { exact: 0, prefix: 0, related: 0 }, suggestion: null };
  var uniqueWords = [];
  q.split(/\s+/).filter(Boolean).forEach(function(w) {
    var wn = normalizeForMatch(w);
    if (uniqueWords.indexOf(wn) === -1) uniqueWords.push(wn);
  });
  var results = filterByWords(uniqueWords, false);
  if (uniqueWords.length > 1) {
    results.sort(function(a, b) {
      var sa = scoreMedicalExpression(a.phrase, uniqueWords);
      var sb = scoreMedicalExpression(b.phrase, uniqueWords);
      return sb - sa;
    });
  }
  var classification = classifyResults(results, uniqueWords);
  var isPrefix = false;
  if (results.length === 0 && uniqueWords.length === 1 && uniqueWords[0].length >= 4) {
    var prefixed = filterByWords(uniqueWords, true);
    if (prefixed.length) { results = prefixed; isPrefix = true; classification = { exact: 0, prefix: prefixed.length, related: 0 }; }
  }
  return { query: q, showInitial: false, results: results, isPrefix: isPrefix, classification: classification, suggestion: findVariantSuggestion(q) };
}

function report(label, s, printSamples) {
  console.log(label + ' => count=' + s.results.length + ' prefix=' + s.isPrefix + ' exact=' + s.classification.exact + ' related=' + s.classification.related + ' suggestion=' + (s.suggestion ? s.suggestion.from + '->' + s.suggestion.to : 'none'));
  if (printSamples) s.results.slice(0, 2).forEach(r => console.log('   *', r.phrase.slice(0, 100)));
}

// 1 exact
report('exact preeclampsia', performSearch('preeclampsia'));
// 2 partial (prefix)
report('partial preeclamp', performSearch('preeclamp'));
// 3 prefix via whole-word boundary — art should NOT match "labor"/"partum"
report('short art (whole-word)', performSearch('art'));
// 4 multi-word AND
report('multi preeclampsia + magnesium', performSearch('preeclampsia magnesium'));
// 5 uppercase mixed
report('uppercase PreeClampSia', performSearch('PreeClampSia'));
// 6 British->American variant
report('variant caesarean', performSearch('caesarean'));
// 7 American->British allows caesarean text? the data contains "cesarean"; test reverse typing
report('variant cesarean (text has cesarean)', performSearch('cesarean'));
// 8 singular/plural
report('plural cesarean sections', performSearch('cesarean sections'));
report('singular cesarean section', performSearch('cesarean section'));
// 9 haemorrhage/hemorrhage
report('haemorrhage', performSearch('haemorrhage'));
// 10 nonsense
report('nonsense zzzq9', performSearch('zzzq9notaword'));
// 11 empty
report('empty', performSearch('   '));
// 12 HTML-like input (must be 0, never execute)
report('html <script>alert(1)</script>', performSearch('<script>alert(1)</script>'));
// 13 special chars
report('specials pre,*', performSearch('pree,*'));
// 14 prefix finds gestational
report('prefix gestat', performSearch('gestat'));
// 15 multi-word that only partially matches - confirm AND behavior reduces
report('multi partial preeclampsia zzz', performSearch('preeclampsia zzz'));

// ---- assertions ----
const assert = require('assert');
assert.strictEqual(performSearch('preeclampsia').results.length, 23, 'preeclampsia should be 23');
assert.ok(performSearch('preeclamp').results.length > 0, 'preeclamp prefix should match');
assert.ok(performSearch('preeclampsia magnesium').results.length < performSearch('preeclampsia').results.length, 'AND must reduce results');
assert.strictEqual(performSearch('preeclampsia magnesium').results.length, 1, 'preeclampsia + magnesium should be 1');
assert.ok(performSearch('PreeClampSia').results.length > 0, 'uppercase must match');
assert.ok(performSearch('caesarean').results.length > 0, 'caesarean variant must match cesarean text');
assert.strictEqual(performSearch('cesarean sections').results.length, performSearch('cesarean section').results.length, 'singular/plural balanced');
assert.strictEqual(performSearch('deliveries').results.length, performSearch('delivery').results.length, 'deliveries/delivery bidirectional inflections match');
assert.strictEqual(performSearch('babies').results.length, performSearch('baby').results.length, 'babies/baby bidirectional inflections match');
assert.ok(performSearch('haemorrhage').results.length > 0 || performSearch('hemorrhage').results.length > 0, 'hemorrhage family must match');
assert.strictEqual(performSearch('zzzq9notaword').results.length, 0, 'nonsense must be empty');
assert.ok(performSearch('   ').showInitial, 'empty shows initial');
assert.strictEqual(performSearch('<script>alert(1)</script>').results.length, 0, 'HTML input must yield no results');
assert.ok(performSearch('gestat').results.length > 0, 'gestat prefix fallback');
assert.strictEqual(performSearch('preeclampsia zzz').results.length, 0, 'multi AND with missing term = 0');
assert.ok(performSearch('cervical dilatation').results.length > 0, 'cervical dilatation should return results');
assert.strictEqual(performSearch('cervical dilatation').results.length, performSearch('cervical dilation').results.length, 'dilation/dilatation bidirectional match');

// Tag cleaning & 2-word limit checks
const ACTION_VERBS = {
  cannot: 1, tolerate: 1, affect: 1, affects: 1, assess: 1, screening: 1,
  evaluate: 1, examine: 1, appear: 1, appears: 1, imminent: 1, again: 1
};
const GENERIC_WORDS = { again: 1, appear: 1, appears: 1, imminent: 1, oral: 1 };
function testCleanTag(tag) {
  let words = String(tag).trim().split(/\s+/).filter(Boolean);
  while (words.length > 0 && (ACTION_VERBS[words[0].toLowerCase()] || GENERIC_WORDS[words[0].toLowerCase()])) words.shift();
  while (words.length > 0 && (ACTION_VERBS[words[words.length - 1].toLowerCase()] || GENERIC_WORDS[words[words.length - 1].toLowerCase()])) words.pop();
  if (!words.length) return '';
  if (words.length > 2) words = words.slice(-2);
  if (words.some(w => ACTION_VERBS[w.toLowerCase()] || GENERIC_WORDS[w.toLowerCase()])) return '';
  return words.map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
}
assert.strictEqual(testCleanTag('Cannot Tolerate Erythromycin'), 'Erythromycin', 'Cannot Tolerate Erythromycin -> Erythromycin');
assert.strictEqual(testCleanTag('Affects Neonatal Morbidity'), 'Neonatal Morbidity', 'Affects Neonatal Morbidity -> Neonatal Morbidity');
assert.strictEqual(testCleanTag('Assess Cervical Dilatation'), 'Cervical Dilatation', 'Assess Cervical Dilatation -> Cervical Dilatation');
assert.strictEqual(testCleanTag('Again Appears Imminent'), '', 'Again Appears Imminent -> empty');
assert.ok(testCleanTag('Cannot Tolerate Erythromycin').split(/\s+/).length <= 2, 'Tag must be at most 2 words');
assert.ok(testCleanTag('Affects Neonatal Morbidity').split(/\s+/).length <= 2, 'Tag must be at most 2 words');

// 1. Contiguous medical expression ranking
const cdResults = performSearch('cervical dilatation').results;
assert.ok(cdResults.length > 0, 'cervical dilatation returns results');
assert.ok(cdResults[0].phrase.toLowerCase().includes('cervical dilatation') || cdResults[0].phrase.toLowerCase().includes('cervical dilation'), 'Top result contains contiguous medical expression');

// 2. Exact paragraph result bounding (< 550 chars, never whole page)
allPhrases.forEach(item => {
  assert.ok(item.phrase.length <= 550, 'Phrase must be <= 550 chars, got ' + item.phrase.length + ': ' + item.phrase.slice(0, 50));
});

// 3. All tag words in guidelines.json are logical (<= 2 words) and active
d.allTags.forEach(tag => {
  const words = tag.trim().split(/\s+/).filter(Boolean);
  assert.ok(words.length >= 1 && words.length <= 2, 'Tag must be 1 or 2 words: ' + tag);
  assert.ok(!ACTION_VERBS[words[0].toLowerCase()], 'Tag must not start with action verb: ' + tag);
  assert.ok(!ACTION_VERBS[words[words.length - 1].toLowerCase()], 'Tag must not end with action verb: ' + tag);
});

console.log('ALL SEARCH4 ASSERTIONS PASSED');