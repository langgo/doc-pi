// === Core: Floating Actions ===
// Plugins register buttons via window.__core__.floating.addButton({ icon, label, onClick, id })
(function() {
  var container = null;

  var core = window.__core__ = window.__core__ || {};
  core.floating = core.floating || {};

  function ensureContainer() {
    if (!container) {
      container = document.createElement('div');
      container.className = 'floating-actions';
      document.body.appendChild(container);
    }
    return container;
  }

  core.floating.addButton = function(btn) {
    var root = ensureContainer();
    if (btn.id) {
      var existing = document.getElementById(btn.id);
      if (existing && existing.parentNode === root) existing.remove();
    }
    var el = document.createElement('button');
    el.id = btn.id || '';
    el.className = 'floating-action-btn';
    el.title = btn.label || '';
    el.innerHTML = '<span class="floating-action-icon">' + (btn.icon || '') + '</span><span class="floating-action-badge" hidden></span>';
    el.addEventListener('click', btn.onClick);
    root.appendChild(el);
    if (btn.badge !== undefined) core.floating.updateBadge(btn.id, btn.badge);
    return el;
  };

  core.floating.updateBadge = function(id, value) {
    if (!id) return;
    var el = document.getElementById(id);
    if (!el) return;
    var badge = el.querySelector('.floating-action-badge');
    if (!badge) return;
    var count = Number(value) || 0;
    if (count <= 0) {
      badge.hidden = true;
      badge.textContent = '';
      return;
    }
    badge.hidden = false;
    badge.textContent = count > 99 ? '99+' : String(count);
  };

  core.floating.hide = function() {
    if (container) container.style.display = 'none';
  };

  core.floating.show = function() {
    if (!container) return;
    container.style.bottom = '';
    container.style.right = '';
    container.style.display = '';
  };

  core.floating.placeAboveElement = function(element, gap) {
    if (!container || !element) return;
    var rect = element.getBoundingClientRect();
    container.style.bottom = (window.innerHeight - rect.top + (gap || 8)) + 'px';
  };
})();
