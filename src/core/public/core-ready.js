// === Core: readiness signal ===
(function() {
  window.__core__ = window.__core__ || {};
  window.__coreWhenReady__ = function(callback) {
    if (window.__core__ && window.__core__.ready) {
      callback();
      return;
    }
    window.addEventListener('core:ready', callback, { once: true });
  };
  window.__core__.ready = true;
  window.dispatchEvent(new CustomEvent('core:ready'));
})();
