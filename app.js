(function() {
  'use strict';

  let guidelinesData = null;
  let allPhrases = [];
  let allTags = [];
  let currentSearch = '';
  let selectedTag = null;

  const searchInput = document.getElementById('search-input');
  const clearBtn = document.getElementById('clear-search');
  const tagsContainer = document.getElementById('tags-container');
  const resultsContainer = document.getElementById('results-container');
  const resultsStats = document.getElementById('results-stats');
  const noResults = document.getElementById('no-results');
  const searchTermDisplay = document.getElementById('search-term-display');
  const initialState = document.getElementById('initial-state');
  const hintTagsEl = document.querySelector('.hint-tags');

  async function loadGuidelines() {
    try {
      const res = await fetch('guidelines.json', { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      guidelinesData = await res.json();
      processData();
      renderTags();
      updateHintTags();
    } catch (err) {
      console.error('Failed to load guidelines:', err);
      resultsContainer.innerHTML = `<div class="no-results" style="text-align:center;padding:2rem;color:var(--color-text-muted)"><p>Failed to load guidelines data. Please refresh or <a href="https://lms.ehc.gov.eg/lms/course/view.php?id=38" target="_blank" rel="noopener">view on EHC LMS</a>.</p></div>`;
    }
  }

  function processData() {
    allPhrases = [];
    allTags = new Set();

    guidelinesData.guidelines.forEach(g => {
      g.phrases.forEach((phrase, idx) => {
        allPhrases.push({
          id: `${g.id}-${idx}`,
          guidelineId: g.id,
          guidelineTitle: g.title,
          guidelineBookId: g.bookId,
          phrase: phrase,
          tags: g.tags
        });
        g.tags.forEach(t => allTags.add(t));
      });
    });

    allTags = Array.from(allTags).sort((a, b) => a.localeCompare(b));
  }

  function renderTags() {
    tagsContainer.innerHTML = allTags.map(tag => `
      <button
        type="button"
        class="tag-btn"
        data-tag="${escapeHtml(tag)}"
        role="option"
        aria-selected="false"
        tabindex="0"
      >${escapeHtml(tag)}</button>
    `).join('');

    tagsContainer.querySelectorAll('.tag-btn').forEach(btn => {
      btn.addEventListener('click', () => handleTagClick(btn));
      btn.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleTagClick(btn); }
      });
    });
  }

  function updateHintTags() {
    const sampleTags = allTags.slice(0, 8).join(', ');
    if (hintTagsEl) hintTagsEl.textContent = sampleTags;
  }

  function handleTagClick(btn) {
    const tag = btn.dataset.tag;
    const isSelected = btn.classList.contains('selected');

    tagsContainer.querySelectorAll('.tag-btn').forEach(b => {
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
    searchInput.focus();
  }

  function performSearch() {
    const query = currentSearch.trim().toLowerCase();
    const showInitial = !query && !selectedTag;

    if (showInitial) {
      showInitialState();
      return;
    }

    hideInitialState();

    let results = allPhrases;

    if (query) {
      results = results.filter(item => item.phrase.toLowerCase().includes(query));
    }

    if (selectedTag && !query.includes(selectedTag.toLowerCase())) {
      results = results.filter(item => item.tags.some(t => t.toLowerCase() === selectedTag.toLowerCase()));
    }

    renderResults(results, query);
  }

  function renderResults(results, query) {
    if (results.length === 0) {
      resultsContainer.innerHTML = '';
      resultsStats.hidden = true;
      noResults.hidden = false;
      searchTermDisplay.textContent = query || selectedTag || '';
      return;
    }

    noResults.hidden = true;

    resultsStats.hidden = false;
    resultsStats.innerHTML = `
      <span aria-hidden="true">📋</span>
      <span>${results.length} phrase${results.length !== 1 ? 's' : ''} found</span>
      ${query ? `<span>for "${escapeHtml(query)}"</span>` : ''}
      ${selectedTag && !query.includes(selectedTag.toLowerCase()) ? `<span>+ tag: ${escapeHtml(selectedTag)}</span>` : ''}
    `;

    resultsContainer.innerHTML = results.map((item, idx) => `
      <article class="result-card" style="animation-delay: ${idx * 30}ms" data-guideline="${escapeHtml(item.guidelineId)}">
        <header class="result-header">
          <span class="result-guideline">
            <a href="https://lms.ehc.gov.eg/lms/mod/book/view.php?id=${item.guidelineBookId}" target="_blank" rel="noopener">${escapeHtml(item.guidelineTitle)}</a>
          </span>
        </header>
        <p class="result-phrase">${highlightText(item.phrase, query)}</p>
        <div class="result-tags">
          ${item.tags.slice(0, 6).map(t => `<span class="result-tag">${escapeHtml(t)}</span>`).join('')}
          ${item.tags.length > 6 ? `<span class="result-tag">+${item.tags.length - 6} more</span>` : ''}
        </div>
      </article>
    `).join('');
  }

  function highlightText(text, query) {
    if (!query) return escapeHtml(text);
    const escaped = escapeHtml(text);
    const regex = new RegExp(`(${escapeRegex(query)})`, 'gi');
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
    return String(str).replace(/[&<>"']/g, c => ({
      '&': '&', '<': '<', '>': '>', '"': '"', "'": '''
    })[c]);
  }

  function escapeRegex(str) {
    return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  // Event Listeners
  searchInput.addEventListener('input', e => {
    currentSearch = e.target.value;
    clearBtn.hidden = !currentSearch;
    selectedTag = null;
    tagsContainer.querySelectorAll('.tag-btn').forEach(b => {
      b.classList.remove('selected');
      b.setAttribute('aria-selected', 'false');
    });
    performSearch();
  });

  clearBtn.addEventListener('click', () => {
    searchInput.value = '';
    currentSearch = '';
    clearBtn.hidden = true;
    selectedTag = null;
    tagsContainer.querySelectorAll('.tag-btn').forEach(b => {
      b.classList.remove('selected');
      b.setAttribute('aria-selected', 'false');
    });
    performSearch();
    searchInput.focus();
  });

  searchInput.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      clearBtn.click();
    }
  });

  // Initialize
  loadGuidelines();
})();