(function () {
  function getCodeText(pre) {
    var code = pre.querySelector('code');
    return (code || pre).textContent.replace(/\n$/, '');
  }

  function markCopied(button) {
    button.textContent = '已复制';
    button.classList.add('copied');
    window.setTimeout(function () {
      button.textContent = '复制';
      button.classList.remove('copied');
    }, 1400);
  }

  document.querySelectorAll('.markdown-content pre').forEach(function (pre) {
    if (pre.querySelector('.code-copy-button')) return;
    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'code-copy-button';
    button.textContent = '复制';
    button.setAttribute('aria-label', '复制代码块');
    button.addEventListener('click', async function () {
      try {
        await navigator.clipboard.writeText(getCodeText(pre));
        markCopied(button);
      } catch (_) {
        button.textContent = '复制失败';
      }
    });
    pre.appendChild(button);
  });
})();
