// Mermaid lightbox: click to zoom
const lightbox = document.getElementById('lightbox');
const lightboxContent = document.getElementById('lightbox-content');
const lightboxClose = document.getElementById('lightbox-close');

function openLightbox(element) {
  lightboxContent.innerHTML = '';
  const clone = element.cloneNode(true);
  // Remove inline width/height so CSS can control sizing
  clone.removeAttribute('width');
  clone.removeAttribute('height');
  clone.style.maxWidth = '100%';
  clone.style.maxHeight = '100%';
  lightboxContent.appendChild(clone);
  lightbox.classList.add('active');
  document.body.style.overflow = 'hidden';
}

function closeLightbox() {
  lightbox.classList.remove('active');
  document.body.style.overflow = '';
}

lightbox.addEventListener('click', (e) => {
  if (e.target === lightbox) closeLightbox();
});
lightboxClose.addEventListener('click', closeLightbox);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeLightbox();
});

function attachImageClicks() {
  document.querySelectorAll('.markdown-content img').forEach(image => {
    if (image.dataset.lightboxBound) return;
    image.dataset.lightboxBound = '1';
    image.addEventListener('click', () => openLightbox(image));
  });
}

// Attach click handlers after mermaid renders (deferred via MutationObserver)
function attachMermaidClicks() {
  document.querySelectorAll('.mermaid-container').forEach(container => {
    if (container.dataset.lightboxBound) return;
    container.dataset.lightboxBound = '1';
    container.addEventListener('click', () => {
      const svg = container.querySelector('svg');
      if (svg) openLightbox(svg);
    });
  });
}

// Mermaid renders async; observe DOM for new SVGs
const observer = new MutationObserver(() => {
  attachMermaidClicks();
  attachImageClicks();
});
observer.observe(document.body, { childList: true, subtree: true });

// Also try immediately (in case mermaid already rendered)
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    attachMermaidClicks();
    attachImageClicks();
  });
} else {
  attachMermaidClicks();
  attachImageClicks();
}
