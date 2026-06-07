(function () {
  var inputWrap = document.querySelector('.doc-search-input-wrap');
  var input = document.querySelector('.doc-search-input');
  var clearButton = document.querySelector('.doc-search-clear');
  var countEl = document.querySelector('.doc-search-count');
  var statusEl = document.querySelector('.doc-search-status');
  var helpToggle = document.querySelector('.doc-search-help-toggle');
  var helpEl = document.querySelector('.doc-search-help');
  var filtersEl = document.querySelector('.doc-search-filters');
  var resultsEl = document.querySelector('.doc-search-results');
  if (!inputWrap || !input || !clearButton || !countEl || !statusEl || !helpToggle || !helpEl || !filtersEl || !resultsEl) return;

  var activeRequest = 0;
  var activeSearchController = null;
  var timer = null;
  var recentStorageKey = 'doc-pi:recent-searches';

  function syncUrl(query) {
    var url = new URL(window.location.href);
    var trimmed = String(query || '').trim();
    if (trimmed) url.searchParams.set('q', trimmed);
    else {
      url.searchParams.delete('q');
      if (/^#L\d+$/.test(url.hash || '')) url.hash = '';
    }
    window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
  }

  function setResultCount(count, visible) {
    countEl.textContent = String(count);
    countEl.setAttribute('aria-label', count + ' 个搜索结果');
    countEl.hidden = !visible;
  }

  function setClearVisible(query) {
    clearButton.hidden = !String(query || '').trim();
  }

  function setLoading(isLoading) {
    inputWrap.classList.toggle('search-loading', Boolean(isLoading));
    inputWrap.setAttribute('aria-busy', isLoading ? 'true' : 'false');
  }

  function setErrorState(hasError) {
    inputWrap.classList.toggle('search-error', Boolean(hasError));
    input.setAttribute('aria-invalid', hasError ? 'true' : 'false');
  }

  function removeRetry() {
    var retry = statusEl.querySelector('.doc-search-retry');
    if (retry) retry.remove();
  }

  function renderRetry() {
    removeRetry();
    var retry = document.createElement('button');
    retry.type = 'button';
    retry.className = 'doc-search-retry';
    retry.textContent = '重试';
    retry.setAttribute('aria-label', '重试搜索');
    statusEl.appendChild(document.createTextNode(' '));
    statusEl.appendChild(retry);
  }

  function setHelpVisible(visible) {
    helpEl.hidden = !visible;
    helpToggle.setAttribute('aria-expanded', visible ? 'true' : 'false');
  }

  function clearResults(message) {
    resultsEl.innerHTML = '';
    statusEl.textContent = message || '';
    removeRetry();
    setResultCount(0, false);
    setLoading(false);
    setErrorState(false);
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

  function searchableTerms(query) {
    var seen = Object.create(null);
    return String(query || '').trim().split(/\s+/).filter(function (token) {
      if (!token || token.toLowerCase().indexOf('tag:') === 0) return false;
      var key = token.toLowerCase();
      if (seen[key]) return false;
      seen[key] = true;
      return true;
    });
  }

  function appendHighlightedText(parent, text, terms) {
    var source = String(text || '');
    if (!terms.length) {
      parent.textContent = source;
      return;
    }

    var lowerSource = source.toLowerCase();
    var cursor = 0;
    while (cursor < source.length) {
      var nextIndex = -1;
      var nextTerm = '';
      for (var i = 0; i < terms.length; i += 1) {
        var term = terms[i];
        var index = lowerSource.indexOf(term.toLowerCase(), cursor);
        if (index === -1) continue;
        if (nextIndex === -1 || index < nextIndex || (index === nextIndex && term.length > nextTerm.length)) {
          nextIndex = index;
          nextTerm = term;
        }
      }
      if (nextIndex === -1) break;
      if (nextIndex > cursor) parent.appendChild(document.createTextNode(source.slice(cursor, nextIndex)));
      var mark = document.createElement('mark');
      mark.className = 'doc-search-snippet-hit';
      mark.textContent = source.slice(nextIndex, nextIndex + nextTerm.length);
      parent.appendChild(mark);
      cursor = nextIndex + nextTerm.length;
    }
    if (cursor < source.length) parent.appendChild(document.createTextNode(source.slice(cursor)));
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

  function searchResults() {
    return Array.prototype.slice.call(resultsEl.querySelectorAll('.doc-search-result'));
  }

  function recentControls() {
    return Array.prototype.slice.call(resultsEl.querySelectorAll('.doc-search-recent-item, .doc-search-clear-recent'));
  }

  function setSelectedRecent(selected) {
    var controls = recentControls();
    for (var i = 0; i < controls.length; i += 1) {
      var isSelected = controls[i] === selected;
      controls[i].classList.toggle('search-selected', isSelected);
      controls[i].setAttribute('aria-selected', isSelected ? 'true' : 'false');
    }
  }

  function focusRecent(index) {
    var controls = recentControls();
    if (!controls.length) return false;
    var control = controls[Math.max(0, Math.min(index, controls.length - 1))];
    control.focus();
    setSelectedRecent(control);
    return true;
  }

  function readRecentSearches() {
    try {
      var value = JSON.parse(window.localStorage.getItem(recentStorageKey) || '[]');
      return Array.isArray(value) ? value.filter(function (item) { return typeof item === 'string' && item.trim(); }).slice(0, 5) : [];
    } catch (err) {
      return [];
    }
  }

  function writeRecentSearch(query) {
    var trimmed = String(query || '').trim();
    if (!trimmed) return;
    var recent = readRecentSearches().filter(function (item) { return item.toLowerCase() !== trimmed.toLowerCase(); });
    recent.unshift(trimmed);
    try {
      window.localStorage.setItem(recentStorageKey, JSON.stringify(recent.slice(0, 5)));
    } catch (err) {}
  }

  function clearRecentSearches() {
    try {
      window.localStorage.removeItem(recentStorageKey);
    } catch (err) {}
    resultsEl.querySelectorAll('.doc-search-recent-item, .doc-search-clear-recent').forEach(function (item) {
      item.remove();
    });
    if (!resultsEl.children.length && !input.value.trim()) statusEl.textContent = '';
  }

  function renderRecentSearches() {
    if (String(input.value || '').trim()) return false;
    var recent = readRecentSearches();
    if (!recent.length) return false;
    resultsEl.innerHTML = '';
    statusEl.textContent = '最近搜索';
    setResultCount(0, false);
    setLoading(false);
    for (var i = 0; i < recent.length; i += 1) {
      var item = document.createElement('button');
      item.type = 'button';
      item.className = 'doc-search-recent-item';
      item.textContent = recent[i];
      item.setAttribute('aria-label', '重新搜索 ' + recent[i]);
      item.setAttribute('aria-selected', 'false');
      resultsEl.appendChild(item);
    }
    var clearRecent = document.createElement('button');
    clearRecent.type = 'button';
    clearRecent.className = 'doc-search-clear-recent';
    clearRecent.textContent = '清空最近搜索';
    clearRecent.setAttribute('aria-label', '清空最近搜索');
    clearRecent.setAttribute('aria-selected', 'false');
    resultsEl.appendChild(clearRecent);
    return true;
  }

  function hasTagFilter(query) {
    return String(query || '').trim().split(/\s+/).some(function (token) {
      return token.toLowerCase().indexOf('tag:') === 0 && token.length > 4;
    });
  }

  function renderEmptyState(query) {
    resultsEl.innerHTML = '';
    var empty = document.createElement('div');
    empty.className = 'doc-search-empty';
    empty.setAttribute('role', 'status');

    var title = document.createElement('div');
    title.className = 'doc-search-empty-title';
    title.textContent = '无匹配结果';
    empty.appendChild(title);

    var hint = document.createElement('div');
    hint.className = 'doc-search-empty-hint';
    hint.textContent = '尝试减少关键词或换一个搜索词。';
    empty.appendChild(hint);

    if (hasTagFilter(query)) {
      var filterHint = document.createElement('div');
      filterHint.className = 'doc-search-empty-filter-hint';
      filterHint.textContent = '点击上方标签过滤条件可移除 tag 限制。';
      empty.appendChild(filterHint);
    }

    resultsEl.appendChild(empty);
  }

  function setSelectedResult(selected) {
    var results = searchResults();
    for (var i = 0; i < results.length; i += 1) {
      var isSelected = results[i] === selected;
      results[i].classList.toggle('search-selected', isSelected);
      results[i].setAttribute('aria-selected', isSelected ? 'true' : 'false');
    }
  }

  function abortActiveSearch() {
    if (!activeSearchController) return;
    activeSearchController.abort();
    activeSearchController = null;
  }

  function clearSearchPresentation() {
    if (typeof window.docPiClearSearchHighlights === 'function') window.docPiClearSearchHighlights();
    if (typeof window.docPiClearSearchLineTargets === 'function') window.docPiClearSearchLineTargets();
    document.querySelectorAll('.doc-search-hit').forEach(function (mark) {
      var parent = mark.parentNode;
      if (!parent) return;
      parent.replaceChild(document.createTextNode(mark.textContent || ''), mark);
      parent.normalize();
    });
    document.querySelectorAll('.doc-search-line-target.line-target-active').forEach(function (target) {
      target.classList.remove('line-target-active');
    });
    if (document.activeElement && document.activeElement.classList && document.activeElement.classList.contains('doc-search-line-target')) {
      document.activeElement.blur();
    }
  }

  function clearSearch() {
    clearTimeout(timer);
    abortActiveSearch();
    clearSearchPresentation();
    input.value = '';
    setClearVisible('');
    renderFilters('');
    clearResults('');
    syncUrl('');
    activeRequest += 1;
  }

  function focusResult(index) {
    var results = searchResults();
    if (!results.length) return false;
    var result = results[Math.max(0, Math.min(index, results.length - 1))];
    result.focus();
    setSelectedResult(result);
    result.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    return true;
  }

  function renderResults(results) {
    var terms = searchableTerms(input.value);
    resultsEl.innerHTML = '';
    if (!results.length) {
      statusEl.textContent = '无匹配结果';
      setResultCount(0, true);
      renderEmptyState(input.value);
      return;
    }
    statusEl.textContent = results.length + ' 个结果';
    setResultCount(results.length, true);
    for (var i = 0; i < results.length; i += 1) {
      var result = results[i];
      var link = document.createElement('a');
      link.className = 'doc-search-result';
      link.tabIndex = -1;
      link.setAttribute('aria-selected', 'false');
      link.href = '/' + encodeURIComponent(result.file) + '?q=' + encodeURIComponent(input.value.trim()) + '#L' + encodeURIComponent(result.line);
      link.addEventListener('click', function (event) {
        event.stopPropagation();
        if (link.pathname === window.location.pathname) {
          setTimeout(function () {
            if (typeof window.docPiClearSearchLineTargets === 'function') window.docPiClearSearchLineTargets();
            if (/^#L\d+$/.test(window.location.hash || '')) {
              var target = document.getElementById(window.location.hash.slice(1));
              if (target && target.classList.contains('doc-search-line-target')) {
                target.classList.add('line-target-active');
                target.focus({ preventScroll: true });
              }
            }
            var params = new URLSearchParams(window.location.search || '');
            var query = (params.get('q') || '').trim();
            if (!query) return;
            var root = document.querySelector('.markdown-content');
            if (!root || root.querySelector('.doc-search-hit')) return;
            var lower = query.toLowerCase();
            var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
              acceptNode: function (textNode) {
                if (!textNode.nodeValue || !textNode.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
                var parent = textNode.parentElement;
                if (!parent || parent.closest('script, style, code, pre, .doc-search-hit')) return NodeFilter.FILTER_REJECT;
                return textNode.nodeValue.toLowerCase().indexOf(lower) !== -1 ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
              },
            });
            var textNode = walker.nextNode();
            if (!textNode) return;
            var value = textNode.nodeValue;
            var index = value.toLowerCase().indexOf(lower);
            var mark = document.createElement('mark');
            mark.className = 'doc-search-hit';
            mark.textContent = value.slice(index, index + query.length);
            textNode.parentNode.insertBefore(document.createTextNode(value.slice(0, index)), textNode);
            textNode.parentNode.insertBefore(mark, textNode);
            textNode.parentNode.insertBefore(document.createTextNode(value.slice(index + query.length)), textNode);
            textNode.parentNode.removeChild(textNode);
          }, 0);
          return;
        }
        event.preventDefault();
        window.location.assign(link.href);
      });
      link.innerHTML = '<span class="doc-search-title">' + escapeHtml(result.title) + '</span>' +
        '<span class="doc-search-meta">' + escapeHtml(result.file) + ':' + result.line + '</span>';
      if (typeof result.readingMinutes === 'number' && typeof result.readingCount === 'number') {
        var statsEl = document.createElement('span');
        statsEl.className = 'doc-search-reading-stats';
        statsEl.textContent = '约 ' + result.readingMinutes + ' 分钟 · ' + result.readingCount + ' 字';
        link.appendChild(statsEl);
      }
      if (Array.isArray(result.tags) && result.tags.length) {
        var tagsEl = document.createElement('span');
        tagsEl.className = 'doc-search-tags';
        for (var tagIndex = 0; tagIndex < result.tags.length; tagIndex += 1) {
          var tagEl = document.createElement('span');
          tagEl.className = 'doc-search-tag';
          tagEl.textContent = result.tags[tagIndex];
          tagsEl.appendChild(tagEl);
        }
        link.appendChild(tagsEl);
      }
      var snippetEl = document.createElement('span');
      snippetEl.className = 'doc-search-snippet';
      appendHighlightedText(snippetEl, result.snippet, terms);
      link.appendChild(snippetEl);
      resultsEl.appendChild(link);
    }
  }

  async function runSearch(query) {
    abortActiveSearch();
    var requestId = ++activeRequest;
    setClearVisible(query);
    setErrorState(false);
    renderFilters(query);
    if (!query.trim()) {
      clearResults('');
      return;
    }
    var controller = new AbortController();
    activeSearchController = controller;
    statusEl.textContent = '搜索中…';
    setResultCount(0, false);
    setLoading(true);
    try {
      var res = await fetch('/api/search?q=' + encodeURIComponent(query), { signal: controller.signal });
      var body = await res.json();
      if (requestId !== activeRequest) return;
      if (activeSearchController === controller) activeSearchController = null;
      setLoading(false);
      if (!res.ok) {
        clearResults(body.error || '搜索失败');
        setErrorState(true);
        renderRetry();
        return;
      }
      renderResults(body.results || []);
      writeRecentSearch(query);
    } catch (err) {
      if (requestId !== activeRequest || err.name === 'AbortError') return;
      if (activeSearchController === controller) activeSearchController = null;
      setLoading(false);
      clearResults('搜索失败: ' + err.message);
      setErrorState(true);
      renderRetry();
    }
  }

  helpToggle.addEventListener('click', function () {
    setHelpVisible(helpEl.hidden);
  });

  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && !helpEl.hidden) {
      setHelpVisible(false);
    }
  });

  input.addEventListener('keydown', function (event) {
    if (event.key === 'ArrowDown') {
      if (focusResult(0) || focusRecent(0)) event.preventDefault();
      return;
    }
    if (event.key === 'Escape') {
      if (input.value || resultsEl.children.length) {
        event.preventDefault();
        clearSearch();
      }
    }
  });

  resultsEl.addEventListener('keydown', function (event) {
    var controls = recentControls();
    var recentIndex = controls.indexOf(document.activeElement);
    if (recentIndex !== -1) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        focusRecent(recentIndex + 1);
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        if (recentIndex <= 0) {
          input.focus();
          setSelectedRecent(null);
        } else focusRecent(recentIndex - 1);
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        clearSearch();
        input.focus();
      }
      return;
    }

    var results = searchResults();
    var index = results.indexOf(document.activeElement);
    if (index === -1) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      focusResult(index + 1);
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (index <= 0) {
        input.focus();
        setSelectedResult(null);
      } else focusResult(index - 1);
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      clearSearch();
      input.focus();
    }
  });

  statusEl.addEventListener('click', function (event) {
    if (!event.target.closest('.doc-search-retry')) return;
    runSearch(input.value);
    input.focus();
  });

  resultsEl.addEventListener('click', function (event) {
    var clearRecent = event.target.closest('.doc-search-clear-recent');
    if (clearRecent) {
      clearRecentSearches();
      input.focus();
      return;
    }
    var recentItem = event.target.closest('.doc-search-recent-item');
    if (!recentItem) return;
    input.value = recentItem.textContent || '';
    setClearVisible(input.value);
    syncUrl(input.value);
    runSearch(input.value);
    input.focus();
  });

  resultsEl.addEventListener('mouseover', function (event) {
    var result = event.target.closest('.doc-search-result');
    if (result) setSelectedResult(result);
  });

  resultsEl.addEventListener('mouseleave', function () {
    if (!resultsEl.contains(document.activeElement)) setSelectedResult(null);
  });

  clearButton.addEventListener('click', function () {
    clearSearch();
    input.focus();
  });

  filtersEl.addEventListener('click', function (event) {
    var chip = event.target.closest('.doc-search-filter-chip');
    if (!chip) return;
    input.value = removeToken(input.value, Number(chip.dataset.tokenIndex));
    renderFilters(input.value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.focus();
  });

  input.addEventListener('focus', function () {
    renderRecentSearches();
  });

  input.addEventListener('input', function () {
    var query = input.value;
    if (!String(query || '').trim()) clearSearchPresentation();
    setClearVisible(query);
    syncUrl(query);
    clearTimeout(timer);
    timer = setTimeout(function () {
      runSearch(query);
    }, 120);
  });

  window.addEventListener('popstate', function () {
    var query = new URL(window.location.href).searchParams.get('q') || '';
    input.value = query;
    setClearVisible(query);
    if (query) runSearch(query);
    else clearSearch();
  });

  var initialQuery = new URL(window.location.href).searchParams.get('q') || '';
  if (initialQuery) {
    input.value = initialQuery;
    setClearVisible(initialQuery);
    runSearch(initialQuery);
  }
})();
