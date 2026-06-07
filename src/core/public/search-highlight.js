(function () {
  var params = new URLSearchParams(window.location.search || '');
  var query = (params.get('q') || '').trim();
  if (!query) return;

  var root = document.querySelector('.markdown-content');
  if (!root) return;

  function findTextNode(node) {
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

  var textNode = findTextNode(root);
  var mark = textNode ? highlight(textNode) : null;
  if (mark) {
    mark.scrollIntoView({ block: 'center', inline: 'nearest' });
  }
})();
