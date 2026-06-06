// === Core: Article source locator ===
// Plugins use window.__core__.article.locateText(context) to jump back to original article text.
(function() {
  var core = window.__core__ = window.__core__ || {};
  core.article = core.article || {};
  var annotationHandlers = Object.create(null);

  function normalizeFile(file) {
    try {
      return decodeURIComponent(file || '');
    } catch (_) {
      return file || '';
    }
  }

  function normalizeForMatch(text) {
    return (text || '').replace(/\s+/g, ' ').trim();
  }

  function appendNormalizedChar(state, ch, node, offset) {
    if (/\s/.test(ch)) {
      if (state.text && state.text[state.text.length - 1] !== ' ') {
        state.text += ' ';
        state.map.push({ node: node, offset: offset });
      }
      return;
    }
    state.text += ch;
    state.map.push({ node: node, offset: offset });
  }

  function buildNormalizedIndex(root) {
    var state = { text: '', map: [] };
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null, false);
    var node;
    while (node = walker.nextNode()) {
      for (var i = 0; i < node.textContent.length; i++) {
        appendNormalizedChar(state, node.textContent[i], node, i);
      }
    }
    if (state.text[state.text.length - 1] === ' ') {
      state.text = state.text.slice(0, -1);
      state.map.pop();
    }
    return state;
  }

  function findRange(root, context) {
    var selected = normalizeForMatch(context.selectedText);
    if (!selected) return null;

    var index = buildNormalizedIndex(root);
    var start = index.text.indexOf(selected);
    var beforeHint = normalizeForMatch(context.contextBefore || '').slice(-30);
    var afterHint = normalizeForMatch(context.contextAfter || '').slice(0, 30);

    while (start !== -1) {
      var end = start + selected.length;
      var before = index.text.slice(Math.max(0, start - 120), start);
      var after = index.text.slice(end, end + 120);
      if ((!beforeHint || before.indexOf(beforeHint) !== -1) && (!afterHint || after.indexOf(afterHint) !== -1)) {
        var startPos = index.map[start];
        var endPos = index.map[end - 1];
        if (!startPos || !endPos) return null;
        var range = document.createRange();
        range.setStart(startPos.node, startPos.offset);
        range.setEnd(endPos.node, endPos.offset + 1);
        return range;
      }
      start = index.text.indexOf(selected, start + 1);
    }
    return null;
  }

  function highlightRange(range) {
    if (window.CSS && CSS.highlights && window.Highlight) {
      CSS.highlights.set('core-source-highlight', new Highlight(range));
      setTimeout(function() {
        CSS.highlights.delete('core-source-highlight');
      }, 2200);
      return;
    }

    var mark = document.createElement('mark');
    mark.className = 'core-source-highlight active';
    try {
      range.surroundContents(mark);
      setTimeout(function() {
        var parent = mark.parentNode;
        while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
        parent.removeChild(mark);
        parent.normalize();
      }, 2200);
    } catch (_) {}
  }

  function getArticleRange(context) {
    if (!context || !context.selectedText) return null;
    var currentFile = core.state.currentFile;
    if (context.chapterFile && normalizeFile(context.chapterFile) !== normalizeFile(currentFile)) return null;

    var content = document.querySelector('.content-wrap .markdown-content');
    if (!content) return null;
    return findRange(content, context);
  }

  function unwrapAnnotation(el) {
    if (el.dataset && el.dataset.coreAnnotationId) {
      delete annotationHandlers[el.dataset.coreAnnotationId];
    }
    var parent = el.parentNode;
    if (!parent) return;
    while (el.firstChild) parent.insertBefore(el.firstChild, el);
    parent.removeChild(el);
    parent.normalize();
  }

  core.article.clearAnnotation = function(id) {
    if (!id) return;
    delete annotationHandlers[id];
    document.querySelectorAll('[data-core-annotation-id="' + id + '"]').forEach(unwrapAnnotation);
  };

  function isEmptyInlineShell(node) {
    return node &&
      node.nodeType === Node.ELEMENT_NODE &&
      node.matches &&
      node.matches('code,strong,em,a,b,i,span') &&
      node.children.length === 0 &&
      node.textContent === '';
  }

  function removeEmptyInlineShellsAround(node) {
    if (!node || !node.parentNode) return;
    var prev = node.previousSibling;
    while (isEmptyInlineShell(prev)) {
      var prevToRemove = prev;
      prev = prev.previousSibling;
      prevToRemove.remove();
    }
    var next = node.nextSibling;
    while (isEmptyInlineShell(next)) {
      var nextToRemove = next;
      next = next.nextSibling;
      nextToRemove.remove();
    }
    if (node.parentNode) node.parentNode.normalize();
  }

  core.article.annotateText = function(context, options) {
    options = options || {};
    if (options.id) core.article.clearAnnotation(options.id);

    var range = getArticleRange(context);
    if (!range) return false;

    var mark = document.createElement('mark');
    mark.className = options.className || 'core-article-annotation';
    if (options.id) mark.dataset.coreAnnotationId = options.id;
    if (options.title) mark.title = options.title;
    var attrs = options.attributes || {};
    Object.keys(attrs).forEach(function(key) {
      mark.dataset[key] = attrs[key];
    });
    if (options.onClick) {
      mark.tabIndex = 0;
      mark.setAttribute('role', 'button');
      if (options.id) {
        annotationHandlers[options.id] = {
          onClick: options.onClick,
          payload: options.payload || {},
        };
      }
    }

    try {
      mark.appendChild(range.extractContents());
      range.insertNode(mark);
      mark.normalize();
      removeEmptyInlineShellsAround(mark);
      return true;
    } catch (_) {
      return false;
    }
  };

  document.addEventListener('click', function(e) {
    var mark = e.target && e.target.closest ? e.target.closest('[data-core-annotation-id]') : null;
    if (!mark) return;
    var id = mark.dataset.coreAnnotationId;
    var handler = id && annotationHandlers[id];
    if (!handler) return;
    e.stopPropagation();
    handler.onClick(handler.payload || {}, mark);
  });

  document.addEventListener('keydown', function(e) {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    var mark = e.target && e.target.closest ? e.target.closest('[data-core-annotation-id]') : null;
    if (!mark) return;
    var id = mark.dataset.coreAnnotationId;
    var handler = id && annotationHandlers[id];
    if (!handler) return;
    e.preventDefault();
    handler.onClick(handler.payload || {}, mark);
  });

  core.article.locateText = function(context) {
    var range = getArticleRange(context);
    if (!range) return false;

    var rect = range.getBoundingClientRect();
    if (rect && (rect.top || rect.left)) {
      window.scrollTo({ top: rect.top + window.scrollY - window.innerHeight / 2, behavior: 'smooth' });
    } else if (range.startContainer.parentElement) {
      range.startContainer.parentElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    highlightRange(range);
    return true;
  };
})();
