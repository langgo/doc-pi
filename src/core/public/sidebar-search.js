(function () {
  var input = document.querySelector('.doc-search-input');
  var statusEl = document.querySelector('.doc-search-status');
  var filtersEl = document.querySelector('.doc-search-filters');
  var resultsEl = document.querySelector('.doc-search-results');
  if (!input || !statusEl || !filtersEl || !resultsEl) return;

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

  function removeToken(query, indexToRemove) {
    return String(query || '').trim().split(/\s+/).filter(function (_, index) {
      return index !== indexToRemove;
    }).join(' ');
  }

  function renderFilters(query) {
    filtersEl.innerHTML = '';
    var tokens = String(query || '').trim().split(/\s+/).filter(Boolean);
    for (var i = 0; i < tokens.length; i += 1) {
      if (tokens[i].toLowerCase().indexOf('tag:') !== 0 || tokens[i].length <= 4) continue;
      var chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'doc-search-filter-chip';
      chip.textContent = tokens[i];
      chip.setAttribute('aria-label', '移除过滤条件 ' + tokens[i]);
      chip.dataset.tokenIndex = String(i);
      filtersEl.appendChild(chip);
    }
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
      link.href = '/' + encodeURIComponent(result.file) + '?q=' + encodeURIComponent(input.value.trim());
      var tags = Array.isArray(result.tags) && result.tags.length
        ? '<span class="doc-search-tags">' + result.tags.map(function (tag) {
          return '<span class="doc-search-tag">' + escapeHtml(tag) + '</span>';
        }).join('') + '</span>'
        : '';
      link.innerHTML = '<span class="doc-search-title">' + escapeHtml(result.title) + '</span>' +
        '<span class="doc-search-meta">' + escapeHtml(result.file) + ':' + result.line + '</span>' +
        tags +
        '<span class="doc-search-snippet">' + escapeHtml(result.snippet) + '</span>';
      resultsEl.appendChild(link);
    }
  }

  async function runSearch(query) {
    var requestId = ++activeRequest;
    renderFilters(query);
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

  filtersEl.addEventListener('click', function (event) {
    var chip = event.target.closest('.doc-search-filter-chip');
    if (!chip) return;
    input.value = removeToken(input.value, Number(chip.dataset.tokenIndex));
    renderFilters(input.value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.focus();
  });

  input.addEventListener('input', function () {
    var query = input.value;
    clearTimeout(timer);
    timer = setTimeout(function () {
      runSearch(query);
    }, 120);
  });
})();
