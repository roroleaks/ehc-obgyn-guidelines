function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, function(c) {
    var m = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
    return m[c];
  });
}
function escapeRegex(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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
console.log(highlightText('Oxytocin 10 IU IV is recommended in the third stage.', 'oxytocin'));
console.log(highlightText('Preeclampsia is diagnosed. Manage blood pressure.', 'preeclampsia blood'));
console.log(highlightText('The Robson ten group classification categorizes cesareans.', 'robson cesarean'));