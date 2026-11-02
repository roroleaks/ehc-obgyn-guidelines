'use strict';
const assert = require('assert');

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, function(c) {
    var m = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
    return m[c];
  });
}

function escapeRegex(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function wordForms(w) {
  var forms = [w];
  if (w.endsWith('s') && w.length > 3) forms.push(w.slice(0, -1));
  if (w.endsWith('es') && w.length > 4) forms.push(w.slice(0, -2));
  return forms;
}

function variantifyQuery(w) {
  var v = [];
  if (w === 'hemorrhage') v.push('haemorrhage');
  if (w === 'haemorrhage') v.push('hemorrhage');
  if (w === 'cesarean') v.push('caesarean');
  if (w === 'caesarean') v.push('cesarean');
  return v;
}

function highlightText(text, query) {
  var escaped = escapeHtml(text);
  if (!query) return escaped;

  var q = String(query).trim();
  if (!q) return escaped;

  var patterns = [];
  function pushPattern(p) {
    if (p && patterns.indexOf(p) === -1) patterns.push(p);
  }

  // 1. Unicode-aware tokenization: extract words & component tokens using \p{L}\p{N}
  var rawWords = q.toLowerCase().split(/\s+/).filter(Boolean);
  var unicodeTokens = q.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  if (!rawWords.length && !unicodeTokens.length) return escaped;

  // Greek letter equivalence map
  var GREEK_MAP = { 'β': 'beta', 'beta': 'β', 'α': 'alpha', 'alpha': 'α' };

  function tokenPattern(t) {
    var alt = GREEK_MAP[t];
    if (alt) {
      return '(?:' + escapeRegex(t) + '|' + escapeRegex(alt) + ')';
    }
    return escapeRegex(t);
  }

  // 2. Compound expressions from Unicode tokens (e.g., β-hCG, low-molecular-weight)
  if (unicodeTokens.length > 1) {
    var compoundParts = unicodeTokens.map(tokenPattern);
    pushPattern(compoundParts.join('[\\s\\-]+'));
  }

  // 3. Multi-word expression patterns from whitespace-separated words
  if (rawWords.length > 1) {
    var formLists = rawWords.map(wordForms);
    if (rawWords.length === 2) {
      formLists[0].forEach(function(w1) {
        formLists[1].forEach(function(w2) {
          pushPattern(tokenPattern(w1) + '[\\s\\-]+' + tokenPattern(w2));
        });
      });
    } else {
      pushPattern(escapeRegex(q));
    }
  }

  // 4. Component tokens & spelling variants
  unicodeTokens.forEach(function(tok) {
    if (GREEK_MAP[tok]) {
      pushPattern(tokenPattern(tok));
    } else if (tok.length >= 2 || unicodeTokens.length === 1) {
      pushPattern(escapeRegex(tok));
    }
    var variants = variantifyQuery(tok);
    variants.forEach(function(v) {
      if (v && v.length >= 3) pushPattern(escapeRegex(v));
    });
    if (tok.indexOf('ae') !== -1) {
      pushPattern(escapeRegex(tok.replace(/ae/g, 'e')));
    } else if (tok.indexOf('e') !== -1) {
      pushPattern(escapeRegex(tok.replace('e', 'ae')));
    }
  });

  rawWords.forEach(function(w) {
    if (w.length >= 2) {
      pushPattern(escapeRegex(w));
      var variants = variantifyQuery(w);
      variants.forEach(function(v) {
        if (v && v.length >= 3) pushPattern(escapeRegex(v));
      });
    }
  });

  // Sort patterns by length descending so longer contiguous expressions match before single words
  patterns.sort(function(a, b) { return b.length - a.length; });

  if (!patterns.length) return escaped;

  var regex = new RegExp('(' + patterns.join('|') + ')', 'gi');
  return escaped.replace(regex, '<mark>$1</mark>');
}

// 1. Complete β-hCG and component fallback occurrence
const rBeta1 = highlightText('Urinary beta-human chorionic gonadotrophin (β-hCG) test should be performed', 'β-hCG');
assert(rBeta1.includes('<mark>β-hCG</mark>') || rBeta1.includes('<mark>beta</mark>'), 'β-hCG should be highlighted');

const rBeta2 = highlightText('Take 2 serum HCG measurements 48 hours apart', 'β-hCG');
assert(rBeta2.includes('<mark>HCG</mark>'), 'Fallback HCG occurrence should be highlighted');
console.log('PASS Unicode β-hCG highlighting');

// 2. Long multi-word expression cohesive highlighting
const rLong = highlightText('Preterm prelabor rupture of membranes is managed with erythromycin.', 'preterm prelabor rupture of membranes');
assert(rLong.includes('<mark>Preterm prelabor rupture of membranes</mark>') || rLong.includes('<mark>preterm prelabor rupture of membranes</mark>'), 'Long expression should be cohesively highlighted');
console.log('PASS long multi-word highlighting');

// 3. Escaped source text containing script payload
const rScript = highlightText('<script>alert("xss")</script> oxytocin 10 IU IV', 'oxytocin');
assert(rScript.includes('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;'), 'Source text must be HTML escaped');
assert(rScript.includes('<mark>oxytocin</mark>'), 'Target word must be highlighted');
console.log('PASS escaped-source highlighting');

// 4. Ordinary ASCII highlighting preservation
const rAscii = highlightText('Oxytocin 10 IU IV is recommended in the third stage.', 'oxytocin');
assert(rAscii.includes('<mark>Oxytocin</mark>'), 'Ordinary ASCII term must be highlighted');

console.log('ALL HIGHLIGHT TESTS PASSED');
