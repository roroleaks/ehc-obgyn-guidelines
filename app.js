(function() {
  'use strict';

  if (document.documentElement && document.documentElement.classList) {
    document.documentElement.classList.add('js');
  }

  var guidelinesData = null;
  var allPhrases = [];
  var allTags = [];
  var currentSearch = '';
  var selectedTag = null;

  var searchInput = document.getElementById('search-input');
  var clearBtn = document.getElementById('clear-search');
  var tagsContainer = document.getElementById('tags-container');
  var tagsSection = document.getElementById('tags-section');
  var tagsToggle = document.getElementById('tags-toggle');
  var resultsContainer = document.getElementById('results-container');
  var resultsStats = document.getElementById('results-stats');
  var noResults = document.getElementById('no-results');
  var searchTermDisplay = document.getElementById('search-term-display');
  var initialState = document.getElementById('initial-state');
  var statusRegion = document.getElementById('status-region');
  var lastAnnouncement = '';

  // Single scoped live region for all search/sync status announcements, so
  // assistive technologies never hear duplicated or stale updates.
  function announce(msg) {
    if (!statusRegion || !msg || msg === lastAnnouncement) return;
    lastAnnouncement = msg;
    statusRegion.textContent = '';
    // Force a repaint so identical consecutive messages still re-announce.
    statusRegion.textContent = msg;
  }

  function syncTagsToggle() {
    if (!tagsToggle || !tagsSection) return;
    var expanded = tagsSection.classList.contains('tags-expanded');
    tagsToggle.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    tagsToggle.textContent = expanded ? 'Hide tag words' : 'Show tag words';
  }

  if (tagsToggle) {
    tagsToggle.addEventListener('click', function() {
      if (!tagsSection) return;
      tagsSection.classList.toggle('tags-expanded');
      syncTagsToggle();
    });
  }

  function loadGuidelines() {
    fetch('guidelines.json', { cache: 'no-store' })
      .then(function(res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function(data) {
        guidelinesData = data;
        processData();
        renderTags();
        mergeCachedAutoBooks();
        syncWithLms();
      })
      .catch(function(err) {
        console.error('Failed to load guidelines:', err);
        resultsContainer.innerHTML =
          '<div class="no-results" style="text-align:center;padding:2rem;color:var(--color-text-muted)">' +
          '<p>Failed to load guidelines data. Please refresh or <a href="https://lms.ehc.gov.eg/lms/course/view.php?id=38" target="_blank" rel="noopener">view on EHC LMS</a>.</p></div>';
      });
  }

  function processData() {
    allPhrases = [];

    guidelinesData.guidelines.forEach(function(g) {
      g.phrases.forEach(function(phrase, idx) {
        allPhrases.push({
          id: g.id + '-' + idx,
          guidelineId: g.id,
          guidelineTitle: g.title,
          guidelineBookId: g.bookId,
          phrase: phrase,
          tags: g.tags
        });
      });
    });

    // Use the curated allTags list from the JSON if present, else derive from guideline tags
    if (guidelinesData.allTags && guidelinesData.allTags.length) {
      allTags = guidelinesData.allTags.slice();
    } else {
      var tagSet = {};
      allPhrases.forEach(function(item) {
        item.tags.forEach(function(t) { tagSet[t] = true; });
      });
      allTags = Object.keys(tagSet);
    }

    // Always include auto-extracted tags that were added to the search library in this browser
    mergeStoredNewTags();

    allTags = allTags.sort(function(a, b) { return a.localeCompare(b); });
  }

  function renderTags() {
    tagsContainer.innerHTML = allTags.map(function(tag, i) {
      return '<button type="button" class="tag-btn" data-tag="' + escapeHtml(tag) +
        '" aria-pressed="false" tabindex="' + (i === 0 ? '0' : '-1') + '">' + escapeHtml(tag) + '</button>';
    }).join('');

    var tbs = tagsContainer.querySelectorAll('.tag-btn');

    Array.prototype.forEach.call(tbs, function(btn) {
      btn.addEventListener('click', function() { handleTagClick(btn); });
      btn.addEventListener('keydown', function(e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleTagClick(btn); return; }
        var dir = null;
        if (e.key === 'ArrowRight' || e.key === 'ArrowDown') dir = 1;
        else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') dir = -1;
        else if (e.key === 'Home') dir = 0;
        else if (e.key === 'End') dir = 2;
        if (dir === null) return;
        e.preventDefault();
        moveTagFocus(btn, dir);
      });
    });
    if (tbs.length) {
      tbs[0].tabIndex = 0;
    }

    syncTagsToggle();
  }

  function moveTagFocus(current, dir) {
    var tbs = tagsContainer.querySelectorAll('.tag-btn');
    if (!tbs.length) return;
    var target;
    if (dir === 0) { target = tbs[0]; }
    else if (dir === 2) { target = tbs[tbs.length - 1]; }
    else {
      var idx = Array.prototype.indexOf.call(tbs, current);
      target = tbs[(idx + dir + tbs.length) % tbs.length];
    }
    Array.prototype.forEach.call(tbs, function(b) { b.tabIndex = -1; });
    target.tabIndex = 0;
    target.focus();
  }

  function clearTagSelection() {
    selectedTag = null;
    Array.prototype.forEach.call(tagsContainer.querySelectorAll('.tag-btn'), function(b) {
      b.classList.remove('selected');
      b.setAttribute('aria-pressed', 'false');
    });
  }

  function handleTagClick(btn) {
    var tag = btn.dataset.tag;
    var isSelected = btn.classList.contains('selected');

    Array.prototype.forEach.call(tagsContainer.querySelectorAll('.tag-btn'), function(b) {
      b.classList.remove('selected');
      b.setAttribute('aria-pressed', 'false');
    });

    if (!isSelected) {
      btn.classList.add('selected');
      btn.setAttribute('aria-pressed', 'true');
      selectedTag = tag;
      searchInput.value = tag;
      currentSearch = tag.toLowerCase();
    } else {
      selectedTag = null;
      searchInput.value = '';
      currentSearch = '';
    }

    performSearch();

    if (tagsSection) {
      tagsSection.classList.remove('tags-expanded');
      syncTagsToggle();
    }

    // Predictable focus: after a tag selection, move the user to the results
    // heading so they immediately know where the updated results live.
    var resultsHeading = document.getElementById('results-heading');
    if (resultsHeading && !resultsHeading.hasAttribute('tabindex')) {
      resultsHeading.setAttribute('tabindex', '-1');
    }
    if (resultsHeading) {
      resultsHeading.focus({ preventScroll: false });
      resultsHeading.scrollIntoView({ block: 'nearest' });
    }
  }

  function normalizeForMatch(str) {
    return String(str).toLowerCase().replace(/ae/g, 'e');
  }

  function performSearch() {
    var query = (currentSearch || '').trim().toLowerCase();
    var showInitial = !query;

    if (showInitial) {
      showInitialState();
      return;
    }

    hideInitialState();

    var words = query.split(/\s+/).filter(Boolean);
    // Deduplicate normalized word forms so "oxytocin oxytocin" doesn't force double matches
    // and British/American spellings (caesarean/cesarean) match the same phrases
    var uniqueWords = [];
    words.forEach(function(w) {
      var wn = normalizeForMatch(w);
      if (uniqueWords.indexOf(wn) === -1) uniqueWords.push(wn);
    });

    var results = filterByWords(uniqueWords, false);

    // Free-form words typed manually (not necessarily a tag word): if nothing matched
    // as a substring, fall back to prefix matching so "gestat" finds "gestational".
    if (results.length === 0 && uniqueWords.length === 1 && uniqueWords[0].length >= 4) {
      var prefixed = filterByWords(uniqueWords, true);
      if (prefixed.length) {
        renderResults(prefixed, query, uniqueWords, true);
        return;
      }
    }

    renderResults(results, query, uniqueWords);
  }

  // Strict substring match, or prefix-of-a-word match when usePrefix is set.
  // Works on ae-normalized text so caesarean/cesarean both match.
  function filterByWords(uniqueWords, usePrefix) {
    return allPhrases.filter(function(item) {
      var text = normalizeForMatch(item.phrase);
      return uniqueWords.every(function(w) {
        if (text.indexOf(w) !== -1) return true;
        if (usePrefix && w.length >= 4) {
          return new RegExp('(^|[^a-z])' + escapeRegex(w) + '[a-z]*').test(text);
        }
        return false;
      });
    });
  }

  function renderResults(results, query, words, prefixMatch) {
    if (results.length === 0) {
      resultsContainer.innerHTML = '';
      resultsStats.hidden = true;
      resultsStats.textContent = '';
      noResults.hidden = false;
      searchTermDisplay.textContent = query;
      announce('No phrases match "' + query + '". No results found.');
      return;
    }

    noResults.hidden = true;
    resultsStats.hidden = false;

    // Clear any stale/previous content first so the old result count or cards
    // are never left in the DOM (and never exposed to assistive tech).
    resultsStats.textContent = '';
    resultsContainer.innerHTML = '';

    // Build the full card list BEFORE updating the DOM so the count and the cards
    // always appear together — never a "found N" message with no visible cards.
    try {
      var cards = results.map(function(item, idx) {
        var displayTags = phraseRelevantTags(item.phrase, item.tags || [], query);
        return '<article class="result-card" style="animation-delay:' + (idx * 20) + 'ms">' +
          '<header class="result-header">' +
            '<span class="result-guideline"><a href="https://lms.ehc.gov.eg/lms/mod/book/view.php?id=' + item.guidelineBookId + '" target="_blank" rel="noopener" aria-label="' + (escapeHtml(item.guidelineTitle)) + ', opens in a new tab">' + escapeHtml(item.guidelineTitle) + '<span class="visually-hidden"> (opens in a new tab)</span></a></span>' +
          '</header>' +
          '<p class="result-phrase">' + colorizeType(highlightText(item.phrase, query)) + '</p>' +
          '<div class="result-tags">' +
            displayTags.map(function(t) { return '<button type="button" class="result-tag" data-search-tag="' + escapeHtml(t) + '">' + escapeHtml(t) + '</button>'; }).join('') +
          '</div>' +
        '</article>';
      }).join('');

      resultsStats.innerHTML =
        '<span>Showing ' + results.length + (results.length === 1 ? ' phrase' : ' phrases') +
        ' containing all terms' + (prefixMatch ? ' by prefix' : '') + ': <strong>"' + escapeHtml(query) + '"</strong></span>';
      resultsContainer.innerHTML = cards;
    } catch (e) {
      console.error('renderResults failed:', e);
      resultsContainer.innerHTML = '';
      resultsStats.innerHTML =
        '<span>Found ' + results.length + (results.length === 1 ? ' phrase' : ' phrases') +
        ' but could not display them. Try a shorter or more exact word.</span>';
    }

    announce(results.length + (results.length === 1 ? ' phrase' : ' phrases') + ' found.');

    // Clicking a small result tag performs a new search for that tag word
    Array.prototype.forEach.call(resultsContainer.querySelectorAll('[data-search-tag]'), function(btn) {
      btn.addEventListener('click', function() {
        var tag = btn.getAttribute('data-search-tag');
        searchInput.value = tag;
        currentSearch = tag;
        clearTagSelection();
        searchInput.blur();
        performSearch();
        // Move focus to the results heading so updated results are discoverable.
        var resultsHeading = document.getElementById('results-heading');
        if (resultsHeading) {
          resultsHeading.focus({ preventScroll: false });
          resultsHeading.scrollIntoView({ block: 'nearest' });
        }
      });
    });
  }

  function highlightText(text, query) {
    var escaped = escapeHtml(text);
    if (!query) return escaped;
    var rawWords = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (!rawWords.length) return escaped;

    // Include both British/American spellings (caesarean/cesarean) as highlight targets
    var patterns = [];
    function pushPattern(p) {
      if (patterns.indexOf(p) === -1) patterns.push(p);
    }
    if (rawWords.length > 1) {
      pushPattern(escapeRegex(query.trim()));
      if (query.indexOf('ae') !== -1) {
        pushPattern(escapeRegex(query.trim().replace(/ae/g, 'e')));
      }
    }
    rawWords.forEach(function(w) {
      pushPattern(escapeRegex(w));
      if (w.indexOf('ae') !== -1) {
        // British -> American: caesarean -> cesarean
        pushPattern(escapeRegex(w.replace(/ae/g, 'e')));
      } else if (w.indexOf('e') !== -1) {
        // American -> British: cesarean -> caesarean, hemorrhage -> haemorrhage
        pushPattern(escapeRegex(w.replace('e', 'ae')));
      }
    });

    var regex = new RegExp('(' + patterns.join('|') + ')', 'gi');
    return escaped.replace(regex, '<mark>$1</mark>');
  }

  function colorizeType(html) {
    // Style the trailing recommendation type, e.g. "(Conditional)", "(Strong)", "(GPS)"
    return html.replace(/\(([^()]*)\)(\s*\.?)$/, '<span class="phrase-type">($1)</span>$2');
  }

  function phraseRelevantTags(phraseText, guidelineTags, searchQuery) {
    guidelineTags = guidelineTags || [];
    var phraseLower = phraseText.toLowerCase();
    var queryLower = (searchQuery || '').toLowerCase();
    var output = [];
    var seen = {};

    // 1. Always include the searched tag first (prefer exact match)
    if (queryLower) {
      var queryCandidates = [];
      allTags.forEach(function(t) {
        var tl = t.toLowerCase();
        if (tl === queryLower) { queryCandidates.push({ tag: t, pref: 0 }); }
        else if (tl.indexOf(queryLower) !== -1) { queryCandidates.push({ tag: t, pref: 1 }); }
        else if (queryLower.indexOf(tl) !== -1 && tl.length >= 3) { queryCandidates.push({ tag: t, pref: 2 }); }
      });
      queryCandidates.sort(function(a, b) { return a.pref - b.pref; });
      var tagToAdd = queryCandidates.length ? queryCandidates[0].tag : searchQuery;
      output.push(tagToAdd);
      seen[(tagToAdd.toLowerCase().replace(/ae/g, 'e'))] = true;
    }

    // 2. Score every allTag by phrase relevance (word-boundary aware)
    var scored = [];
    allTags.forEach(function(tag) {
      var key = tag.toLowerCase();
      // Dedupe British/American spelling variants (caesarean == cesarean)
      var normKey = key.replace(/ae/g, 'e');
      if (seen[normKey]) return;
      var tagWords = key.split(/\s+/).filter(Boolean);

      // Skip tags whose words are all 1-2 chars (B, C, etc.) as they match everywhere
      var meaningful = tagWords.filter(function(w) { return w.length >= 3; });
      if (meaningful.length === 0) return;

      var matches = meaningful.filter(function(w) {
        if (w.length >= 6) return phraseLower.indexOf(w) !== -1;
        // Short words + abbreviations must match as a whole word (avoid "art" inside "partum")
        return new RegExp('(^|[^A-Za-z])' + w + '($|[^A-Za-z])').test(phraseLower);
      }).length;

      // Require ALL meaningful words to appear (consistent with search semantics)
      if (matches === meaningful.length) {
        var inGuideline = guidelineTags.some(function(gt) {
          return gt.toLowerCase() === key;
        });
        scored.push({
          tag: tag,
          score: meaningful.length + (inGuideline ? 0.5 : 0) + (meaningful.length > 1 ? 0.2 : 0)
        });
      }
    });

    // 3. Sort by relevance score descending
    scored.sort(function(a, b) {
      return b.score - a.score || a.tag.localeCompare(b.tag);
    });

    // 4. Take top 5 scored + the query tag = 6 total, dedup
    scored.forEach(function(s) {
      if (output.length < 6) {
        var key = s.tag.toLowerCase().replace(/ae/g, 'e');
        if (!seen[key]) {
          output.push(s.tag);
          seen[key] = true;
        }
      }
    });

    return output;
  }

  function showInitialState() {
    resultsContainer.innerHTML = '';
    resultsStats.hidden = true;
    resultsStats.textContent = '';
    noResults.hidden = true;
    initialState.hidden = false;
    announce('Search cleared. Showing the tag words and initial guidance.');
  }

  function hideInitialState() {
    initialState.hidden = true;
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, function(c) {
      var map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
      return map[c];
    });
  }

  // ---- Live auto-update from EHC LMS ----
  var LMS_COURSE_URL = 'https://lms.ehc.gov.eg/lms/course/view.php?id=38';
  var AUTO_CACHE_KEY = 'ehc_auto_guidelines_v1';
  var AUTO_TAGS_KEY = 'ehc_auto_tags_v1';
  var LAST_SYNC_KEY = 'ehc_last_sync_v1';
  var LMS_TIMEOUT_MS = 12000;
  var syncStatusEl = document.getElementById('sync-status');
  var syncInProgress = false;

  // cls is one of: 'syncing', 'ok', 'error' — drives the status dot color.
  function setSyncStatus(msg, cls) {
    if (!syncStatusEl) return;
    syncStatusEl.textContent = msg;
    syncStatusEl.className = 'sync-status' + (cls ? ' sync-status--' + cls : '');
    syncStatusEl.hidden = false;
    // Inform assistive technologies via the shared live region (deduplicated).
    announce(msg);
  }

  // Record the moment the LMS course page was fetched AND parsed successfully.
  function saveLastSync() {
    try {
      localStorage.setItem(LAST_SYNC_KEY, new Date().toISOString());
    } catch (e) { /* localStorage unavailable */ }
  }

  // Human-readable "last successful sync" label, or null when none exists.
  function lastSyncLabel() {
    try {
      var raw = localStorage.getItem(LAST_SYNC_KEY);
      if (!raw) return null;
      var d = new Date(raw);
      if (isNaN(d.getTime())) return null;
      return 'Last successful sync: ' +
        d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
    } catch (e) { return null; }
  }

  // fetch with a hard timeout so a slow or blocked LMS never hangs the UI.
  function fetchWithTimeout(url, ms) {
    if (typeof AbortController !== 'undefined') {
      var controller = new AbortController();
      var timer = setTimeout(function() { controller.abort(); }, ms);
      return fetch(url, { signal: controller.signal }).then(function(res) {
        clearTimeout(timer);
        return res;
      }, function(err) {
        clearTimeout(timer);
        throw err;
      });
    }
    return fetch(url);
  }

  function mergeCachedAutoBooks() {
    try {
      var raw = localStorage.getItem(AUTO_CACHE_KEY);
      if (!raw) return;
      var cached = JSON.parse(raw);
      var existing = {};
      guidelinesData.guidelines.forEach(function(g) { existing[String(g.bookId)] = true; });
      var added = false;
      cached.forEach(function(g) {
        if (!existing[String(g.bookId)]) {
          guidelinesData.guidelines.push(g);
          existing[String(g.bookId)] = true;
          added = true;
        }
      });
      if (added) {
        processData();
        renderTags();
      }
    } catch (e) { /* localStorage unavailable or corrupt */ }
  }

  function cacheAutoGuideline(g) {
    try {
      var raw = localStorage.getItem(AUTO_CACHE_KEY);
      var arr = raw ? JSON.parse(raw) : [];
      arr.push(g);
      localStorage.setItem(AUTO_CACHE_KEY, JSON.stringify(arr));
    } catch (e) { /* ignore */ }
  }

  // Auto-extracted tag words are stored in this browser so they survive reloads,
  // merge them into the running search library (allTags).
  function mergeStoredNewTags() {
    try {
      var raw = localStorage.getItem(AUTO_TAGS_KEY);
      if (!raw) return;
      var extra = JSON.parse(raw);
      extra.forEach(function(t) {
        if (!t) return;
        var norm = String(t).toLowerCase().replace(/ae/g, 'e');
        var exists = allTags.some(function(x) {
          return x.toLowerCase().replace(/ae/g, 'e') === norm;
        });
        if (!exists) allTags.push(String(t));
      });
    } catch (e) { /* localStorage unavailable or corrupt */ }
  }

  function saveStoredNewTags(newTags) {
    try {
      var raw = localStorage.getItem(AUTO_TAGS_KEY);
      var arr = raw ? JSON.parse(raw) : [];
      newTags.forEach(function(t) {
        if (arr.indexOf(t) === -1) arr.push(t);
      });
      localStorage.setItem(AUTO_TAGS_KEY, JSON.stringify(arr));
    } catch (e) { /* ignore */ }
  }

  function syncWithLms() {
    if (!guidelinesData) return;
    if (syncInProgress) return;

    setSyncStatus('Checking EHC LMS for new guidelines…', 'syncing');
    syncInProgress = true;

    fetchWithTimeout(LMS_COURSE_URL, LMS_TIMEOUT_MS)
      .then(function(res) {
        if (!res.ok) throw new Error('http-' + res.status);
        return res.text();
      })
      .then(function(html) {
        var doc = new DOMParser().parseFromString(html, 'text/html');
        var links = doc.querySelectorAll('a[href*="mod/book/view.php?id="]');
        var books = {};
        var order = [];
        Array.prototype.forEach.call(links, function(a) {
          var href = a.getAttribute('href');
          if (!href) return;
          var m = href.match(/mod\/book\/view\.php\?id=(\d+)/);
          if (!m) return;
          var id = m[1];
          if (books[id]) return;
          var rawTitle = (a.textContent || '').replace(/\s+/g, ' ').trim();
          books[id] = { bookId: parseInt(id, 10), title: rawTitle.replace(/\s+Book\s*$/i, '') };
          order.push(id);
        });

        // Only a response with real guideline links counts as a successful sync.
        // A blank, blocked, or unparsed response must fall straight into the
        // cached-data path below and must never be reported as "up to date".
        if (!order.length) throw new Error('empty');

        saveLastSync();
        var syncTime = lastSyncLabel();

        var existing = {};
        guidelinesData.guidelines.forEach(function(g) { existing[String(g.bookId)] = true; });

        var additions = [];
        order.forEach(function(id) {
          if (!existing[id]) additions.push(books[id]);
        });

        if (additions.length) {
          setSyncStatus('Found ' + additions.length + ' new guideline(s) on EHC LMS. Importing…', 'syncing');
          ingestBooks(additions, 0, syncTime);
          return;
        }

        // Request completed and parsed successfully -> only now is "up to date" truthful.
        syncInProgress = false;
        setSyncStatus(
          'Live sync succeeded — up to date with EHC LMS (' + order.length + ' guidelines).' +
          (syncTime ? ' ' + syncTime + '.' : ''),
          'ok'
        );
      })
      .catch(function(err) {
        // A failed sync never touches or clears the locally stored guidelines.
        syncInProgress = false;
        console.error('LMS sync failed:', err && err.message ? err.message : err);
        var label = lastSyncLabel();
        setSyncStatus(
          'Could not reach EHC LMS — showing the locally stored copy of the guidelines.' +
          (label ? ' ' + label + '.' : ''),
          'error'
        );
      });
  }

  function ingestBooks(books, i, syncTime, skipped) {
    skipped = skipped || 0;
    if (i >= books.length) {
      syncInProgress = false;
      var added = books.length - skipped;
      var msg = 'Sync completed — ' + added + ' new guideline(s) added and indexed.';
      if (skipped > 0) {
        msg = 'Sync completed — added ' + added + ' of ' + books.length + ' guideline(s).';
      }
      setSyncStatus(msg + (syncTime ? ' ' + syncTime + '.' : ''), 'ok');
      return;
    }
    setSyncStatus('Importing "' + books[i].title + '" (' + (i + 1) + '/' + books.length + ')…', 'syncing');
    ingestBook(books[i]).then(function(created) {
      if (created) {
        guidelinesData.guidelines.push(created);
        cacheAutoGuideline(created);
        processData();
        renderTags();
        if (currentSearch) performSearch();
      } else {
        skipped += 1;
      }
      ingestBooks(books, i + 1, syncTime, skipped);
    });
  }

  function ingestBook(meta) {
    var bookId = meta.bookId;
    return fetchWithTimeout('https://lms.ehc.gov.eg/lms/mod/book/view.php?id=' + bookId, LMS_TIMEOUT_MS)
      .then(function(res) {
        if (!res.ok) throw new Error('http-' + res.status);
        return res.text();
      })
      .then(function(html) {
        var doc = new DOMParser().parseFromString(html, 'text/html');
        var chapterIds = [];
        var seen = {};
        var anchors = doc.querySelectorAll('a[href*="mod/book/view.php?id=' + bookId + '"][href*="chapterid"]');
        Array.prototype.forEach.call(anchors, function(a) {
          var href = a.getAttribute('href');
          if (!href) return;
          var m = href.match(/chapterid=(\d+)/);
          if (m && !seen[m[1]]) {
            seen[m[1]] = true;
            chapterIds.push(parseInt(m[1], 10));
          }
        });

        // Fallback: scan raw HTML for any chapter link
        if (!chapterIds.length) {
          var rawRe = /chapterid=(\d+)/g;
          var rawM;
          while ((rawM = rawRe.exec(html)) !== null) {
            if (!seen[rawM[1]]) {
              seen[rawM[1]] = true;
              chapterIds.push(parseInt(rawM[1], 10));
            }
          }
        }

        if (!chapterIds.length) return null;

        var queue = chapterIds.slice(0, 60);
        var chain = Promise.resolve([]);
        queue.forEach(function(cid) {
          chain = chain.then(function(all) {
            return fetchWithTimeout('https://lms.ehc.gov.eg/lms/mod/book/view.php?id=' + bookId + '&chapterid=' + cid, LMS_TIMEOUT_MS)
              .then(function(res) {
                if (!res.ok) throw new Error('http-' + res.status);
                return res.text();
              })
              .then(function(html2) {
                var doc2 = new DOMParser().parseFromString(html2, 'text/html');
                var content = doc2.getElementById('mod_book-chapter') || doc2.querySelector('.book_content');
                if (!content) return all;
                var text = content.textContent || '';
                var title = (doc2.querySelector('h3, .mod_book_title') || {}).textContent || '';
                if (title) text = title.replace(/^-?\s*/, '') + '\n\n' + text;
                return all.concat([text]);
              })
              .catch(function() { return all; });
          });
        });

        return chain.then(function(chunks) {
          var phrases = extractPhrases(chunks.join('\n\n'));
          if (!phrases.length) return null;

          var tags = autoTags(phrases);
          var newTags = extractNewTags(phrases);
          if (newTags.length) saveStoredNewTags(newTags);
          var allBookTags = tags.slice();
          newTags.forEach(function(t) {
            if (allBookTags.indexOf(t) === -1) allBookTags.push(t);
          });
          return {
            id: 'lms-live-' + bookId,
            title: meta.title || ('EHC OB/GYN Guideline ' + bookId),
            bookId: bookId,
            tags: allBookTags.slice(0, 20),
            newTags: newTags,
            phrases: phrases
          };
        });
      })
      .catch(function() { return null; });
  }

  function extractPhrases(text) {
    var blocks = text.split(/\n\r?\n+/);
    var phrases = [];
    var seen = {};
    blocks.forEach(function(block) {
      var clean = block
        .replace(/<[^>]+>/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&nbsp;/g, ' ')
        .replace(/[^\w\s.,()\/:%'°()\-]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (clean.length < 20) return;
      var key = clean.toLowerCase().slice(0, 120);
      if (seen[key]) return;
      seen[key] = true;
      phrases.push(clean);
    });
    return phrases;
  }

  function autoTags(phrases) {
    var matches = {};
    allTags.forEach(function(tag) {
      var words = normalizeForMatch(tag).split(/\s+/).filter(Boolean);
      if (!words.length) return;
      var count = 0;
      phrases.forEach(function(p) {
        var pl = normalizeForMatch(p);
        if (words.every(function(w) { return pl.indexOf(w) !== -1; })) count++;
      });
      if (count > 0) matches[tag] = count;
    });
    return Object.keys(matches)
      .sort(function(a, b) { return matches[b] - matches[a]; })
      .slice(0, 15);
  }

  // ---- Auto tag-word extraction for newly ingested guidelines ----
  // Words that should never become tags (function words, judgement/type words, section noise)
  var GENERIC_WORDS = {
    a:1, an:1, the:1, and:1, or:1, of:1, to:1, in:1, on:1, for:1, with:1, by:1, at:1, from:1, as:1,
    is:1, are:1, was:1, were:1, be:1, been:1, being:1, it:1, its:1, this:1, that:1, these:1, those:1,
    they:1, them:1, their:1, there:1, has:1, have:1, had:1, do:1, does:1, did:1, can:1, could:1,
    should:1, may:1, might:1, must:1, will:1, would:1, not:1, no:1, nor:1, but:1, if:1, then:1,
    than:1, so:1, such:1, also:1, per:1, each:1, all:1, any:1, both:1, either:1, every:1, some:1,
    more:1, most:1, less:1, least:1, other:1, others:1, only:1, between:1, among:1, during:1,
    after:1, before:1, within:1, without:1, through:1, against:1, about:1, above:1, below:1,
    into:1, onto:1, over:1, under:1, up:1, down:1, out:1, when:1, where:1, who:1, whom:1, which:1,
    what:1, why:1, how:1, women:1, woman:1, patient:1, patients:1, use:1, used:1, using:1,
    often:1, always:1, never:1, usually:1, generally:1, commonly:1, consider:1, considered:1,
    recommended:1, recommendation:1, recommend:1, recommendations:1, advised:1, advise:1, offer:1,
    offered:1, clinical:1, management:1, treatment:1, delivery:1, birth:1, childbirth:1, care:1,
    guidance:1, advice:1, involve:1, involves:1, involving:1, include:1, includes:1, including:1,
    based:1, according:1, regard:1, regards:1, regarding:1, point:1, points:1, key:1, note:1,
    notes:1, background:1, introduction:1, methods:1, results:1, conclusion:1, conclusions:1,
    summary:1, abstract:1, keywords:1, references:1, appendix:1, figure:1, table:1, first:1,
    second:1, third:1, however:1, therefore:1, moreover:1, additionally:1, furthermore:1,
    importantly:1, evidence:1, certainty:1, conditional:1, strong:1, gps:1, context:1, specific:1,
    moderate:1, low:1, high:1, very:1, weak:1, good:1, practice:1, guideline:1, guidelines:1,
    versus:1, vs:1, via:1, whether:1, unless:1, while:1, until:1, once:1, because:1, since:1,
    although:1, though:1,
    // generic context/time/action words that add no search value
    weeks:1, hours:1, minutes:1, days:1, months:1, year:1, years:1, today:1, daily:1,
    risk:1, risks:1, active:1, stage:1, labor:1, labour:1, severe:1,
    adequate:1, appropriate:1, available:1, reduce:1, reducing:1, increase:1, increased:1,
    performing:1, determine:1, subsequent:1, inform:1, requesting:1, delayed:1, depending:1,
    associated:1, professionals:1, implementation:1, help:1, identify:1, implement:1,
    avoid:1, failed:1, food:1, fluid:1, response:1, plus:1, sole:1, purpose:1, system:1,
    relative:1, onset:1, symptom:1, symptoms:1, early:1, late:1, term:1, preterm:1,
    cm:1, mmhg:1, kg:1, ml:1, mg:1, iu:1, mins:1, hcg:1,
    // second-pass noise words (common adjectives/verbs/context words)
    significant:1, greater:1, fewer:1, less:1, lesser:1, different:1, various:1,
    reasons:1, reason:1, alone:1, line:1, medical:1, indication:1, indications:1,
    particularly:1, especially:1, specifically:1, mostly:1, mainly:1, whose:1,
    serum:1, egypt:1, prevention:1, level:1, levels:1, related:1, given:1,
    diagnosed:1, performed:1, surgical:1, imaging:1, factors:1, pregnant:1, maternal:1,
    progress:1, discuss:1, delay:1, routine:1, duration:1, confirmed:1, assessment:1,
    known:1, protocol:1, clinicians:1, suspected:1, aware:1, prescribe:1, perform:1,
    signs:1, expertise:1, previous:1, antenatal:1, developing:1, develop:1,
    development:1, staining:1, reporting:1, improving:1, comparing:1, reducing:1,
    developing:1, management:1, change:1, changes:1, improving:1, needed:1, required:1,
    provides:1, provided:1, providing:1, using:1, showing:1, shown:1, suggest:1,
    suggests:1, finding:1, findings:1, based:1,
    // third-pass noise words seen in practice run
    rigorous:1, research:1, local:1, opinion:1, leader:1, gestation:1, gestational:1,
    hour:1, hourly:1, healthy:1, strongly:1, supplementation:1, measurements:1,
    litre:1, litres:1, conditions:1, diagnose:1, major:1, minute:1, oral:1, agents:1
  };

  // Boundaries across which n-grams must never be formed
  var NGRAM_BREAK = /[.;!?:"()\[\]{},/]/;

  function isAbbreviation(token) {
    return /^[A-Z]{2,}$/.test(token);
  }

  // A strong single word is specific enough to anchor a tag:
  // real abbreviations (PPH, IVF, IUD) or longer, meaningful words
  function isStrongWord(token) {
    var lc = (token || '').toLowerCase();
    if (!lc || /^\d+$/.test(lc)) return false;
    if (lc.length === 1) return false;
    if (GENERIC_WORDS[lc]) return false;
    if (isAbbreviation(token)) return lc.length >= 3;
    return lc.length >= 5;
  }

  // Whole-word overlap, tolerant of plurals ("cesarean sections" == "cesarean section")
  function stripPlural(w) {
    return w.length > 3 && w.slice(-1) === 's' ? w.slice(0, -1) : w;
  }
  function tagOverlap(a, b) {
    a = stripPlural(a.toLowerCase());
    b = stripPlural(b.toLowerCase());
    if (a === b) return true;
    function bw(hay, needle) {
      return (' ' + hay.replace(/[^a-z0-9]+/g, ' ') + ' ').indexOf(' ' + needle + ' ') !== -1;
    }
    return bw(b, a) || bw(a, b);
  }

  // Reject any candidate already covered by a tag in the search library
  function coveredByExistingTag(key) {
    return allTags.some(function(x) {
      return tagOverlap(key, x);
    });
  }

  function labelizeTag(s) {
    return s.split(' ').map(function(w) {
      if (isAbbreviation(w)) return w;
      return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
    }).join(' ');
  }

  function extractNewTags(phrases) {
    if (!phrases || !phrases.length) return [];
    var uniCount = {}, biCount = {}, triCount = {}, uniLabel = {}, uniOrig = {}, biLabel = {}, triLabel = {};

    phrases.forEach(function(p) {
      var text = String(p);
      // Capture tokens with positions so n-grams never cross sentence/punctuation boundaries
      var tokens = [], offsets = [];
      var re = /[A-Za-z]+(?:'\w+)?/g, m;
      while ((m = re.exec(text)) !== null) {
        tokens.push(m[0]);
        offsets.push(m.index);
      }
      var seenU = {}, seenB = {}, seenT = {};
      for (var i = 0; i < tokens.length; i++) {
        var t1 = tokens[i], l1 = t1.toLowerCase();

        // Unigram candidate
        if (isStrongWord(t1) && !seenU[l1] && !coveredByExistingTag(l1)) {
          seenU[l1] = true;
          uniCount[l1] = (uniCount[l1] || 0) + 1;
          if (!uniLabel[l1]) uniLabel[l1] = t1;
          if (!uniOrig[l1]) uniOrig[l1] = t1;
        }

        // Bigram / trigram candidates (same sentence, no punctuation across)
        if (i + 1 >= tokens.length) continue;
        var gap1 = text.slice(offsets[i] + t1.length, offsets[i + 1]);
        if (NGRAM_BREAK.test(gap1)) continue;

        var t2 = tokens[i + 1], l2 = t2.toLowerCase();
        if (validNgram([t1, t2])) {
          var key2 = l1 + ' ' + l2;
          if (!seenB[key2] && !coveredByExistingTag(key2)) {
            seenB[key2] = true;
            biCount[key2] = (biCount[key2] || 0) + 1;
            if (!biLabel[key2]) biLabel[key2] = t1 + ' ' + t2;
          }
        }
        if (i + 2 < tokens.length) {
          var gap2 = text.slice(offsets[i + 1] + t2.length, offsets[i + 2]);
          if (!NGRAM_BREAK.test(gap2)) {
            var t3 = tokens[i + 2], l3 = t3.toLowerCase();
            if (validNgram([t1, t2, t3])) {
              var key3 = l1 + ' ' + l2 + ' ' + l3;
              if (!seenT[key3] && !coveredByExistingTag(key3)) {
                seenT[key3] = true;
                triCount[key3] = (triCount[key3] || 0) + 1;
                if (!triLabel[key3]) triLabel[key3] = t1 + ' ' + t2 + ' ' + t3;
              }
            }
          }
        }
      }
    });

    function validNgram(toks) {
      var lower = toks.map(function(t) { return t.toLowerCase(); });
      var joint = lower.join(' ');
      var anyStrong = toks.some(isStrongWord);
      var okLength = joint.length >= (toks.length === 2 ? 10 : 13);
      var allOk = toks.every(function(t, i) {
        var lc = lower[i];
        return lc.length >= 3 && !GENERIC_WORDS[lc];
      });
      return okLength && allOk && anyStrong;
    }

    var candidates = [];
    Object.keys(uniCount).forEach(function(k) {
      // Keep frequent single words (>=2) that are capitalized (named concepts/drugs)
      // or strongly recurring (>=3) even when written in lowercase
      if (uniCount[k] >= 2 && (/^[A-Z]/.test(uniOrig[k]) || uniCount[k] >= 3)) {
        candidates.push({ label: labelizeTag(uniLabel[k]), score: uniCount[k] * 10 });
      }
    });
    Object.keys(biCount).forEach(function(k) {
      if (biCount[k] >= 2) candidates.push({ label: labelizeTag(biLabel[k]), score: biCount[k] * 22 + 11 });
    });
    Object.keys(triCount).forEach(function(k) {
      if (triCount[k] >= 2) candidates.push({ label: labelizeTag(triLabel[k]), score: triCount[k] * 33 + 22 });
    });

    // Select highest-scoring candidates, dropping any that overlap an already-chosen tag
    var result = [], accepted = [];
    candidates
      .sort(function(a, b) { return b.score - a.score || a.label.localeCompare(b.label); })
      .forEach(function(c) {
        var dup = accepted.some(function(a) { return tagOverlap(a, c.label); });
        if (dup) return;
        accepted.push(c.label);
        result.push(c.label);
      });
    return result.slice(0, 15);
  }

  function escapeRegex(str) {
    return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  searchInput.addEventListener('input', function(e) {
    currentSearch = e.target.value;
    clearBtn.hidden = !currentSearch;
    clearTagSelection();
    performSearch();
  });

  clearBtn.addEventListener('click', function() {
    searchInput.value = '';
    currentSearch = '';
    clearBtn.hidden = true;
    clearTagSelection();
    performSearch();
    searchInput.focus();
  });

  searchInput.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') {
      clearBtn.click();
    }
  });

  // Initialize
  loadGuidelines();

  // Periodically check for new guidelines while the app stays open
  setInterval(function() {
    if (guidelinesData) syncWithLms();
  }, 30 * 60 * 1000);
})();