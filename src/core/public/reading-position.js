// === Per-chapter reading position restore ===
(function () {
  if (!window.history || !window.location) return;

  var storageKey = 'doc-pi:reading-position:' + window.location.pathname;
  var ticking = false;
  var restored = false;
  var restoreEvent = 'doc-pi:restore-reading-position';

  function readStoredPosition() {
    try {
      var raw = window.localStorage.getItem(storageKey);
      if (!raw) return 0;
      var value = Number(raw);
      return Number.isFinite(value) && value > 0 ? value : 0;
    } catch (_) {
      return 0;
    }
  }

  function savePosition() {
    ticking = false;
    if (!restored) return;
    try {
      window.localStorage.setItem(storageKey, String(Math.max(0, Math.round(window.scrollY || 0))));
    } catch (_) {}
  }

  function scheduleSave() {
    if (!restored || ticking) return;
    ticking = true;
    window.requestAnimationFrame(savePosition);
  }

  function maxScrollTop() {
    var doc = document.documentElement;
    return Math.max(0, doc.scrollHeight - window.innerHeight);
  }

  function restorePosition() {
    if (restored) return;

    // Only skip restore for intentional hash navigation (user clicked a
    // heading anchor link). On reload or back/forward, the hash is stale
    // from the previous page state and we should restore the saved position.
    if (window.location.hash) {
      var navType = 'navigate';
      try {
        var entries = performance.getEntriesByType('navigation');
        if (entries && entries.length) navType = entries[0].type;
      } catch (_) {}
      if (navType === 'navigate') {
        restored = true;
        return;
      }
    }

    var position = readStoredPosition();
    if (!position) { restored = true; return; }
    restored = true;

    function apply() {
      var target = Math.min(position, maxScrollTop());
      window.scrollTo(0, target);
    }

    // Apply after layout settles.
    requestAnimationFrame(function () {
      requestAnimationFrame(apply);
    });

    // Browser may still restore scroll asynchronously after load
    // even with scrollRestoration=manual. Override any scroll away
    // from our target for a short window.
    var scrollListener = function () {
      var target = Math.min(position, maxScrollTop());
      if (Math.abs((window.scrollY || 0) - target) > 2) {
        window.scrollTo(0, target);
      }
    };
    window.addEventListener('scroll', scrollListener, { passive: true });
    setTimeout(function () {
      window.removeEventListener('scroll', scrollListener);
    }, 2000);
  }

  window.addEventListener(restoreEvent, function () {
    restored = false;
    restorePosition();
  });
  window.addEventListener('scroll', scheduleSave, { passive: true });
  window.addEventListener('beforeunload', savePosition);

  if (document.readyState === 'complete') {
    restorePosition();
  } else {
    window.addEventListener('load', restorePosition);
  }
})();
