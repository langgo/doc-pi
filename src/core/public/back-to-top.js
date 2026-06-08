(function () {
  var button = document.querySelector('.back-to-top');
  if (!button) return;

  var threshold = 240;
  var ticking = false;

  function update() {
    button.hidden = window.scrollY <= threshold;
    ticking = false;
  }

  function schedule() {
    if (ticking) return;
    ticking = true;
    window.requestAnimationFrame(update);
  }

  button.addEventListener('click', function () {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  window.addEventListener('scroll', schedule, { passive: true });
  window.addEventListener('resize', schedule);
  update();
})();
