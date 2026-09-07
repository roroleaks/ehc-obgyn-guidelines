// Simulate the result-tag click flow logic
const state = { currentSearch: '', selectedTag: null, inputValue: '' };

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, function(c) {
    var m = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
    return m[c];
  });
}

// Replicate renderResults tag HTML generation
function tagsHtml(tags) {
  return tags.map(function(t) { return '<button type="button" class="result-tag" data-search-tag="' + escapeHtml(t) + '">' + escapeHtml(t) + '</button>'; }).join('');
}

const html = tagsHtml(['Oxytocin', 'Preeclampsia', 'Eclampsia', 'PPH', 'Uterine Atony', 'Tranexamic Acid', 'Carbetocin', '4Ts', 'Retained Placenta', 'Ergometrine']);
console.log('generated tags html:', html);
console.log('has +N more removed:', html.indexOf('more') === -1);
console.log('total tags shown (no cap):', (html.match(/data-search-tag=/g) || []).length);

// simulate click on "Oxytocin" tag
const tag = 'Oxytocin';
state.inputValue = tag;
state.currentSearch = tag;
state.selectedTag = null;
console.log('after click -> currentSearch =', state.currentSearch, '| inputValue =', state.inputValue, '| query:', state.currentSearch.toLowerCase());