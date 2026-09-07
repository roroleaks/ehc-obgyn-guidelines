const fs = require('fs');
const path = require('path');
const { appRoot } = require('./_helpers');
const d = JSON.parse(fs.readFileSync(path.join(appRoot, 'guidelines.json'), 'utf8'));
const allTags = d.allTags;
const allPhrases = [];
(d.guidelines || []).forEach(g => {
  const tags = g.tags || [];
  (g.phrases || []).forEach(p => allPhrases.push({ phrase: p, tags: tags }));
});

function phraseRelevantTags(phraseText, guidelineTags, searchQuery) {
  const phraseLower = phraseText.toLowerCase();
  const queryLower = (searchQuery || '').toLowerCase();
  const output = [];
  const seen = {};

  if (queryLower) {
    const queryCandidates = [];
    allTags.forEach(t => {
      const tl = t.toLowerCase();
      if (tl === queryLower) queryCandidates.push({ tag: t, pref: 0 });
      else if (tl.indexOf(queryLower) !== -1) queryCandidates.push({ tag: t, pref: 1 });
      else if (queryLower.indexOf(tl) !== -1 && tl.length >= 3) queryCandidates.push({ tag: t, pref: 2 });
    });
    queryCandidates.sort((a, b) => a.pref - b.pref);
    const tagToAdd = queryCandidates.length ? queryCandidates[0].tag : searchQuery;
    output.push(tagToAdd);
    seen[tagToAdd.toLowerCase().replace(/ae/g, 'e')] = true;
  }

  const scored = [];
  allTags.forEach(tag => {
    const key = tag.toLowerCase();
    const normKey = key.replace(/ae/g, 'e');
    if (seen[normKey]) return;
    const tagWords = key.split(/\s+/).filter(Boolean);
    const meaningful = tagWords.filter(w => w.length >= 3);
    if (meaningful.length === 0) return;
    const matches = meaningful.filter(w => {
      if (w.length >= 6) return phraseLower.indexOf(w) !== -1;
      return new RegExp('(^|[^A-Za-z])' + w + '($|[^A-Za-z])').test(phraseLower);
    }).length;
    if (matches === meaningful.length) {
      const inGuideline = guidelineTags.some(gt => gt.toLowerCase() === key);
      scored.push({
        tag,
        score: meaningful.length + (inGuideline ? 0.5 : 0) + (meaningful.length > 1 ? 0.2 : 0)
      });
    }
  });

  scored.sort((a, b) => b.score - a.score || a.tag.localeCompare(b.tag));
  scored.forEach(s => {
    if (output.length < 6) {
      const key = s.tag.toLowerCase().replace(/ae/g, 'e');
      if (!seen[key]) {
        output.push(s.tag);
        seen[key] = true;
      }
    }
  });
  return output;
}

// Check: every tag returned for any phrase must itself return >=1 result in the DB
const DB_PHRASES = allPhrases;
function searchCount(query) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return 0;
  const results = DB_PHRASES.filter(item => {
    const text = item.phrase.toLowerCase();
    return words.every(w => text.indexOf(w) !== -1);
  });
  return results.length;
}

let issues = 0;
let totalTags = 0;
let usedTags = new Set();
allPhrases.forEach(item => {
  // use the first tag of the phrase as the search query, like a user would
  const query = item.tags[0] || 'delivery';
  const tags = phraseRelevantTags(item.phrase, item.tags, query);
  if (tags.length < 1) { issues++; console.log('NO TAGS for:', query, '->', item.phrase.slice(0, 60)); }
  if (tags.length > 6) { issues++; console.log('>6 TAGS for:', query, tags); }
  tags.forEach((t, i) => {
    totalTags++;
    usedTags.add(t);
    // Skip the deliberately-included query tag (position 0) — the user asked for it always
    if (i === 0) return;
    if (searchCount(t) < 1) { issues++; console.log('DEAD TAG:', t, '->', item.phrase.slice(0, 60)); }
  });
});

console.log('Phrases:', allPhrases.length);
console.log('Total tags shown:', totalTags);
console.log('Unique tags shown:', usedTags.size);
console.log('Issues:', issues);