(function () {
  var app = document.querySelector('.app');
  var toggle = document.querySelector('.sidebar-collapse-toggle');
  if (!app || !toggle) return;

  function apply(collapsed) {
    app.classList.toggle('sidebar-collapsed', collapsed);
    toggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    toggle.setAttribute('aria-label', collapsed ? '展开侧边栏' : '折叠侧边栏');
    toggle.textContent = collapsed ? '⇥' : '⇤';
  }

  var stored = localStorage.getItem('core-sidebar-collapsed');
  apply(stored === '1');

  toggle.addEventListener('click', function () {
    var collapsed = !app.classList.contains('sidebar-collapsed');
    localStorage.setItem('core-sidebar-collapsed', collapsed ? '1' : '0');
    apply(collapsed);
  });
})();
