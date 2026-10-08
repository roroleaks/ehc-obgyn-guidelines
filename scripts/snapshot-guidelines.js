/**
 * Egyptian Health Council (EHC) - OB/GYN Guidelines Snapshot Utility
 *
 * Fetches all official guideline books and chapters from EHC LMS, creates
 * structured snapshots in `data/`, cleans recommendation paragraphs, and
 * extracts curated clinical tags (stripping action verbs like "Assess").
 *
 * Usage:
 *   node scripts/snapshot-guidelines.js          # Takes snapshot to data/
 *   node scripts/snapshot-guidelines.js --apply  # Takes snapshot & updates guidelines.json
 */

const fs = require('fs');
const path = require('path');

const COURSE_URL = 'https://lms.ehc.gov.eg/lms/course/view.php?id=38';
const BASE_LMS = 'https://lms.ehc.gov.eg/lms';
const TIMEOUT_MS = 15000;
const DATA_DIR = path.join(__dirname, '..', 'data');
const BOOKS_DIR = path.join(DATA_DIR, 'books');
const GUIDELINES_JSON = path.join(__dirname, '..', 'guidelines.json');

// Clinical action verbs that must be stripped from tags
const ACTION_VERBS = new Set([
  'assess', 'assessing', 'assessment', 'assessments',
  'screen', 'screening', 'screenings',
  'evaluate', 'evaluating', 'evaluation',
  'examine', 'examining', 'examination',
  'perform', 'performing', 'performance',
  'provide', 'providing', 'provision',
  'offer', 'offering',
  'consider', 'considering', 'consideration',
  'determine', 'determining', 'determination',
  'check', 'checking',
  'measure', 'measuring', 'measurement', 'measurements',
  'monitor', 'monitoring',
  'identify', 'identifying', 'identification',
  'administer', 'administering', 'administration',
  'advise', 'advising', 'advice',
  'recommend', 'recommending', 'recommendation', 'recommendations',
  'manage', 'managing', 'management',
  'treat', 'treating', 'treatment',
  'discuss', 'discussing', 'discussion',
  'prevent', 'preventing', 'prevention',
  'reduce', 'reducing', 'reduction',
  'avoid', 'avoiding', 'avoidance',
  'ensure', 'ensuring',
  'inform', 'informing', 'information',
  'apply', 'applying', 'application',
  'cannot', 'tolerate', 'tolerated', 'tolerating', 'tolerance',
  'affect', 'affects', 'affected', 'affecting', 'effect', 'effects',
  'cause', 'causes', 'causing', 'result', 'resulting',
  'require', 'requires', 'requiring', 'indicate', 'indicates', 'indicating'
]);

const GENERIC_WORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'with', 'by', 'at', 'from', 'as',
  'is', 'are', 'was', 'were', 'be', 'been', 'being', 'it', 'its', 'this', 'that', 'these', 'those',
  'they', 'them', 'their', 'there', 'has', 'have', 'had', 'do', 'does', 'did', 'can', 'could',
  'should', 'may', 'might', 'must', 'will', 'would', 'not', 'no', 'nor', 'but', 'if', 'then',
  'than', 'so', 'such', 'also', 'per', 'each', 'all', 'any', 'both', 'either', 'every', 'some',
  'more', 'most', 'less', 'least', 'other', 'others', 'only', 'between', 'among', 'during',
  'after', 'before', 'within', 'without', 'through', 'against', 'about', 'above', 'below',
  'into', 'onto', 'over', 'under', 'up', 'down', 'out', 'when', 'where', 'who', 'whom', 'which',
  'what', 'why', 'how', 'women', 'woman', 'patient', 'patients', 'use', 'used', 'using',
  'often', 'always', 'never', 'usually', 'generally', 'commonly',
  'guidance', 'point', 'points', 'key', 'note', 'notes',
  'background', 'introduction', 'methods', 'results', 'conclusion', 'conclusions',
  'summary', 'abstract', 'keywords', 'references', 'appendix', 'figure', 'table', 'first',
  'second', 'third', 'however', 'therefore', 'moreover', 'additionally', 'furthermore',
  'importantly', 'evidence', 'certainty', 'conditional', 'strong', 'gps', 'context', 'specific',
  'moderate', 'low', 'high', 'very', 'weak', 'good', 'practice', 'guideline', 'guidelines',
  'versus', 'vs', 'via', 'whether', 'unless', 'while', 'until', 'once', 'because', 'since',
  'weeks', 'hours', 'minutes', 'days', 'months', 'year', 'years', 'today', 'daily',
  'risk', 'risks', 'active', 'stage', 'labor', 'labour', 'severe',
  'adequate', 'appropriate', 'available', 'increase', 'increased',
  'associated', 'professionals', 'implementation', 'help', 'failed', 'food', 'fluid',
  'response', 'plus', 'sole', 'purpose', 'system', 'relative', 'onset', 'symptom', 'symptoms',
  'early', 'late', 'term', 'preterm', 'cm', 'mmhg', 'kg', 'ml', 'mg', 'iu', 'mins', 'hcg',
  'again', 'appear', 'appears', 'appeared', 'appearing', 'imminent', 'planned', 'expected',
  'likely', 'unlikely', 'possible', 'impossible', 'general', 'overall', 'standard', 'common',
  'following', 'review', 'comprehensive', 'historical', 'prior', 'factor', 'factors',
  'section', 'sections', 'chapter', 'page', 'number', 'total', 'rate', 'rates'
]);

function fetchWithTimeout(url, ms = TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return fetch(url, {
    signal: controller.signal,
    headers: { 'User-Agent': 'EHC-OBGYN-Guideline-Snapshot/1.0' }
  }).then(res => {
    clearTimeout(timer);
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return res.text();
  }, err => {
    clearTimeout(timer);
    throw err;
  });
}

function cleanHtmlToBlocks(rawHtml) {
  if (!rawHtml) return [];
  // Convert HTML elements into block-separated plaintext
  const clean = rawHtml
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|tr|div|li|h[1-6]|th|td|blockquote)>/gi, '\n\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[^\w\s.,()\/:%'°()\-]/g, ' ');

  const rawBlocks = clean.split(/\n\s*\n+/);
  const phrases = [];
  const seen = new Set();

  for (let b of rawBlocks) {
    let text = b.replace(/\s+/g, ' ').trim();
    if (text.length < 25) continue;
    if (/^(table of contents|chapter\s*\d+|references|appendix|page\s*\d+)\b/i.test(text)) continue;

    // Sentence splitting for blocks > 550 chars
    if (text.length > 550) {
      const sentences = text.split(/(?<=[.!?])\s+(?=[A-Z0-9])/);
      for (let s of sentences) {
        const sc = s.trim();
        if (sc.length >= 25 && sc.length <= 550) {
          const key = sc.toLowerCase().slice(0, 120);
          if (!seen.has(key)) {
            seen.add(key);
            phrases.push(sc);
          }
        }
      }
    } else {
      const key = text.toLowerCase().slice(0, 120);
      if (!seen.has(key)) {
        seen.add(key);
        phrases.push(text);
      }
    }
  }
  return phrases;
}

function stripLeadingActionVerbs(tag) {
  if (!tag) return '';
  let words = tag.trim().split(/\s+/).filter(Boolean);
  while (words.length > 0 && (ACTION_VERBS.has(words[0].toLowerCase()) || GENERIC_WORDS.has(words[0].toLowerCase()))) {
    words.shift();
  }
  while (words.length > 0 && (ACTION_VERBS.has(words[words.length - 1].toLowerCase()) || GENERIC_WORDS.has(words[words.length - 1].toLowerCase()))) {
    words.pop();
  }
  if (!words.length) return '';
  // Enforce strictly max 2 words per user instruction
  if (words.length > 2) {
    words = words.slice(-2);
  }
  if (words.some(w => ACTION_VERBS.has(w.toLowerCase()) || GENERIC_WORDS.has(w.toLowerCase()))) {
    return '';
  }
  return words.join(' ');
}

function labelizeTag(str) {
  const cleaned = stripLeadingActionVerbs(str);
  if (!cleaned) return '';
  return cleaned.split(' ').map(w => {
    if (/^[A-Z]{2,}$/.test(w)) return w;
    return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
  }).join(' ');
}

function extractTagsFromPhrases(phrases, existingTags = []) {
  const existingSet = new Set(existingTags.map(t => t.toLowerCase()));
  const tagCounts = new Map();

  for (const phrase of phrases) {
    const tokens = (phrase.match(/[A-Za-z]+(?:'\w+)?/g) || []);
    for (let i = 0; i < tokens.length; i++) {
      const t1 = tokens[i].toLowerCase();

      // 1-word medical terms (specific drug/concept)
      if (tokens[i].length >= 5 && !GENERIC_WORDS.has(t1) && !ACTION_VERBS.has(t1)) {
        const cand = labelizeTag(tokens[i]);
        if (cand && !existingSet.has(cand.toLowerCase())) {
          tagCounts.set(cand, (tagCounts.get(cand) || 0) + 1);
        }
      }

      // 2-word medical terms (strictly bigrams)
      if (i + 1 < tokens.length) {
        const t2 = tokens[i + 1].toLowerCase();
        if (!GENERIC_WORDS.has(t1) && !GENERIC_WORDS.has(t2) && !ACTION_VERBS.has(t1) && !ACTION_VERBS.has(t2)) {
          const cand = labelizeTag(`${tokens[i]} ${tokens[i + 1]}`);
          const cWords = cand.split(/\s+/).filter(Boolean);
          if (cWords.length >= 1 && cWords.length <= 2 && cand.length >= 8 && !existingSet.has(cand.toLowerCase())) {
            tagCounts.set(cand, (tagCounts.get(cand) || 0) + 1);
          }
        }
      }
    }
  }

  // Filter candidates with count >= 2
  const discovered = [];
  for (const [tag, count] of tagCounts.entries()) {
    if (count >= 2) discovered.push(tag);
  }
  return discovered;
}

async function runSnapshot(apply = false) {
  console.log(`[Snapshot] Connecting to EHC LMS: ${COURSE_URL}...`);
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(BOOKS_DIR, { recursive: true });

  const courseHtml = await fetchWithTimeout(COURSE_URL);
  const bookLinkRe = /href="([^"]*mod\/book\/view\.php\?id=(\d+)[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
  const books = [];
  const seenBooks = new Set();

  let m;
  while ((m = bookLinkRe.exec(courseHtml)) !== null) {
    const url = m[1].replace(/&amp;/g, '&');
    const bookId = parseInt(m[2], 10);
    const title = m[3].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').replace(/\s+Book\s*$/i, '').trim();
    if (!seenBooks.has(bookId)) {
      seenBooks.add(bookId);
      books.push({ bookId, title, url });
    }
  }

  console.log(`[Snapshot] Found ${books.length} official guideline books on LMS.`);

  const snapshotResults = [];

  for (let b of books) {
    console.log(`[Snapshot] Processing Book ${b.bookId}: "${b.title}"...`);
    let bookHtml = '';
    try {
      bookHtml = await fetchWithTimeout(b.url);
    } catch (err) {
      console.warn(`  Warning: Failed to fetch Book ${b.bookId} main page: ${err.message}`);
      continue;
    }

    // Extract chapter links
    const chRe = /chapterid=(\d+)/g;
    const chIds = new Set();
    let chM;
    while ((chM = chRe.exec(bookHtml)) !== null) {
      chIds.add(chM[1]);
    }

    const chapters = [];
    const allPhrases = [];
    const cidList = Array.from(chIds);

    const chapterResults = await Promise.all(cidList.map(async (cid) => {
      const chUrl = `${BASE_LMS}/mod/book/view.php?id=${b.bookId}&chapterid=${cid}`;
      try {
        const chHtml = await fetchWithTimeout(chUrl, 10000);
        const match = chHtml.match(/id="mod_book-chapter"[^>]*>([\s\S]*?)<\/div>/i) ||
                      chHtml.match(/class="book_content"[^>]*>([\s\S]*?)<\/div>/i);
        const body = match ? match[1] : '';
        const chTitleMatch = chHtml.match(/<h3[^>]*>([\s\S]*?)<\/h3>/i);
        const chTitle = chTitleMatch ? chTitleMatch[1].replace(/<[^>]+>/g, '').trim() : `Chapter ${cid}`;
        const phrases = cleanHtmlToBlocks(body);
        return { chapterId: cid, title: chTitle, phrases };
      } catch (e) {
        return { chapterId: cid, title: `Chapter ${cid}`, phrases: [] };
      }
    }));

    for (const cr of chapterResults) {
      chapters.push({
        chapterId: cr.chapterId,
        title: cr.title,
        phrasesCount: cr.phrases.length
      });
      cr.phrases.forEach(p => allPhrases.push(p));
    }

    const bookTags = extractTagsFromPhrases(allPhrases);

    const bookSnapshot = {
      bookId: b.bookId,
      title: b.title,
      url: b.url,
      timestamp: new Date().toISOString(),
      chaptersCount: chapters.length,
      phrasesCount: allPhrases.length,
      chapters,
      phrases: allPhrases,
      tags: bookTags
    };

    // Save individual book snapshot
    fs.writeFileSync(
      path.join(BOOKS_DIR, `book-${b.bookId}.json`),
      JSON.stringify(bookSnapshot, null, 2) + '\n'
    );

    snapshotResults.push(bookSnapshot);
    console.log(`  -> Book ${b.bookId}: ${chapters.length} chapters, ${allPhrases.length} clean paragraphs.`);
  }

  // Save master snapshot archive
  const masterSnapshot = {
    source: 'Egyptian Health Council (EHC) - Obstetric and Gynecology Guidelines',
    sourceUrl: COURSE_URL,
    snapshotDate: new Date().toISOString(),
    totalBooks: snapshotResults.length,
    books: snapshotResults
  };

  const snapshotFile = path.join(DATA_DIR, 'lms-snapshot.json');
  fs.writeFileSync(snapshotFile, JSON.stringify(masterSnapshot, null, 2) + '\n');
  console.log(`[Snapshot] Master snapshot saved to ${snapshotFile}`);

  if (apply) {
    console.log(`[Snapshot] Applying snapshot to ${GUIDELINES_JSON}...`);
    // Read current guidelines.json to preserve baseline IDs
    const current = JSON.parse(fs.readFileSync(GUIDELINES_JSON, 'utf8'));
    const bookMap = new Map();
    current.guidelines.forEach(g => bookMap.set(g.bookId, g));

    // Update or append snapshot books
    for (const b of snapshotResults) {
      if (bookMap.has(b.bookId)) {
        const existing = bookMap.get(b.bookId);
        // Retain curated tags plus clean discovered tags
        const tagSet = new Set(existing.tags);
        b.tags.forEach(t => tagSet.add(t));
        existing.tags = Array.from(tagSet);
      }
    }

    fs.writeFileSync(GUIDELINES_JSON, JSON.stringify(current, null, 2) + '\n');
    console.log(`[Snapshot] Updated ${GUIDELINES_JSON} successfully.`);
  }

  console.log('[Snapshot] Complete!');
}

const isApply = process.argv.includes('--apply');
runSnapshot(isApply).catch(err => {
  console.error('[Snapshot Error]:', err);
  process.exit(1);
});
