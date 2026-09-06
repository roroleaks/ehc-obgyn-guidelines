(function() {
  'use strict';

  var guidelinesData = null;
  var allPhrases = [];
  var allTags = [];
  var currentSearch = '';
  var selectedTag = null;

  var searchInput = document.getElementById('search-input');
  var clearBtn = document.getElementById('clear-search');
  var tagsContainer = document.getElementById('tags-container');
  var resultsContainer = document.getElementById('results-container');
  var resultsStats = document.getElementById('results-stats');
  var noResults = document.getElementById('no-results');
  var searchTermDisplay = document.getElementById('search-term-display');
  var initialState = document.getElementById('initial-state');
  var hintTagsEl = document.querySelector('.hint-tags');

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
        updateHintTags();
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

    allTags = allTags.sort(function(a, b) { return a.localeCompare(b); });
  }

  function renderTags() {
    tagsContainer.innerHTML = allTags.map(function(tag) {
      return '<button type="button" class="tag-btn" data-tag="' + escapeHtml(tag) +
        '" role="option" aria-selected="false" tabindex="0">' + escapeHtml(tag) + '</button>';
    }).join('');

    Array.prototype.forEach.call(tagsContainer.querySelectorAll('.tag-btn'), function(btn) {
      btn.addEventListener('click', function() { handleTagClick(btn); });
      btn.addEventListener('keydown', function(e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleTagClick(btn); }
      });
    });
  }

  function updateHintTags() {
    if (!hintTagsEl) return;
    var sample = ['preeclampsia', 'oxytocin', 'methotrexate', 'episiotomy', 'Robson Classification'];
    var hint = sample.join(', ');
    hintTagsEl.textContent = hint;
  }

  function clearTagSelection() {
    selectedTag = null;
    Array.prototype.forEach.call(tagsContainer.querySelectorAll('.tag-btn'), function(b) {
      b.classList.remove('selected');
      b.setAttribute('aria-selected', 'false');
    });
  }

  function handleTagClick(btn) {
    var tag = btn.dataset.tag;
    var isSelected = btn.classList.contains('selected');

    Array.prototype.forEach.call(tagsContainer.querySelectorAll('.tag-btn'), function(b) {
      b.classList.remove('selected');
      b.setAttribute('aria-selected', 'false');
    });

    if (!isSelected) {
      btn.classList.add('selected');
      btn.setAttribute('aria-selected', 'true');
      selectedTag = tag;
      searchInput.value = tag;
      currentSearch = tag.toLowerCase();
    } else {
      selectedTag = null;
      searchInput.value = '';
      currentSearch = '';
    }

    performSearch();
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
    // Deduplicate word forms so "oxytocin oxytocin" doesn't force double matches
    var uniqueWords = [];
    words.forEach(function(w) {
      var wl = w.toLowerCase();
      if (uniqueWords.indexOf(wl) === -1) uniqueWords.push(wl);
    });

    var results = allPhrases.filter(function(item) {
      var text = item.phrase.toLowerCase();
      return uniqueWords.every(function(w) {
        return text.indexOf(w) !== -1;
      });
    });

    renderResults(results, query, uniqueWords);
  }

  function renderResults(results, query, words) {
    if (results.length === 0) {
      resultsContainer.innerHTML = '';
      resultsStats.hidden = true;
      noResults.hidden = false;
      searchTermDisplay.textContent = query;
      return;
    }

    noResults.hidden = true;

    resultsStats.hidden = false;
    resultsStats.innerHTML =
      '<span>Showing ' + results.length + (results.length === 1 ? ' phrase' : ' phrases') +
      ' containing all terms: <strong>"' + escapeHtml(query) + '"</strong></span>';

    resultsContainer.innerHTML = results.map(function(item, idx) {
      var displayTags = phraseRelevantTags(item.phrase, item.tags, query);
      return '<article class="result-card" style="animation-delay:' + (idx * 20) + 'ms">' +
        '<header class="result-header">' +
          '<span class="result-guideline"><a href="https://lms.ehc.gov.eg/lms/mod/book/view.php?id=' + item.guidelineBookId + '" target="_blank" rel="noopener">' + escapeHtml(item.guidelineTitle) + '</a></span>' +
        '</header>' +
        '<p class="result-phrase">' + highlightText(item.phrase, query) + '</p>' +
        '<div class="result-tags">' +
          displayTags.map(function(t) { return '<button type="button" class="result-tag" data-search-tag="' + escapeHtml(t) + '">' + escapeHtml(t) + '</button>'; }).join('') +
        '</div>' +
      '</article>';
    }).join('');

    // Clicking a small result tag performs a new search for that tag word
    Array.prototype.forEach.call(resultsContainer.querySelectorAll('[data-search-tag]'), function(btn) {
      btn.addEventListener('click', function() {
        var tag = btn.getAttribute('data-search-tag');
        searchInput.value = tag;
        currentSearch = tag;
        clearTagSelection();
        searchInput.blur();
        performSearch();
      });
    });
  }

  function highlightText(text, query) {
    var escaped = escapeHtml(text);
    if (!query) return escaped;
    var words = query.split(/\s+/).filter(Boolean).map(escapeRegex);
    if (!words.length) return escaped;

    var pattern;
    if (words.length > 1) {
      pattern = escapeRegex(query.trim()) + '|' + words.join('|');
    } else {
      pattern = words[0];
    }

    var regex = new RegExp('(' + pattern + ')', 'gi');
    return escaped.replace(regex, '<mark>$1</mark>');
  }

  function phraseRelevantTags(phraseText, guidelineTags, searchQuery) {
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
    noResults.hidden = true;
    initialState.hidden = false;
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
  var syncStatusEl = document.getElementById('sync-status');

  function setSyncStatus(msg) {
    if (syncStatusEl) { syncStatusEl.textContent = msg; syncStatusEl.hidden = false; }
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

  function syncWithLms() {
    setSyncStatus('Checking EHC LMS for new guidelines...');
    fetch(LMS_COURSE_URL)
      .then(function(res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
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

        var existing = {};
        guidelinesData.guidelines.forEach(function(g) { existing[String(g.bookId)] = true; });

        var additions = [];
        order.forEach(function(id) {
          if (!existing[id]) additions.push(books[id]);
        });

        if (!additions.length) {
          setSyncStatus('Up to date with EHC LMS (' + order.length + ' guidelines).');
          return;
        }

        setSyncStatus('Found ' + additions.length + ' new guideline(s) on EHC LMS. Ingesting...');
        ingestBooks(additions, 0);
      })
      .catch(function(err) {
        console.error('LMS sync failed:', err);
        setSyncStatus('Live sync unavailable — app continues with the stored guidelines.');
      });
  }

  function ingestBooks(books, i) {
    if (i >= books.length) {
      setSyncStatus('All new guidelines ingested. You can search them now.');
      return;
    }
    ingestBook(books[i]).then(function(created) {
      if (created) {
        guidelinesData.guidelines.push(created);
        cacheAutoGuideline(created);
        processData();
        renderTags();
        if (currentSearch) performSearch();
        setSyncStatus('Ingested "' + created.title + '" (' + (i + 1) + '/' + books.length + ').');
      } else {
        setSyncStatus('Could not read "' + books[i].title + '" contents; skipped.');
      }
      ingestBooks(books, i + 1);
    });
  }

  function ingestBook(meta) {
    var bookId = meta.bookId;
    return fetch('https://lms.ehc.gov.eg/lms/mod/book/view.php?id=' + bookId)
      .then(function(res) { return res.text(); })
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
            return fetch('https://lms.ehc.gov.eg/lms/mod/book/view.php?id=' + bookId + '&chapterid=' + cid)
              .then(function(res) { return res.text(); })
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
          return {
            id: 'lms-live-' + bookId,
            title: meta.title || ('EHC OB/GYN Guideline ' + bookId),
            bookId: bookId,
            tags: tags,
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
      var words = tag.toLowerCase().split(/\s+/).filter(Boolean);
      if (!words.length) return;
      var count = 0;
      phrases.forEach(function(p) {
        var pl = p.toLowerCase();
        if (words.every(function(w) { return pl.indexOf(w) !== -1; })) count++;
      });
      if (count > 0) matches[tag] = count;
    });
    return Object.keys(matches)
      .sort(function(a, b) { return matches[b] - matches[a]; })
      .slice(0, 15);
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