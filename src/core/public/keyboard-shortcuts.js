(function () {
  function isEditableTarget(target) {
    if (!target) return false;
    var tag = target.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
  }

  function clearSearch(input) {
    input.value = '';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }

  document.addEventListener('keydown', function (event) {
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
    var searchInput = document.querySelector('.doc-search-input');
    var target = event.target;

    if (event.key === '/' && !isEditableTarget(target) && searchInput) {
      event.preventDefault();
      searchInput.focus();
      searchInput.select();
      return;
    }

    if (event.key === 'Escape' && searchInput && document.activeElement === searchInput && searchInput.value) {
      event.preventDefault();
      clearSearch(searchInput);
      return;
    }

    if (isEditableTarget(target)) return;

    if (event.key === '[') {
      var prev = document.querySelector('.chapter-nav .nav-prev');
      if (prev) {
        event.preventDefault();
        window.location.href = prev.href;
      }
      return;
    }

    if (event.key === ']') {
      var next = document.querySelector('.chapter-nav .nav-next');
      if (next) {
        event.preventDefault();
        window.location.href = next.href;
      }
    }
  });
})();
