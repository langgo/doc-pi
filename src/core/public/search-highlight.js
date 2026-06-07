(function () {
  var params = new URLSearchParams(window.location.search || '');
  window.docPiApplySearchHighlight = null;
  var query = (params.get('q') || '').trim();
  if (!query) return;
  query = query.split(/\s+/).filter(function (token) { return token.toLowerCase().indexOf('tag:') !== 0; }).join(' ').trim();
  if (!query) return;

  var root = document.querySelector('.markdown-content');
  if (!root) return;

  function findTextNode(node) {
    if (!query) return null;
    var lower = query.toLowerCase();
    var walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT, {
      acceptNode: function (textNode) {
        if (!textNode.nodeValue || !textNode.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
        var parent = textNode.parentElement;
        if (!parent || parent.closest('script, style, code, pre, .doc-search-hit')) return NodeFilter.FILTER_REJECT;
        return textNode.nodeValue.toLowerCase().includes(lower) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      },
    });
    return walker.nextNode();
  }

  function highlight(textNode) {
    var value = textNode.nodeValue;
    var index = value.toLowerCase().indexOf(query.toLowerCase());
    if (index < 0) return null;

    var before = document.createTextNode(value.slice(0, index));
    var mark = document.createElement('mark');
    mark.className = 'doc-search-hit';
    mark.textContent = value.slice(index, index + query.length);
    var after = document.createTextNode(value.slice(index + query.length));
    var parent = textNode.parentNode;
    parent.insertBefore(before, textNode);
    parent.insertBefore(mark, textNode);
    parent.insertBefore(after, textNode);
    parent.removeChild(textNode);
    return mark;
  }

  window.docPiApplySearchHighlight = function () {
    runHighlight();
  };

  function clearHighlights() {
    document.querySelectorAll('.doc-search-hit').forEach(function (mark) {
      var parent = mark.parentNode;
      if (!parent) return;
      parent.replaceChild(document.createTextNode(mark.textContent || ''), mark);
      parent.normalize();
    });
  }

  function clearLineTargets() {
    document.querySelectorAll('.doc-search-line-target.line-target-active').forEach(function (target) {
      target.classList.remove('line-target-active');
    });
    if (document.activeElement && document.activeElement.classList && document.activeElement.classList.contains('doc-search-line-target')) {
      document.activeElement.blur();
    }
  }

  window.docPiClearSearchHighlights = clearHighlights;
  window.docPiClearSearchLineTargets = clearLineTargets;

  function focusLineTarget() {
    clearLineTargets();
    if (!/^#L\d+$/.test(window.location.hash || '')) return;
    var target = document.getElementById(window.location.hash.slice(1));
    if (!target || !target.classList.contains('doc-search-line-target')) return;
    target.classList.add('line-target-active');
    target.focus({ preventScroll: true });
  }

  function runHighlight() {
    focusLineTarget();
    var textNode = findTextNode(root);
    var mark = textNode ? highlight(textNode) : null;
    if (mark) {
      mark.scrollIntoView({ block: 'center', inline: 'nearest' });
    }
  }

  document.addEventListener('DOMContentLoaded', runHighlight);
  window.addEventListener('load', runHighlight);
  window.addEventListener('hashchange', runHighlight);
  window.addEventListener('popstate', runHighlight);
  runHighlight();
  setTimeout(runHighlight, 0);
  setTimeout(runHighlight, 250);
})();
