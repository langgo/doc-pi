(function () {
  var input = document.querySelector('.doc-search-input');
  var statusEl = document.querySelector('.doc-search-status');
  var resultsEl = document.querySelector('.doc-search-results');
  if (!input || !statusEl || !resultsEl) return;

  var activeRequest = 0;
  var timer = null;

  function clearResults(message) {
    resultsEl.innerHTML = '';
    statusEl.textContent = message || '';
  }

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function renderResults(results) {
    resultsEl.innerHTML = '';
    if (!results.length) {
      statusEl.textContent = '无匹配结果';
      return;
    }
    statusEl.textContent = results.length + ' 个结果';
    for (var i = 0; i < results.length; i += 1) {
      var result = results[i];
      var link = document.createElement('a');
      link.className = 'doc-search-result';
      link.href = '/' + encodeURIComponent(result.file);
      link.innerHTML = '<span class="doc-search-title">' + escapeHtml(result.title) + '</span>' +
        '<span class="doc-search-meta">' + escapeHtml(result.file) + ':' + result.line + '</span>' +
        '<span class="doc-search-snippet">' + escapeHtml(result.snippet) + '</span>';
      resultsEl.appendChild(link);
    }
  }

  async function runSearch(query) {
    var requestId = ++activeRequest;
    if (!query.trim()) {
      clearResults('');
      return;
    }
    statusEl.textContent = '搜索中…';
    try {
      var res = await fetch('/api/search?q=' + encodeURIComponent(query));
      var body = await res.json();
      if (requestId !== activeRequest) return;
      if (!res.ok) {
        clearResults(body.error || '搜索失败');
        return;
      }
      renderResults(body.results || []);
    } catch (err) {
      if (requestId !== activeRequest) return;
      clearResults('搜索失败: ' + err.message);
    }
  }

  input.addEventListener('input', function () {
    var query = input.value;
    clearTimeout(timer);
    timer = setTimeout(function () {
      runSearch(query);
    }, 120);
  });
})();
