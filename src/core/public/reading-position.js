// === Per-chapter reading position restore ===
(function () {
  if (!window.history || !window.location) return;

  var storageKey = 'doc-pi:reading-position:' + window.location.pathname;
  var ticking = false;
  var restored = false;

  try {
    if ('scrollRestoration' in window.history) window.history.scrollRestoration = 'manual';
  } catch (_) {}

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
    try {
      window.localStorage.setItem(storageKey, String(Math.max(0, Math.round(window.scrollY || 0))));
    } catch (_) {}
  }

  function scheduleSave() {
    if (ticking) return;
    ticking = true;
    window.requestAnimationFrame(savePosition);
  }

  function maxScrollTop() {
    var doc = document.documentElement;
    return Math.max(0, doc.scrollHeight - window.innerHeight);
  }

  function restorePosition() {
    if (restored || window.location.hash) return;
    restored = true;
    var position = readStoredPosition();
    if (!position) return;
    window.scrollTo(0, Math.min(position, maxScrollTop()));
  }

  window.addEventListener('scroll', scheduleSave, { passive: true });
  window.addEventListener('beforeunload', savePosition);
  window.addEventListener('load', restorePosition, { once: true });
  if (document.readyState === 'complete') restorePosition();
})();
