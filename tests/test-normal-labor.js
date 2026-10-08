const assert = require('assert');
const path = require('path');
const fs = require('fs');
const d = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'guidelines.json'), 'utf8'));

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
function escapeRegex(s) { return String(s).replace(/[.*+?^${}()|[\]\\\/]/g, '\\$&'); }

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
    if (w.slice(-3) === 'ies' && w.length > 3) add(w.slice(0, -3) + 'y');
    else if (w.slice(-2) === 'es' && w.length > 3) { add(w.slice(0, -2)); add(w.slice(0, -1)); }
    else add(w.slice(0, -1));
  } else if (w.slice(-1) === 'y' && !/[aeiou]y$/.test(w)) {
    add(w.slice(0, -1) + 'ies');
  } else {
    add(w + 's');
    if (/(?:[sxz]|[sc]h)$/.test(w)) add(w + 'es');
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

function phraseHasWordWhole(phraseNorm, w) {
  return wordForms(w).some(function(f) {
    return new RegExp('(^|[^a-z0-9])' + escapeRegex(f) + '($|[^a-z0-9])').test(phraseNorm);
  });
}

function filterByWords(uniqueWords, usePrefix) {
  if (!uniqueWords.length) return [];
  return allPhrases.filter(function(item) {
    var text = normalizeForMatch(item.phrase);
    return uniqueWords.every(function(w) {
      if (usePrefix) {
        if (phraseHasWordWhole(text, w)) return true;
        if (w.length >= 4) return new RegExp('(^|[^a-z0-9])' + escapeRegex(w) + '[a-z0-9]*').test(text);
        return false;
      }
      return phraseHasWordWhole(text, w);
    });
  });
}

function scoreMedicalExpression(phraseText, guidelineTitle, qWords) {
  if (!qWords || qWords.length <= 1) return 0;
  var norm = normalizeForMatch(phraseText);
  var titleNorm = normalizeForMatch(guidelineTitle || '');
  var formLists = qWords.map(wordForms);
  var score = 0;

  if (qWords.length === 2) {
    var p1 = '(?:' + formLists[0].map(escapeRegex).join('|') + ')';
    var p2 = '(?:' + formLists[1].map(escapeRegex).join('|') + ')';
    var exactAdjacent = new RegExp('(^|[^a-z0-9])' + p1 + '[\\s\\-]+' + p2 + '($|[^a-z0-9])');
    if (exactAdjacent.test(norm)) score += 1000;
    else {
      var nearAdjacent = new RegExp('(^|[^a-z0-9])' + p1 + '[\\s\\-]+(?:and|or|of|in|to|the)?\\s*' + p2 + '($|[^a-z0-9])');
      if (nearAdjacent.test(norm)) score += 500;
      else if (qWords.every(function(w) { return phraseHasWordWhole(norm, w); })) score += 100;
      else score += 10;
    }
  } else if (qWords.length > 2) {
    var parts = formLists.map(function(list) { return '(?:' + list.map(escapeRegex).join('|') + ')'; });
    var exactMulti = new RegExp('(^|[^a-z0-9])' + parts.join('[\\s\\-]+') + '($|[^a-z0-9])');
    if (exactMulti.test(norm)) score += 1000;
    else if (qWords.every(function(w) { return phraseHasWordWhole(norm, w); })) score += 100;
    else score += 10;
  }

  if (qWords.every(function(w) { return phraseHasWordWhole(titleNorm, w); })) {
    score += 300;
  }

  return score;
}

function performSearch(query) {
  var q = (query || '').trim().toLowerCase();
  if (!q) return [];
  var uniqueWords = [];
  q.split(/\s+/).filter(Boolean).forEach(function(w) {
    var wn = normalizeForMatch(w);
    if (uniqueWords.indexOf(wn) === -1) uniqueWords.push(wn);
  });
  var results = filterByWords(uniqueWords, false);
  if (uniqueWords.length > 1) {
    results.sort(function(a, b) {
      return scoreMedicalExpression(b.phrase, b.guidelineTitle, uniqueWords) -
             scoreMedicalExpression(a.phrase, a.guidelineTitle, uniqueWords);
    });
  }
  return results;
}

// Validation tests
const results = performSearch('normal labor');
console.log('Results for "normal labor":', results.length);

assert.ok(results.length >= 5, 'Must return at least 5 results for normal labor');
assert.ok(results[0].phrase.toLowerCase().includes('normal labor'), 'Top result must contain contiguous "normal labor"');
assert.strictEqual(results[0].guidelineBookId, 744, 'Top result must be from Book 744 (Normal Labor)');
assert.ok(results[0].phrase.includes('Normal labor is labor that:'), 'Top result is official definition of normal labor');

// Ensure no false positives from other guidelines (e.g. Hypertension laboratory abnormalities)
const hasFalsePositive = results.some(r => r.phrase.toLowerCase().includes('laboratory abnormalities'));
assert.strictEqual(hasFalsePositive, false, 'Must NOT match "laboratory abnormalities have normalised"');

// Ensure all returned phrases are bounded <= 550 chars
results.forEach((r, i) => {
  assert.ok(r.phrase.length <= 550, `Result ${i+1} must be <= 550 chars, got ${r.phrase.length}`);
});

console.log('PASS: normal labor validation tests passed!');
