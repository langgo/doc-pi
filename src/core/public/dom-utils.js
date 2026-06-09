// === Core: DOM and Markdown helpers ===
// Plugins use window.__core__.dom/rendering helpers instead of owning duplicate implementations.
(function() {
  var core = window.__core__ = window.__core__ || {};
  core.dom = core.dom || {};

  core.dom.escapeHtml = function(text) {
    return String(text || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  };

  core.dom.renderMarkdown = function(text) {
    if (typeof marked !== 'undefined') return marked.parse(text);
    // Fallback: plain text with line breaks
    return core.dom.escapeHtml(text).replace(/\n/g, '<br>');
  };

  core.dom.renderInlineMarkdown = function(text) {
    if (typeof marked !== 'undefined') return marked.parseInline(text);
    return core.dom.escapeHtml(text);
  };
})();
