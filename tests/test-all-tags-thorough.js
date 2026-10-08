const fs = require('fs');
const path = require('path');
const g = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'guidelines.json'), 'utf8'));

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

const allPhrases = [];
g.guidelines.forEach(guide => {
  guide.phrases.forEach(p => {
    allPhrases.push({ phrase: p, title: guide.title, bookId: guide.bookId });
  });
});

function search(query) {
  var words = query.replace(/[^\w\s]/g, ' ').split(/\s+/).filter(Boolean).map(normalizeForMatch);
  if (!words.length) return [];
  var results = allPhrases.filter(function(item) {
    var text = normalizeForMatch(item.phrase);
    return words.every(function(w) { return phraseHasWordWhole(text, w); });
  });
  if (results.length === 0 && words.length === 1 && words[0].length >= 4) {
    results = allPhrases.filter(function(item) {
      var text = normalizeForMatch(item.phrase);
      return new RegExp('(^|[^a-z0-9])' + escapeRegex(words[0]) + '[a-z0-9]*').test(text);
    });
  }
  if (words.length > 1) {
    results.sort(function(a, b) {
      return scoreMedicalExpression(b.phrase, b.title, words) -
             scoreMedicalExpression(a.phrase, a.title, words);
    });
  }
  return results;
}

console.log(`--- Testing all ${g.allTags.length} tag words one by one ---`);

const zeroTags = [];
const multiWordTags = [];
let passCount = 0;

g.allTags.forEach((tag, idx) => {
  const res = search(tag);
  const words = tag.trim().split(/\s+/).filter(Boolean);
  if (words.length > 1) multiWordTags.push(tag);
  
  if (res.length === 0) {
    zeroTags.push(tag);
    console.log(`[FAIL ZERO] Tag #${idx+1}: "${tag}" -> 0 results!`);
  } else {
    passCount++;
    // Verify top result is logical and bounded
    const top = res[0];
    if (top.phrase.length > 550) {
      console.log(`[WARN LENGTH] Tag "${tag}" top phrase > 550 chars: ${top.phrase.length}`);
    }
  }
});

console.log(`\nResults summary:`);
console.log(`Total tags tested: ${g.allTags.length}`);
console.log(`Tags with >=1 exact phrase match: ${passCount}`);
console.log(`Tags with 0 results: ${zeroTags.length}`);
console.log(`Multi-word tags count: ${multiWordTags.length}`);

if (zeroTags.length > 0) {
  console.error(`\nZero result tags details:`, zeroTags);
  process.exit(1);
} else {
  console.log(`\nALL ${g.allTags.length} TAGS PASSED WITH EXACT MATCHES!`);
}
