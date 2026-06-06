// === Core: Selection Popup ===
// Plugins register actions via window.__core__.selection.addAction({ label, icon, handler })
// The core creates one popup that appears on text selection.
(function() {
  var actions = [];
  var popup = null;
  var currentContext = null;

  var core = window.__core__ = window.__core__ || {};
  core.selection = core.selection || {};

  core.selection.addAction = function(action) {
    if (action.id) {
      var existingIdx = actions.findIndex(function(item) { return item.id === action.id; });
      if (existingIdx !== -1) actions.splice(existingIdx, 1, action);
      else actions.push(action);
    } else {
      actions.push(action);
    }
    if (popup) rebuildPopupButtons(currentContext);
  };

  core.selection.getContext = function() {
    return currentContext;
  };

  function getContextAroundSelection() {
    var sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return null;

    var range = sel.getRangeAt(0);
    var selectedText = sel.toString().trim();
    if (!selectedText) return null;

    var container = range.commonAncestorContainer;
    var element = container.nodeType === Node.TEXT_NODE ? container.parentElement : container;
    var rootEl = element && element.closest ? element.closest('.markdown-content, .core-panel') : null;
    if (!rootEl) return null;

    var contextBefore = '';
    try {
      var beforeRange = document.createRange();
      beforeRange.setStart(rootEl, 0);
      beforeRange.setEnd(range.startContainer, range.startOffset);
      contextBefore = beforeRange.toString();
      if (contextBefore.length > 500) {
        contextBefore = '...' + contextBefore.slice(-500);
      }
    } catch (_) {}

    var contextAfter = '';
    try {
      var afterRange = document.createRange();
      afterRange.setStart(range.endContainer, range.endOffset);
      afterRange.setEnd(rootEl, rootEl.childNodes.length);
      contextAfter = afterRange.toString();
      if (contextAfter.length > 500) {
        contextAfter = contextAfter.slice(0, 500) + '...';
      }
    } catch (_) {}

    return {
      selectedText: selectedText,
      contextBefore: contextBefore,
      contextAfter: contextAfter,
      chapterFile: core.state.currentFile,
      source: rootEl.classList.contains('markdown-content') ? 'article' : 'panel',
    };
  }

  function buildPopup() {
    if (popup) return;
    popup = document.createElement('div');
    popup.className = 'selection-popup';
    document.body.appendChild(popup);
    rebuildPopupButtons(currentContext);
  }

  function rebuildPopupButtons(ctx) {
    if (!popup) return 0;
    var visibleActions = actions.filter(function(action) {
      return !action.visible || action.visible(ctx);
    });
    popup.innerHTML = '';
    visibleActions.forEach(function(action) {
      var btn = document.createElement('button');
      if (action.id) btn.dataset.selectionActionId = action.id;
      btn.innerHTML = (action.icon || '') + ' ' + (action.label || '');
      btn.addEventListener('click', function(e) {
        e.stopPropagation();
        if (action.handler) action.handler(currentContext);
        popup.classList.remove('visible');
      });
      popup.appendChild(btn);
    });
    return visibleActions.length;
  }

  document.addEventListener('mouseup', function(e) {
    setTimeout(function() {
      if (actions.length === 0) return;

      var ctx = getContextAroundSelection();
      if (!ctx) {
        if (popup) popup.classList.remove('visible');
        currentContext = null;
        return;
      }

      currentContext = ctx;
      buildPopup();
      if (rebuildPopupButtons(ctx) === 0) {
        popup.classList.remove('visible');
        return;
      }

      var sel = window.getSelection();
      var range = sel.getRangeAt(0);
      var rect = range.getBoundingClientRect();

      popup.style.left = (rect.left + rect.width / 2) + 'px';
      popup.style.top = (rect.top + window.scrollY) + 'px';
      popup.classList.add('visible');
    }, 10);
  });

  document.addEventListener('mousedown', function(e) {
    if (popup && !popup.contains(e.target)) {
      popup.classList.remove('visible');
    }
  });
})();
