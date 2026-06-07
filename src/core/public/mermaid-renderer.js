(function () {
  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  async function renderMermaid() {
    if (typeof mermaid === 'undefined') return;
    var diagrams = Array.from(document.querySelectorAll('.mermaid-container .mermaid'));
    for (var i = 0; i < diagrams.length; i += 1) {
      var diagram = diagrams[i];
      if (diagram.dataset.rendered || diagram.closest('.mermaid-error')) continue;
      var source = diagram.textContent || '';
      try {
        await mermaid.run({ nodes: [diagram] });
        diagram.dataset.rendered = '1';
      } catch (err) {
        var container = diagram.closest('.mermaid-container') || diagram;
        container.innerHTML = '<div class="mermaid-error" role="alert">' +
          '<strong>Mermaid diagram failed to render.</strong>' +
          '<pre><code>' + escapeHtml(source.trim()) + '</code></pre>' +
          '<small>' + escapeHtml(err && err.message ? err.message : 'Invalid Mermaid syntax') + '</small>' +
          '</div>';
      }
    }
  }

  mermaid.initialize({ startOnLoad: false });
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', renderMermaid);
  } else {
    renderMermaid();
  }
})();
