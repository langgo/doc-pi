(function () {
  var bar = document.querySelector('.reading-progress');
  if (!bar) return;

  var ticking = false;

  function update() {
    var doc = document.documentElement;
    var max = doc.scrollHeight - window.innerHeight;
    var progress = max > 0 ? Math.min(100, Math.max(0, (window.scrollY / max) * 100)) : 100;
    bar.style.setProperty('--reading-progress', progress.toFixed(2));
    bar.setAttribute('aria-valuenow', String(Math.round(progress)));
    ticking = false;
  }

  function schedule() {
    if (ticking) return;
    ticking = true;
    window.requestAnimationFrame(update);
  }

  window.addEventListener('scroll', schedule, { passive: true });
  window.addEventListener('resize', schedule);
  update();
})();
