// === Core: shared page state ===
(function() {
  var core = window.__core__ = window.__core__ || {};
  core.state = core.state || {};
  core.dom = core.dom || {};
  core.selection = core.selection || {};
  core.floating = core.floating || {};
  core.panel = core.panel || {};
  core.article = core.article || {};

  function decodePathSegment(value) {
    try {
      return decodeURIComponent(value || '');
    } catch (_) {
      return value || '';
    }
  }

  core.state.currentFile = decodePathSegment(window.location.pathname.slice(1)) || 'README.md';
})();
