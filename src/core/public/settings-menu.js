// Settings dropdown toggle
(function() {
  var btn = document.getElementById('btn-settings');
  var menu = document.getElementById('settings-menu');
  if (!btn || !menu) return;
  function setOpen(open) {
    menu.classList.toggle('visible', open);
    btn.classList.toggle('active', open);
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  btn.addEventListener('click', function(e) {
    e.stopPropagation();
    setOpen(!menu.classList.contains('visible'));
  });
  document.addEventListener('click', function() {
    setOpen(false);
  });
})();
