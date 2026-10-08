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

  // Bi-directional spelling/abbreviation variants safe for normalized matching.
  // Keys and values are lowercase.
  var VARIANT_MAP = Object.freeze({
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
  });

  var searchInput = document.getElementById('search-input');
  var clearBtn = document.getElementById('clear-search');
  var topicFilter = document.getElementById('topic-filter');
  var strengthPillsContainer = document.getElementById('strength-pills');
  var selectedTopic = 'all';
  var selectedStrength = 'all';
  var tagsContainer = document.getElementById('tags-container');
  var tagsSection = document.getElementById('tags-section');
  var tagsToggle = document.getElementById('tags-toggle');
  var resultsContainer = document.getElementById('results-container');
  var resultsStats = document.getElementById('results-stats');
  var noResults = document.getElementById('no-results');
  var initialState = document.getElementById('initial-state');
  var statusRegion = document.getElementById('status-region');
  var searchHelpToggle = document.getElementById('search-help-toggle');
  var searchHelpPanel = document.getElementById('search-help');
  var provenanceEl = document.getElementById('provenance');
  var toolbarFeedback = document.getElementById('toolbar-feedback');
  var copySearchLinkBtn = document.getElementById('copy-search-link');
  var printBtn = document.getElementById('print-results');
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

  // Search help panel toggle
  if (searchHelpToggle && searchHelpPanel) {
    searchHelpToggle.addEventListener('click', function() {
      var expanded = searchHelpPanel.open;
      searchHelpToggle.setAttribute('aria-expanded', String(!expanded));
      searchHelpToggle.textContent = expanded ? 'Search help' : 'Hide search help';
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
        populateTopicFilter();
        mergeCachedAutoBooks();
        populateProvenance();
        syncWithLms();
        // Restore query from URL (?q=...) on initial load
        var urlQuery = readQueryFromUrl();
        if (urlQuery) {
          searchInput.value = urlQuery;
          currentSearch = urlQuery.toLowerCase();
          clearBtn.hidden = false;
          if (selectedTag) clearTagSelection();
          performSearch();
        }
      })
      .catch(function(err) {
        console.error('Failed to load guidelines:', err);
        resultsContainer.innerHTML =
          '<div class="no-results" style="text-align:center;padding:2rem;color:var(--color-text-muted)">' +
          '<p>Failed to load guidelines data. Please refresh or <a href="https://lms.ehc.gov.eg/lms/course/view.php?id=38" target="_blank" rel="noopener">view on EHC LMS</a>.</p></div>';
      });
  }

  // Human-readable "guideline data" date (e.g. "Sep 6, 2026"), derived from the
  // dataset metadata's lastUpdated value — never hardcoded. Date-only values
  // parse as UTC, so the displayed day never shifts across browser locations.
  function formatDataDate(isoDate) {
    if (!isoDate) return null;
    var d = new Date(isoDate);
    if (isNaN(d.getTime())) return String(isoDate);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
  }

  // A concise provenance line sits above the results (not just in the footer).
  // The guideline-data date and the live-sync state are separate facts and are
  // labeled separately so the two dates never read as a single ambiguous value.
  function populateProvenance() {
    if (!provenanceEl || !guidelinesData) return;
    var html = 'Source: ';
    if (guidelinesData.sourceUrl) {
      html += '<a href="' + escapeHtml(guidelinesData.sourceUrl) + '" target="_blank" rel="noopener">' +
        escapeHtml(String(guidelinesData.source || 'Source')) +
        '<span class="visually-hidden"> (opens in a new tab)</span></a>';
    } else {
      html += escapeHtml(String(guidelinesData.source || 'Source'));
    }
    var dataDate = formatDataDate(guidelinesData.lastUpdated);
    if (dataDate) {
      html += ' <span class="provenance-date">\u00b7 Guideline data current as of ' + escapeHtml(String(dataDate)) + '</span>';
    }
    html += ' <span class="provenance-sync"></span>';
    provenanceEl.innerHTML = html;
    provenanceEl.hidden = false;
    // Until live synchronization settles, only the guideline data date is shown
    // (no possibly-misleading sync timestamp).
    setProvenanceSync('pending');
  }

  function processData() {
    allPhrases = [];

    guidelinesData.guidelines.forEach(function(g) {
      g.phrases.forEach(function(phrase, idx) {
        if (typeof phrase !== 'string') return;
        var trimmed = phrase.trim();
        if (trimmed.length > 550) {
          var sents = trimmed.split(/(?<=[.!?])\s+(?=[A-Z0-9])/);
          sents.forEach(function(s, sIdx) {
            var sc = s.trim();
            if (sc.length >= 20) {
              allPhrases.push({
                id: g.id + '-' + idx + '-' + sIdx,
                guidelineId: g.id,
                guidelineTitle: g.title,
                guidelineBookId: g.bookId,
                phrase: sc,
                tags: g.tags
              });
            }
          });
        } else if (trimmed.length >= 20) {
          allPhrases.push({
            id: g.id + '-' + idx,
            guidelineId: g.id,
            guidelineTitle: g.title,
            guidelineBookId: g.bookId,
            phrase: trimmed,
            tags: g.tags
          });
        }
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

  function populateTopicFilter() {
    if (!topicFilter || !guidelinesData || !guidelinesData.guidelines) return;
    var currentVal = topicFilter.value || 'all';
    var opts = '<option value="all">All Guidelines (' + guidelinesData.guidelines.length + ')</option>';
    guidelinesData.guidelines.forEach(function(g) {
      opts += '<option value="' + escapeHtml(g.id) + '">' + escapeHtml(g.title) + '</option>';
    });
    topicFilter.innerHTML = opts;
    topicFilter.value = currentVal;
  }

  function updateFiltersToggleLabel() {
    var toggleEl = document.getElementById('search-options-toggle');
    if (!toggleEl) return;
    var labelEl = toggleEl.querySelector('.search-options-label');
    if (!labelEl) return;
    var activeCount = 0;
    if (selectedTopic !== 'all') activeCount++;
    if (selectedStrength !== 'all') activeCount++;
    if (activeCount > 0) {
      labelEl.textContent = 'Filters & Options (' + activeCount + ' active)';
    } else {
      labelEl.textContent = 'Filters & Options';
    }
  }

  function updateSearchPlaceholder() {
    if (!searchInput) return;
    if (window.innerWidth <= 640) {
      searchInput.setAttribute('placeholder', 'Search guidelines (e.g. preeclampsia, labor)...');
    } else {
      searchInput.setAttribute('placeholder', 'Type a tag word (e.g., preeclampsia, cesarean, oxytocin, methotrexate)...');
    }
  }
  window.addEventListener('resize', updateSearchPlaceholder);
  updateSearchPlaceholder();

  if (topicFilter) {
    topicFilter.addEventListener('change', function() {
      selectedTopic = topicFilter.value;
      updateFiltersToggleLabel();
      performSearch();
    });
  }

  if (strengthPillsContainer) {
    strengthPillsContainer.addEventListener('click', function(e) {
      var btn = e.target.closest('.filter-pill');
      if (!btn) return;
      var str = btn.getAttribute('data-strength');
      if (!str) return;
      selectedStrength = str;
      Array.prototype.forEach.call(strengthPillsContainer.querySelectorAll('.filter-pill'), function(p) {
        var isThis = p === btn;
        p.classList.toggle('active', isThis);
        p.setAttribute('aria-pressed', isThis ? 'true' : 'false');
      });
      updateFiltersToggleLabel();
      performSearch();
    });
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
      pushQueryState(tag);
    } else {
      selectedTag = null;
      searchInput.value = '';
      currentSearch = '';
      pushQueryState('');
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
      resultsHeading.scrollIntoView({ block: 'start', behavior: 'smooth' });
    }
  }

  function normalizeForMatch(str) {
    return String(str).toLowerCase().replace(/ae/g, 'e').replace(/oe/g, 'e');
  }

  var _variantSet = null;
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

  // --- URL state (?q=) ---
  var _urlTimer = null;
  // Debounce only the URL write so keystrokes don't spam browser history.
  // The search itself stays instant (runs on every input event).
  function scheduleQueryStateUpdate(q) {
    if (_urlTimer !== null) clearTimeout(_urlTimer);
    _urlTimer = setTimeout(function() {
      _urlTimer = null;
      pushQueryState(q);
    }, 250);
  }
  function pushQueryState(q) {
    var url = new URL(window.location.href);
    if (q) url.searchParams.set('q', q);
    else url.searchParams.delete('q');
    window.history.pushState({}, '', url.toString());
  }
  function readQueryFromUrl() {
    var url = new URL(window.location.href);
    return (url.searchParams.get('q') || '').trim();
  }

  // --- Result classification ---
  // All spellings/singular forms that can represent a normalized search word (OR set).
  function wordForms(w) {
    var forms = [];
    function push(f) { if (forms.indexOf(f) === -1) forms.push(f); }
    variantifyQuery(w).forEach(push);
    stripTrailingS(w).forEach(push);
    return forms;
  }
  function phraseHasWordSubstring(phraseNorm, w) {
    return wordForms(w).some(function(f) { return phraseNorm.indexOf(f) !== -1; });
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

    // Contiguous expression check: adjacent words in order (e.g. "normal labor" or "cervical dilatation")
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

    // Boost if the guideline title itself matches the search expression
    if (qWords.every(function(w) { return phraseHasWordWhole(titleNorm, w); })) {
      score += 300;
    }

    return score;
  }

  function classifyResults(results, qWords) {
    var exact = 0, prefix = 0, related = 0;
    results.forEach(function(item) {
      var phraseNorm = normalizeForMatch(item.phrase);
      if (qWords.every(function(w) { return phraseHasWordWhole(phraseNorm, w); })) exact++;
      else related++;
    });
    return { exact: exact, prefix: prefix, related: related };
  }

  function findVariantSuggestion(query) {
    var words = query.split(/\s+/).filter(Boolean);
    var vs = buildVariantSet();
    var suggestion = null;
    words.some(function(w) {
      var variants = variantifyQuery(w);
      return variants.some(function(v) {
        if (v !== w && vs[v]) { suggestion = { from: w, to: v }; return true; }
        return false;
      });
    });
    return suggestion;
  }

  function performSearch() {
    var query = (currentSearch || '').trim().toLowerCase();
    var hasFilter = (selectedTopic !== 'all') || (selectedStrength !== 'all');
    var showInitial = !query && !hasFilter;

    if (showInitial) {
      showInitialState();
      return;
    }

    hideInitialState();

    var words = query.replace(/[^\w\s]/g, ' ').split(/\s+/).filter(Boolean);
    var uniqueWords = [];
    words.forEach(function(w) {
      var wn = normalizeForMatch(w);
      if (uniqueWords.indexOf(wn) === -1) uniqueWords.push(wn);
    });

    // AND across words (all terms must appear), OR within each word's
    // variant/singular forms. Prioritize contiguous medical expression matches.
    var results = uniqueWords.length ? filterByWords(uniqueWords, false) : allPhrases.slice();
    if (uniqueWords.length > 1) {
      results.sort(function(a, b) {
        var sa = scoreMedicalExpression(a.phrase, a.guidelineTitle, uniqueWords);
        var sb = scoreMedicalExpression(b.phrase, b.guidelineTitle, uniqueWords);
        return sb - sa;
      });
    }
    var classification = classifyResults(results, uniqueWords);

    // Single word >= 4 chars: prefix fallback if whole-word matching yields nothing
    var isPrefix = false;
    if (results.length === 0 && uniqueWords.length === 1 && uniqueWords[0].length >= 4) {
      var prefixed = filterByWords(uniqueWords, true);
      if (prefixed.length) {
        results = prefixed;
        isPrefix = true;
        classification = { exact: 0, prefix: prefixed.length, related: prefixed.length };
      }
    }

    // Apply Faceted Topic Filter
    if (selectedTopic !== 'all') {
      results = results.filter(function(item) {
        return item.guidelineId === selectedTopic;
      });
      classification = classifyResults(results, uniqueWords);
    }

    // Apply Faceted Strength Filter
    if (selectedStrength !== 'all') {
      results = results.filter(function(item) {
        var st = detectStrength(item.phrase);
        return st && st.key === selectedStrength;
      });
      classification = classifyResults(results, uniqueWords);
    }

    // Suggest a known spelling variant (e.g. "cesarean" for "caesarean") when nothing matches
    var variantSuggestion = query ? findVariantSuggestion(query) : null;

    renderResults(results, query, uniqueWords, isPrefix, classification, variantSuggestion);
  }

  function filterByWords(uniqueWords, usePrefix) {
    if (!uniqueWords.length) return [];
    return allPhrases.filter(function(item) {
      var text = normalizeForMatch(item.phrase);
      return uniqueWords.every(function(w) {
        if (usePrefix) {
          if (phraseHasWordWhole(text, w)) return true;
          if (w.length >= 4) {
            return new RegExp('(^|[^a-z0-9])' + escapeRegex(w) + '[a-z0-9]*').test(text);
          }
          return false;
        }
        return phraseHasWordWhole(text, w);
      });
    });
  }

  function renderResults(results, query, words, isPrefix, classification, variantSuggestion) {
    if (results.length === 0) {
      resultsContainer.innerHTML = '';
      resultsStats.hidden = true;
      resultsStats.textContent = '';
      noResults.hidden = false;

      // Enhanced no-results messaging (built with escaped query — no duplicate ids)
      var nh = '';
      nh += '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><circle cx="11" cy="11" r="8"></circle><path d="M21 21l-4.35-4.35"></path><path d="M8 8l6 6"></path><path d="M14 8l-6 6"></path></svg>';
      nh += '<p><span class="no-results-badge">Not Found</span></p>';
      if (query) {
        nh += '<p>No phrases match "<strong>' + escapeHtml(query) + '</strong>"</p>';
      } else {
        nh += '<p>No phrases match the selected filters.</p>';
      }
      if (words.length > 1) {
        nh += '<p class="no-results-hint">All search terms must appear in each result. Try removing one word or shortening a term.</p>';
      } else {
        nh += '<p class="no-results-hint">Try a different keyword or browse the tag words above.</p>';
      }
      if (variantSuggestion) {
        nh += '<p class="no-results-hint"><strong>Did you mean <a href="#" class="variant-suggestion" data-variant="' + escapeHtml(variantSuggestion.to) + '">' + escapeHtml(variantSuggestion.to) + '</a> instead of ' + escapeHtml(variantSuggestion.from) + '?</strong></p>';
      }
      noResults.innerHTML = nh;

      // Bind variant suggestion link if present
      var vsLink = noResults.querySelector('.variant-suggestion');
      if (vsLink) {
        vsLink.addEventListener('click', function(e) {
          e.preventDefault();
          var v = vsLink.getAttribute('data-variant');
          searchInput.value = v;
          currentSearch = v;
          pushQueryState(v);
          if (selectedTag) clearTagSelection();
          performSearch();
        });
      }

      announce(query ? ('No phrases match "' + query + '". No results found.') : 'No phrases match the selected filters.');
      return;
    }

    noResults.hidden = true;
    resultsStats.hidden = false;

    // Clear stale content before rebuilding so the old count or cards are
    // never left in the DOM or exposed to assistive tech.
    resultsStats.textContent = '';
    resultsContainer.innerHTML = '';

    try {
      var cards = results.map(function(item, idx) {
        var strength = detectStrength(item.phrase);
        var displayTags = phraseRelevantTags(item.phrase, item.tags || [], query);
        return '<article class="result-card card-strength-' + (strength ? strength.key : 'default') + '" data-book-id="' + item.guidelineBookId + '" style="animation-delay:' + (idx * 20) + 'ms">' +
          '<header class="result-header">' +
            '<span class="result-guideline"><a href="https://lms.ehc.gov.eg/lms/mod/book/view.php?id=' + item.guidelineBookId + '" target="_blank" rel="noopener" aria-label="' + (escapeHtml(item.guidelineTitle)) + ', opens in a new tab">' + escapeHtml(item.guidelineTitle) + '<span class="visually-hidden"> (opens in a new tab)</span></a></span>' +
            '<span class="result-book-meta">Book ' + item.guidelineBookId + '</span>' +
          '</header>' +
          '<p class="result-phrase">' + colorizeType(highlightText(item.phrase, query), strength) + '</p>' +
          '<div class="result-tags">' +
            displayTags.map(function(t) { return '<button type="button" class="result-tag" data-search-tag="' + escapeHtml(t) + '">' + escapeHtml(t) + '</button>'; }).join('') +
          '</div>' +
          '<div class="result-actions">' +
            '<button type="button" class="copy-btn" data-copy-label="Copy" data-copy-text="' + escapeHtml(item.phrase) + '" title="Copy recommendation text">Copy</button>' +
          '</div>' +
        '</article>';
      }).join('');

      // Build classification-aware stats text (plain text — no innerHTML — safe from XSS)
      var c = classification || { exact: 0, prefix: 0, related: 0 };
      var totalParts = [];
      if (c.exact > 0) totalParts.push(c.exact + ' exact');
      if (c.related > 0) totalParts.push(c.related + ' related');
      else if (c.prefix > 0 || isPrefix) totalParts.push((c.prefix || results.length) + (isPrefix ? ' by prefix' : ' broader'));
      var breakdown = totalParts.length ? ' \u2014 ' + totalParts.join(', ') : '';

      var allTermsNote = words.length > 1 ? ', all terms matched' : '';
      var prefixNote = '';

      var statsText = '';
      if (query) {
        statsText = 'Showing ' + results.length + (results.length === 1 ? ' phrase' : ' phrases') +
          ' for "' + query + '"' + prefixNote + allTermsNote + breakdown + '.';
      } else {
        var filterParts = [];
        if (selectedTopic !== 'all' && guidelinesData && guidelinesData.guidelines) {
          var matchedG = guidelinesData.guidelines.find(function(g) { return g.id === selectedTopic; });
          if (matchedG) filterParts.push(matchedG.title);
        }
        if (selectedStrength !== 'all') {
          filterParts.push(selectedStrength.toUpperCase() + ' strength');
        }
        statsText = 'Showing ' + results.length + (results.length === 1 ? ' phrase' : ' phrases') +
          (filterParts.length ? ' in ' + filterParts.join(' \u2014 ') : '') + '.';
      }
      resultsStats.textContent = statsText;
      resultsContainer.innerHTML = cards;
      bindCopyButtons();
    } catch (e) {
      console.error('renderResults failed:', e);
      resultsContainer.innerHTML = '';
      resultsStats.textContent = 'Found ' + results.length + (results.length === 1 ? ' phrase' : ' phrases') + ' but could not display them. Try a shorter or more exact word.';
    }

    announce(results.length + (results.length === 1 ? ' phrase' : ' phrases') + ' found.');

    // Clicking a small result tag performs a new search for that tag word
    Array.prototype.forEach.call(resultsContainer.querySelectorAll('[data-search-tag]'), function(btn) {
      btn.addEventListener('click', function() {
        var tag = btn.getAttribute('data-search-tag');
        searchInput.value = tag;
        currentSearch = tag;
        pushQueryState(tag);
        clearTagSelection();
        searchInput.blur();
        performSearch();
        var resultsHeading = document.getElementById('results-heading');
        if (resultsHeading) {
          resultsHeading.focus({ preventScroll: false });
          resultsHeading.scrollIntoView({ block: 'start', behavior: 'smooth' });
        }
      });
    });
  }

  function highlightText(text, query) {
    var escaped = escapeHtml(text);
    if (!query) return escaped;
    var rawWords = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (!rawWords.length) return escaped;

    var patterns = [];
    function pushPattern(p) {
      if (p && patterns.indexOf(p) === -1) patterns.push(p);
    }

    // If query is a multi-word expression, build contiguous expression patterns FIRST
    // so the entire medical expression highlights as a cohesive block:
    if (rawWords.length > 1) {
      var formLists = rawWords.map(wordForms);
      if (rawWords.length === 2) {
        formLists[0].forEach(function(w1) {
          formLists[1].forEach(function(w2) {
            pushPattern(escapeRegex(w1) + '[\\s\\-]+' + escapeRegex(w2));
          });
        });
      } else {
        pushPattern(escapeRegex(query.trim()));
      }
    }

    // Then add individual words / variants for remaining occurrences
    rawWords.forEach(function(w) {
      pushPattern(escapeRegex(w));
      var variants = variantifyQuery(w);
      variants.forEach(function(v) {
        if (v && v.length >= 3) pushPattern(escapeRegex(v));
      });
      if (w.indexOf('ae') !== -1) {
        pushPattern(escapeRegex(w.replace(/ae/g, 'e')));
      } else if (w.indexOf('e') !== -1) {
        pushPattern(escapeRegex(w.replace('e', 'ae')));
      }
    });

    // Sort patterns by length descending so longer contiguous expressions match before single words
    patterns.sort(function(a, b) { return b.length - a.length; });

    var regex = new RegExp('(' + patterns.join('|') + ')', 'gi');
    return escaped.replace(regex, '<mark>$1</mark>');
  }

  // Recognizes a trailing recommendation strength/type annotation in the SOURCE
  // phrase text, e.g. "(Strong)", "(GPS)", "(Conditional)", "(Recommended,
  // High-certainty evidence)". The pill keeps the original wording — only an
  // accessible label and per-strength styling are added.
  function detectStrength(phrase) {
    var m = String(phrase).trim().match(/\(([^()]*)\)\s*\.?$/);
    if (!m) return null;
    var label = m[1].trim();
    if (!/strong|conditional|\bgps\b|weak|certainty|evidence|recommendation|practice/i.test(label)) return null;
    var lower = label.toLowerCase();
    var key = 'other';
    if (lower.indexOf('strong') !== -1 || lower.indexOf('high-certainty') !== -1) key = 'strong';
    else if (/\bgps\b/.test(lower) || lower.indexOf('good practice') !== -1) key = 'gps';
    else if (lower.indexOf('conditional') !== -1 || lower.indexOf('context-specific') !== -1) key = 'conditional';
    else if (lower.indexOf('weak') !== -1 || lower.indexOf('very low') !== -1) key = 'weak';
    return { label: label, key: key };
  }

  function colorizeType(html, strength) {
    // Style the trailing recommendation type, e.g. "(Conditional)", "(Strong)", "(GPS)"
    if (!strength) {
      return html.replace(/\(([^()]*)\)(\s*\.?)$/, '<span class="phrase-type">($1)</span>$2');
    }
    var attrs = 'class="phrase-type strength--' + strength.key + '"' +
      ' data-strength="' + strength.key + '"' +
      ' aria-label="Recommendation strength: ' + escapeHtml(strength.label) + '"';
    return html.replace(/\(([^()]*)\)(\s*\.?)$/, '<span ' + attrs + '>($1)</span>$2');
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
    // Keep the provenance line's sync segment in step (text only — it is never
    // announced, so the single live region below stays the only announcement).
    setProvenanceSync(cls);
    // Inform assistive technologies via the shared live region (deduplicated).
    announce(msg);
  }

  // Record the moment the LMS course page was fetched AND parsed successfully.
  function saveLastSync() {
    try {
      localStorage.setItem(LAST_SYNC_KEY, new Date().toISOString());
    } catch (e) { /* localStorage unavailable */ }
  }

  // Human-readable "last successful sync" time only (e.g. "Sep 7, 2026, 1:58 PM"),
  // derived from the stored sync timestamp — never hardcoded. Returns null when
  // no valid successful sync exists yet.
  function lastSyncTimeText() {
    try {
      var raw = localStorage.getItem(LAST_SYNC_KEY);
      if (!raw) return null;
      var d = new Date(raw);
      if (isNaN(d.getTime())) return null;
      return d.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
    } catch (e) { return null; }
  }

  // Human-readable "last successful sync" label, or null when none exists.
  function lastSyncLabel() {
    var t = lastSyncTimeText();
    return t ? 'Last successful sync: ' + t : null;
  }

  // The provenance line mirrors the sync-status state without duplicating the
  // full status sentence: pending until the first sync settles, then the last
  // sync time (success, or a cached fallback that synced before), or a clear
  // unavailable note when no successful sync has ever completed.
  function provenanceSyncSuffix(cls) {
    var t = (cls === 'ok' || cls === 'error') ? lastSyncTimeText() : null;
    if (cls === 'error' && !t) return 'LMS sync unavailable \u2014 using cached data';
    return t ? 'Last LMS sync: ' + t : 'LMS sync pending';
  }

  // Updates the readable sync segment inside the provenance line (textContent
  // only, so no nested markup and no second live announcement).
  function setProvenanceSync(cls) {
    if (!provenanceEl) return;
    var span = provenanceEl.querySelector('.provenance-sync');
    if (!span) return;
    var suffix = provenanceSyncSuffix(cls);
    span.textContent = '\u00b7 ' + suffix;
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
      var sanitized = [];
      cached.forEach(function(g) {
        if (!g || !g.phrases) return;
        var cleanPhrases = [];
        g.phrases.forEach(function(p) {
          if (typeof p !== 'string') return;
          if (p.length > 550) {
            var parts = p.split(/(?<=[.!?])\s+(?=[A-Z0-9])/);
            parts.forEach(function(part) {
              var pc = part.trim();
              if (pc.length >= 25 && pc.length <= 550) cleanPhrases.push(pc);
            });
          } else if (p.length >= 20) {
            cleanPhrases.push(p);
          }
        });
        g.phrases = cleanPhrases;
        sanitized.push(g);
        if (!existing[String(g.bookId)]) {
          guidelinesData.guidelines.push(g);
          existing[String(g.bookId)] = true;
          added = true;
        }
      });
      localStorage.setItem(AUTO_CACHE_KEY, JSON.stringify(sanitized));
      if (added) {
        processData();
        renderTags();
        populateTopicFilter();
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
      var validExtra = [];
      extra.forEach(function(t) {
        if (!t) return;
        var label = labelizeTag(String(t));
        if (!label) return;
        var words = label.toLowerCase().split(/\s+/).filter(Boolean);
        // Exclude tags with not 1 or 2 words, or containing banned verbs/noise words
        if (words.length < 1 || words.length > 2) return;
        if (words.some(function(w) { return GENERIC_WORDS[w] || (typeof ACTION_VERBS !== 'undefined' && ACTION_VERBS[w]); })) return;
        if (label.toLowerCase().indexOf('again appears imminent') !== -1) return;
        var norm = label.toLowerCase().replace(/ae/g, 'e');
        var exists = allTags.some(function(x) {
          return x.toLowerCase().replace(/ae/g, 'e') === norm;
        });
        if (!exists) allTags.push(label);
        if (validExtra.indexOf(label) === -1) validExtra.push(label);
      });
      localStorage.setItem(AUTO_TAGS_KEY, JSON.stringify(validExtra));
    } catch (e) { /* localStorage unavailable or corrupt */ }
  }

  function saveStoredNewTags(newTags) {
    try {
      var raw = localStorage.getItem(AUTO_TAGS_KEY);
      var arr = raw ? JSON.parse(raw) : [];
      newTags.forEach(function(t) {
        var clean = labelizeTag(t);
        if (!clean) return;
        var words = clean.split(/\s+/).filter(Boolean);
        if (words.length < 1 || words.length > 2) return;
        if (arr.indexOf(clean) === -1) arr.push(clean);
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
        populateTopicFilter();
        if (currentSearch) performSearch();
      } else {
        skipped += 1;
      }
      ingestBooks(books, i + 1, syncTime, skipped);
    });
  }

  function extractHtmlText(container) {
    if (!container) return '';
    try {
      var clone = container.cloneNode(true);
      var bad = clone.querySelectorAll('script, style, noscript, nav, header, footer');
      Array.prototype.forEach.call(bad, function(el) { el.remove(); });
      var brs = clone.querySelectorAll('br');
      Array.prototype.forEach.call(brs, function(br) {
        br.replaceWith('\n');
      });
      var blockTags = clone.querySelectorAll('p, tr, div, li, h1, h2, h3, h4, h5, h6, th, td, blockquote');
      Array.prototype.forEach.call(blockTags, function(b) {
        b.insertAdjacentText('afterend', '\n\n');
      });
      return clone.textContent || '';
    } catch (e) {
      return container.textContent || '';
    }
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
                var text = extractHtmlText(content);
                var title = (content.querySelector('h3, h4, .ccnMdlHeading') || {}).textContent || '';
                if (title && !/login\b/i.test(title)) text = title.replace(/^-?\s*/, '') + '\n\n' + text;
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
      if (/^(table of contents|chapter\s*\d+|references|appendix|page\s*\d+)\b/i.test(clean)) return;

      // Avoid giant unbounded cards: split long blocks by sentence boundary
      if (clean.length > 550) {
        var sentences = clean.split(/(?<=[.!?])\s+(?=[A-Z0-9])/);
        sentences.forEach(function(sent) {
          var sc = sent.trim();
          if (sc.length >= 25 && sc.length <= 550) {
            var k = sc.toLowerCase().slice(0, 120);
            if (!seen[k]) {
              seen[k] = true;
              phrases.push(sc);
            }
          }
        });
        return;
      }

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
    litre:1, litres:1, conditions:1, diagnose:1, major:1, minute:1, oral:1, agents:1,
    // fourth-pass non-medical / administrative / grammar words
    again:1, appear:1, appears:1, appeared:1, appearing:1, imminent:1, planned:1,
    expected:1, likely:1, unlikely:1, possible:1, impossible:1, general:1, overall:1,
    standard:1, common:1, following:1, ensure:1, ensuring:1, review:1, comprehensive:1,
    historical:1, prior:1, factor:1, factors:1, section:1, sections:1, table:1,
    figure:1, report:1, reports:1, chapter:1, page:1, number:1, total:1, rate:1, rates:1
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

  // Action verbs commonly starting clinical recommendation clauses that must be stripped from tags
  var ACTION_VERBS = Object.freeze({
    assess:1, assessing:1, assessment:1, assessments:1,
    screen:1, screening:1, screenings:1,
    evaluate:1, evaluating:1, evaluation:1,
    examine:1, examining:1, examination:1,
    perform:1, performing:1, performance:1,
    provide:1, providing:1, provision:1,
    offer:1, offering:1,
    consider:1, considering:1, consideration:1,
    determine:1, determining:1, determination:1,
    check:1, checking:1,
    measure:1, measuring:1, measurement:1, measurements:1,
    monitor:1, monitoring:1,
    identify:1, identifying:1, identification:1,
    administer:1, administering:1, administration:1,
    advise:1, advising:1, advice:1,
    recommend:1, recommending:1, recommendation:1, recommendations:1,
    manage:1, managing:1, management:1,
    treat:1, treating:1, treatment:1,
    discuss:1, discussing:1, discussion:1,
    prevent:1, preventing:1, prevention:1,
    reduce:1, reducing:1, reduction:1,
    avoid:1, avoiding:1, avoidance:1,
    ensure:1, ensuring:1,
    inform:1, informing:1, information:1,
    apply:1, applying:1, application:1,
    cannot:1, tolerate:1, tolerated:1, tolerating:1, tolerance:1,
    affect:1, affects:1, affected:1, affecting:1, effect:1, effects:1,
    cause:1, causes:1, causing:1, result:1, resulting:1,
    require:1, requires:1, requiring:1, indicate:1, indicates:1, indicating:1
  });

  function cleanCandidateTag(tag) {
    if (!tag) return '';
    var words = String(tag).trim().split(/\s+/).filter(Boolean);
    while (words.length > 0 && (ACTION_VERBS[words[0].toLowerCase()] || GENERIC_WORDS[words[0].toLowerCase()])) {
      words.shift();
    }
    while (words.length > 0 && (ACTION_VERBS[words[words.length - 1].toLowerCase()] || GENERIC_WORDS[words[words.length - 1].toLowerCase()])) {
      words.pop();
    }
    if (!words.length) return '';
    // Strictly allow at most 2 words per user instruction
    if (words.length > 2) {
      words = words.slice(-2);
    }
    if (words.some(function(w) { return ACTION_VERBS[w.toLowerCase()] || GENERIC_WORDS[w.toLowerCase()]; })) {
      return '';
    }
    return words.join(' ');
  }

  // Reject any candidate already covered by a tag in the search library
  function coveredByExistingTag(key) {
    return allTags.some(function(x) {
      return tagOverlap(key, x);
    });
  }

  function labelizeTag(s) {
    var cleaned = cleanCandidateTag(s);
    if (!cleaned) return '';
    return cleaned.split(' ').map(function(w) {
      if (isAbbreviation(w)) return w;
      return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
    }).join(' ');
  }

  function extractNewTags(phrases) {
    if (!phrases || !phrases.length) return [];
    var uniCount = {}, biCount = {}, uniLabel = {}, uniOrig = {}, biLabel = {};

    phrases.forEach(function(p) {
      var text = String(p);
      var tokens = [], offsets = [];
      var re = /[A-Za-z]+(?:'\w+)?/g, m;
      while ((m = re.exec(text)) !== null) {
        tokens.push(m[0]);
        offsets.push(m.index);
      }
      var seenU = {}, seenB = {};
      for (var i = 0; i < tokens.length; i++) {
        var t1 = tokens[i], l1 = t1.toLowerCase();

        // Unigram candidate (single medical term, e.g. Erythromycin)
        if (isStrongWord(t1) && !ACTION_VERBS[l1] && !seenU[l1] && !coveredByExistingTag(l1)) {
          seenU[l1] = true;
          uniCount[l1] = (uniCount[l1] || 0) + 1;
          if (!uniLabel[l1]) uniLabel[l1] = t1;
          if (!uniOrig[l1]) uniOrig[l1] = t1;
        }

        // Bigram candidate (strictly 2 words, e.g. Neonatal Morbidity, Cervical Dilatation)
        if (i + 1 >= tokens.length) continue;
        var gap1 = text.slice(offsets[i] + t1.length, offsets[i + 1]);
        if (NGRAM_BREAK.test(gap1)) continue;

        var t2 = tokens[i + 1], l2 = t2.toLowerCase();
        if (validNgram([t1, t2])) {
          var cleanToks = [t1, t2];
          while (cleanToks.length > 1 && (ACTION_VERBS[cleanToks[0].toLowerCase()] || GENERIC_WORDS[cleanToks[0].toLowerCase()])) {
            cleanToks.shift();
          }
          if (cleanToks.length === 2) {
            var key2 = cleanToks.map(function(x) { return x.toLowerCase(); }).join(' ');
            if (!seenB[key2] && !coveredByExistingTag(key2)) {
              seenB[key2] = true;
              biCount[key2] = (biCount[key2] || 0) + 1;
              if (!biLabel[key2]) biLabel[key2] = cleanToks.join(' ');
            }
          }
        }
      }
    });

    function validNgram(toks) {
      var lower = toks.map(function(t) { return t.toLowerCase(); });
      while (lower.length > 1 && ACTION_VERBS[lower[0]]) {
        lower.shift();
      }
      if (lower.length !== 2) return false;
      var joint = lower.join(' ');
      var anyStrong = lower.some(isStrongWord);
      var okLength = joint.length >= 8;
      var allOk = lower.every(function(lc) {
        return lc.length >= 3 && !GENERIC_WORDS[lc];
      });
      return okLength && allOk && anyStrong;
    }

    var candidates = [];
    Object.keys(uniCount).forEach(function(k) {
      if (uniCount[k] >= 2 && (/^[A-Z]/.test(uniOrig[k]) || uniCount[k] >= 3)) {
        candidates.push({ label: labelizeTag(uniLabel[k]), score: uniCount[k] * 10 });
      }
    });
    Object.keys(biCount).forEach(function(k) {
      if (biCount[k] >= 2) candidates.push({ label: labelizeTag(biLabel[k]), score: biCount[k] * 22 + 11 });
    });

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

  // Suggested keywords click listener in initial state
  Array.prototype.forEach.call(document.querySelectorAll('[data-search-chip]'), function(chip) {
    chip.addEventListener('click', function() {
      var word = chip.getAttribute('data-search-chip');
      searchInput.value = word;
      currentSearch = word;
      clearBtn.hidden = false;
      pushQueryState(word);
      performSearch();
    });
  });

  searchInput.addEventListener('input', function(e) {
    currentSearch = e.target.value;
    clearBtn.hidden = !currentSearch;
    if (selectedTag) clearTagSelection();
    scheduleQueryStateUpdate(currentSearch);
    performSearch();
  });

  clearBtn.addEventListener('click', function() {
    searchInput.value = '';
    currentSearch = '';
    clearBtn.hidden = true;
    if (selectedTag) clearTagSelection();
    selectedTopic = 'all';
    selectedStrength = 'all';
    if (topicFilter) topicFilter.value = 'all';
    if (strengthPillsContainer) {
      Array.prototype.forEach.call(strengthPillsContainer.querySelectorAll('.filter-pill'), function(p) {
        var isAll = p.getAttribute('data-strength') === 'all';
        p.classList.toggle('active', isAll);
        p.setAttribute('aria-pressed', isAll ? 'true' : 'false');
      });
    }
    updateFiltersToggleLabel();
    pushQueryState('');
    performSearch();
    searchInput.focus();
  });

  searchInput.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') {
      clearBtn.click();
    }
  });

  // Browser back/forward restores query from URL
  window.addEventListener('popstate', function() {
    var q = readQueryFromUrl();
    searchInput.value = q;
    currentSearch = q;
    clearBtn.hidden = !q;
    if (q) {
      if (selectedTag) clearTagSelection();
      performSearch();
    } else {
      clearTagSelection();
      selectedTopic = 'all';
      selectedStrength = 'all';
      if (topicFilter) topicFilter.value = 'all';
      if (strengthPillsContainer) {
        Array.prototype.forEach.call(strengthPillsContainer.querySelectorAll('.filter-pill'), function(p) {
          var isAll = p.getAttribute('data-strength') === 'all';
          p.classList.toggle('active', isAll);
          p.setAttribute('aria-pressed', isAll ? 'true' : 'false');
        });
      }
      updateFiltersToggleLabel();
      showInitialState();
    }
  });

  // ---- Clinician workflow controls: copy, share, print ----

  // Copy helpers with a safe fallback for environments without the async
  // Clipboard API or where a permissions prompt rejects the write.
  function copyToClipboard(text) {
    function legacyCopy() {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.top = '-9999px';
      ta.style.left = '0';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      ta.setSelectionRange(0, text.length);
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      document.body.removeChild(ta);
      return ok;
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).then(
        function() { return true; },
        function() { return legacyCopy(); }
      );
    }
    try { return Promise.resolve(legacyCopy()); } catch (e) { return Promise.resolve(false); }
  }

  function copyPhrase(btn) {
    var text = btn.getAttribute('data-copy-text') || '';
    var original = btn.getAttribute('data-copy-label') || 'Copy';
    copyToClipboard(text).then(function(ok) {
      if (ok) {
        btn.textContent = 'Copied';
        btn.setAttribute('aria-label', 'Copied to clipboard');
        announce('Copied recommendation to clipboard.');
      } else {
        btn.textContent = 'Copy failed';
        btn.setAttribute('aria-label', 'Copy failed. Select the recommendation text and copy it manually.');
        announce('Copying failed. Select the recommendation text and copy it manually.');
      }
      clearTimeout(btn._resetTimer);
      btn._resetTimer = setTimeout(function() {
        btn.textContent = original;
        btn.removeAttribute('aria-label');
      }, 2500);
    });
  }

  function bindCopyButtons() {
    Array.prototype.forEach.call(resultsContainer.querySelectorAll('.copy-btn'), function(btn) {
      btn.addEventListener('click', function() { copyPhrase(btn); });
    });
  }

  var _toolbarTimer = null;
  function showToolbarFeedback(msg) {
    if (!toolbarFeedback) return;
    toolbarFeedback.textContent = msg;
    toolbarFeedback.hidden = false;
    if (_toolbarTimer) clearTimeout(_toolbarTimer);
    _toolbarTimer = setTimeout(function() { toolbarFeedback.hidden = true; }, 3000);
  }

  function currentShareUrl() {
    var q = (searchInput.value || '').trim();
    var url = window.location.origin + window.location.pathname;
    if (q) url += '?q=' + encodeURIComponent(q);
    return url;
  }

  if (copySearchLinkBtn) {
    copySearchLinkBtn.addEventListener('click', function() {
      var url = currentShareUrl();
      copyToClipboard(url).then(function(ok) {
        if (ok) {
          showToolbarFeedback('Link copied for this search.');
          announce('Link to this search copied to the clipboard.');
        } else {
          showToolbarFeedback('Could not copy automatically — copy the address from the browser bar (Ctrl+C / Cmd+C).');
          announce('Link copy failed. Copy the address from the browser bar.');
        }
      });
    });
  }

  if (printBtn) {
    printBtn.addEventListener('click', function() {
      window.print();
    });
  }

  // Initialize
  loadGuidelines();

  // Periodically check for new guidelines while the app stays open
  setInterval(function() {
    if (guidelinesData) syncWithLms();
  }, 30 * 60 * 1000);
})();