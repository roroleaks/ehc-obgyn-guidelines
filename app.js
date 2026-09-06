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
      return '<article class="result-card" style="animation-delay:' + (idx * 20) + 'ms">' +
        '<header class="result-header">' +
          '<span class="result-guideline"><a href="https://lms.ehc.gov.eg/lms/mod/book/view.php?id=' + item.guidelineBookId + '" target="_blank" rel="noopener">' + escapeHtml(item.guidelineTitle) + '</a></span>' +
        '</header>' +
        '<p class="result-phrase">' + highlightText(item.phrase, query) + '</p>' +
        '<div class="result-tags">' +
          item.tags.slice(0, 8).map(function(t) { return '<span class="result-tag">' + escapeHtml(t) + '</span>'; }).join('') +
          (item.tags.length > 8 ? '<span class="result-tag">+' + (item.tags.length - 8) + ' more</span>' : '') +
        '</div>' +
      '</article>';
    }).join('');
  }

  function highlightText(text, query) {
    var escaped = escapeHtml(text);
    if (!query) return escaped;
    var words = query.split(/\s+/).filter(Boolean).map(escapeRegex);
    if (!words.length) return escaped;

    var pattern;
    if (words.length > 1) {
      // Highlight the full contiguous phrase if present, plus each individual word
      pattern = escapeRegex(query.trim()) + '|' + words.join('|');
    } else {
      pattern = words[0];
    }

    var regex = new RegExp('(' + pattern + ')', 'gi');
    return escaped.replace(regex, '<mark>$1</mark>');
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
})();