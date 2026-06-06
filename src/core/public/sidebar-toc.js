// === Sidebar TOC scroll sync ===
(function() {
  const sidebar = document.querySelector('.sidebar');
  const tocLinks = document.querySelectorAll('.toc-nav a');
  if (!tocLinks.length) return;

  // Build a map: heading id → TOC link element
  const headingToLink = new Map();
  tocLinks.forEach(link => {
    const href = link.getAttribute('href');
    const hashIdx = href.indexOf('#');
    if (hashIdx !== -1) {
      headingToLink.set(href.slice(hashIdx + 1), link);
    }
  });

  // Collect all heading elements in content area
  const headings = [];
  document.querySelectorAll('.markdown-content h1, .markdown-content h2, .markdown-content h3, .markdown-content h4').forEach(h => {
    if (h.id && headingToLink.has(h.id)) {
      headings.push(h);
    }
  });

  let activeLink = null;

  function setActive(link) {
    if (activeLink === link) return;
    if (activeLink) activeLink.classList.remove('active');
    activeLink = link;
    if (link) {
      link.classList.add('active');
      // Update URL hash without adding history entries
      const href = link.getAttribute('href');
      const hashIdx = href.indexOf('#');
      if (hashIdx !== -1) {
        const hash = href.slice(hashIdx);
        if (location.hash !== hash) {
          history.replaceState(null, '', hash);
        }
      }
      // Scroll sidebar so active item is visible
      const linkTop = link.offsetTop;
      const linkBottom = linkTop + link.offsetHeight;
      const sidebarTop = sidebar.scrollTop;
      const sidebarBottom = sidebarTop + sidebar.clientHeight;
      const margin = 60; // px padding from edge
      if (linkTop < sidebarTop + margin) {
        sidebar.scrollTop = linkTop - margin;
      } else if (linkBottom > sidebarBottom - margin) {
        sidebar.scrollTop = linkBottom - sidebar.clientHeight + margin;
      }
    }
  }

  // Use IntersectionObserver to detect which heading is in view
  const observer = new IntersectionObserver((entries) => {
    // Find the topmost heading that is intersecting
    let topmost = null;
    let topmostTop = Infinity;
    for (const entry of entries) {
      if (entry.isIntersecting && entry.target.offsetTop < topmostTop) {
        topmost = entry.target;
        topmostTop = entry.target.offsetTop;
      }
    }
    if (topmost) {
      const link = headingToLink.get(topmost.id);
      if (link) setActive(link);
      return;
    }
    // If no heading is intersecting, find the last one above viewport
    const viewportTop = window.scrollY;
    let lastAbove = null;
    for (const h of headings) {
      if (h.offsetTop <= viewportTop + 80) {
        lastAbove = h;
      }
    }
    if (lastAbove) {
      const link = headingToLink.get(lastAbove.id);
      if (link) setActive(link);
    }
  }, {
    rootMargin: '-80px 0px -80% 0px',
    threshold: 0
  });

  headings.forEach(h => observer.observe(h));

  // Fallback: scroll event for browsers where IntersectionObserver is unreliable
  let scrollTicking = false;
  window.addEventListener('scroll', () => {
    if (scrollTicking) return;
    scrollTicking = true;
    requestAnimationFrame(() => {
      const viewportTop = window.scrollY + 80;
      let current = headings[0];
      for (const h of headings) {
        if (h.offsetTop <= viewportTop) {
          current = h;
        }
      }
      const link = headingToLink.get(current.id);
      if (link) setActive(link);
      scrollTicking = false;
    });
  }, { passive: true });

  // Also highlight on initial load if URL has hash
  if (location.hash) {
    const id = location.hash.slice(1);
    const link = headingToLink.get(id);
    if (link) setActive(link);
  }
})();
