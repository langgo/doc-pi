(function () {
  var anchors = document.querySelectorAll('.heading-anchor');
  if (!anchors.length) return;

  function buildUrl(anchor) {
    return new URL(anchor.getAttribute('href'), window.location.href).href;
  }

  function showCopied(anchor, originalLabel) {
    anchor.classList.add('copied');
    anchor.setAttribute('aria-label', 'Copied heading link');
    anchor.textContent = '✓';
    setTimeout(function () {
      anchor.classList.remove('copied');
      anchor.setAttribute('aria-label', originalLabel);
      anchor.textContent = '#';
    }, 1200);
  }

  anchors.forEach(function (anchor) {
    var originalLabel = anchor.getAttribute('aria-label') || 'Copy heading link';
    anchor.addEventListener('click', async function (event) {
      var url = buildUrl(anchor);
      if (!navigator.clipboard || typeof navigator.clipboard.writeText !== 'function') return;
      event.preventDefault();
      try {
        await navigator.clipboard.writeText(url);
        history.replaceState(null, '', anchor.getAttribute('href'));
        showCopied(anchor, originalLabel);
      } catch {
        window.location.hash = anchor.getAttribute('href').slice(1);
      }
    });
  });
})();
