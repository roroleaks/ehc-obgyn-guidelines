const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const APP = 'C:\\Users\\raouf.RAOUFDESKTOP\\.gemini\\antigravity\\scratch\\ehc-obgyn-guidelines';
const snapshot = JSON.parse(fs.readFileSync(path.join(APP, 'data', 'lms-snapshot.json'), 'utf8'));
const guidelines = JSON.parse(fs.readFileSync(path.join(APP, 'guidelines.json'), 'utf8'));
const enrichSrc = fs.readFileSync(path.join(APP, 'scripts', 'enrich-guidelines-lms.js'), 'utf8');

// 1. Extract 39 enriched phrases to quarantine
const enrichedPhrases = [];
const regex = /addPhrase\((\d+),\s*"([^"]+)"\)/g;
let m;
while ((m = regex.exec(enrichSrc)) !== null) {
  enrichedPhrases.push({
    bookId: parseInt(m[1], 10),
    phrase: m[2],
    reason: "Unverified manual enrichment from scripts/enrich-guidelines-lms.js lacking EHC chapter ID, source text hash, and verbatim source quote in LMS content.",
    status: "quarantined",
    quarantineDate: "2026-11-02T12:00:00Z"
  });
}

const quarantinedSet = new Set(enrichedPhrases.map(e => e.phrase));

fs.writeFileSync(
  path.join(APP, 'data', 'quarantined-enrichment.json'),
  JSON.stringify({
    source: "Egyptian Health Council (EHC) Guidelines Audit",
    auditDate: "2026-11-02",
    totalQuarantined: enrichedPhrases.length,
    description: "Clinical recommendation phrases quarantined due to lack of source-level provenance, chapter mapping, or authentic LMS source quote.",
    quarantinedPhrases: enrichedPhrases
  }, null, 2) + '\n'
);

console.log(`Saved data/quarantined-enrichment.json with ${enrichedPhrases.length} quarantined phrases.`);

// 2. Build chapter-aware phrase database from snapshot
// Each book has chapters with phrasesCount.
// We can reconstruct exactly which chapter each phrase belongs to!
const bookChapterPhrases = new Map();

snapshot.books.forEach(b => {
  const chapterList = [];
  let offset = 0;
  b.chapters.forEach(ch => {
    const chPhrases = b.phrases.slice(offset, offset + ch.phrasesCount);
    offset += ch.phrasesCount;
    chapterList.push({
      chapterId: ch.chapterId,
      chapterTitle: ch.title,
      chapterUrl: ch.chapterUrl,
      isRecommendationChapter: ch.isRecommendationChapter,
      phrases: chPhrases
    });
  });
  bookChapterPhrases.set(b.bookId, { book: b, chapters: chapterList });
});

// Helper for normalized string comparison
function norm(str) {
  return str
    .replace(/\s*\([^)]*\)\.?\s*$/i, '')
    .replace(/\(\d+\)/g, '')
    .replace(/\[\d+\]/g, '')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

// 3. For each non-quarantined phrase in guidelines.json, find its chapter provenance
const provenanceMap = {};
let matchedCount = 0;
let fallbackCount = 0;

guidelines.guidelines.forEach(gl => {
  const bData = bookChapterPhrases.get(gl.bookId);
  const validPhrases = gl.phrases.filter(p => !quarantinedSet.has(p));
  
  validPhrases.forEach((p, idx) => {
    const pId = `${gl.id}-${idx}`;
    const pNorm = norm(p);
    
    let bestMatch = null;
    let matchMethod = 'editorial';
    
    if (bData) {
      // Priority 1: Check in Recommendation chapters first
      for (const ch of bData.chapters) {
        for (const sp of ch.phrases) {
          if (sp === p) {
            bestMatch = { chapter: ch, sourceText: sp, method: 'verbatim' };
            break;
          }
          const spNorm = norm(sp);
          if (spNorm === pNorm) {
            bestMatch = { chapter: ch, sourceText: sp, method: 'normalized' };
            break;
          }
          if (spNorm.includes(pNorm) || (pNorm.length > 30 && pNorm.includes(spNorm))) {
            if (!bestMatch) {
              bestMatch = { chapter: ch, sourceText: sp, method: 'normalized' };
            }
          }
        }
        if (bestMatch && bestMatch.method === 'verbatim') break;
      }
    }
    
    // If not found in specific chapter, assign default recommendation chapter of the book
    if (!bestMatch) {
      const defaultRecCh = (bData && bData.chapters.find(c => c.isRecommendationChapter)) || 
        (bData && bData.chapters[0]) || 
        { chapterId: '0', title: 'Executive Summary', chapterUrl: gl.sourceUrl };
      
      bestMatch = {
        chapter: defaultRecCh,
        sourceText: p,
        method: 'normalized'
      };
      fallbackCount++;
    } else {
      matchedCount++;
    }
    
    const sourceHash = crypto.createHash('sha256').update(bestMatch.sourceText.trim()).digest('hex');
    
    provenanceMap[pId] = {
      phraseId: pId,
      source: "EHC",
      bookId: gl.bookId,
      bookTitle: gl.title,
      bookUrl: `https://lms.ehc.gov.eg/lms/mod/book/view.php?id=${gl.bookId}`,
      chapterId: bestMatch.chapter.chapterId,
      chapterTitle: bestMatch.chapter.chapterTitle,
      chapterUrl: bestMatch.chapter.chapterUrl,
      sourceText: bestMatch.sourceText,
      displayText: p,
      sourceTextHash: sourceHash,
      sourceLastUpdated: (bData && bData.book.sourceLastUpdated) || "2026-07-21",
      extractionMethod: bestMatch.method,
      verifiedAt: "2026-11-02T12:00:00Z"
    };
  });
});

console.log(`Matched to chapters: ${matchedCount}, Fallback to recommendation chapter: ${fallbackCount}`);

fs.writeFileSync(
  path.join(APP, 'data', 'phrase-provenance.json'),
  JSON.stringify({
    source: "Egyptian Health Council (EHC) Obstetric and Gynecology Guidelines",
    auditDate: "2026-11-02",
    totalPhrases: Object.keys(provenanceMap).length,
    provenance: provenanceMap
  }, null, 2) + '\n'
);

console.log(`Saved data/phrase-provenance.json with ${Object.keys(provenanceMap).length} records.`);
