// === Core: Unified Panel ===
// Plugins register tabs via window.__core__.panel.addTab({ id, icon, label, render(container) })
// The core creates one panel with tab bar, drag, and 8-direction resize.
(function() {
  var tabs = [];
  var panel = null;
  var tabBar = null;
  var panesEl = null;
  var activeTabId = null;
  var isDragging = false;
  var dragStartX, dragStartY, panelStartX, panelStartY;
  var isResizing = false;
  var resizeDir = null;
  var resizeStartX, resizeStartY, resizeStartW, resizeStartH, resizeStartL, resizeStartT;

  var core = window.__core__ = window.__core__ || {};
  core.panel = core.panel || {};

  core.panel.addTab = function(tab) {
    var existingIdx = tabs.findIndex(function(item) { return item.id === tab.id; });
    if (existingIdx !== -1) tabs.splice(existingIdx, 1, tab);
    else tabs.push(tab);
    if (panel) {
      removeTabFromDOM(tab.id);
      addTabToDOM(tab);
    }
  };

  core.panel.open = function(tabId) {
    buildPanel();
    panel.classList.add('open');
    var saved = restorePanelState();
    if (saved) {
      var margin = 8;
      var maxW = Math.max(0, window.innerWidth - margin * 2);
      var maxH = Math.max(0, window.innerHeight - margin * 2);
      var savedW = Number(saved.width);
      var savedH = Number(saved.height);
      var savedL = Number(saved.left);
      var savedT = Number(saved.top);
      if (isFinite(savedW) && isFinite(savedH) && isFinite(savedL) && isFinite(savedT)) {
        var width = Math.min(savedW, maxW);
        var height = Math.min(savedH, maxH);
        panel.style.width = width + 'px';
        panel.style.height = height + 'px';
        panel.style.left = Math.max(margin, Math.min(savedL, window.innerWidth - width - margin)) + 'px';
        panel.style.top = Math.max(margin, Math.min(savedT, window.innerHeight - height - margin)) + 'px';
        panel.style.right = 'auto';
        panel.style.bottom = 'auto';
      } else {
        clampPanelToViewport();
      }
    } else {
      clampPanelToViewport();
    }
    if (tabId) switchTab(tabId);
    else if (tabs.length > 0 && !activeTabId) switchTab(tabs[0].id);
    if (core.floating && core.floating.hide) core.floating.hide();
  };

  core.panel.close = function() {
    if (!panel) return;
    panel.classList.remove('open');
    if (core.floating && core.floating.show) core.floating.show();
  };

  core.panel.toggle = function(tabId) {
    if (!panel || !panel.classList.contains('open')) {
      core.panel.open(tabId);
    } else {
      core.panel.close();
    }
  };

  function repositionFloatingButtons() {
    if (core.floating && core.floating.placeAboveElement) {
      core.floating.placeAboveElement(panel, 8);
    }
  }

  var PANEL_STORAGE_KEY = 'core-panel-state';

  function savePanelState() {
    if (!panel) return;
    var rect = panel.getBoundingClientRect();
    try {
      localStorage.setItem(PANEL_STORAGE_KEY, JSON.stringify({
        width: rect.width,
        height: rect.height,
        left: rect.left,
        top: rect.top,
      }));
    } catch (_) {}
  }

  function restorePanelState() {
    try {
      var raw = localStorage.getItem(PANEL_STORAGE_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (_) { return null; }
  }

  function resetPanelState() {
    if (!panel) return;
    try { localStorage.removeItem(PANEL_STORAGE_KEY); } catch (_) {}
    panel.style.width = '';
    panel.style.height = '';
    panel.style.left = '';
    panel.style.top = '';
    panel.style.right = '24px';
    panel.style.bottom = '24px';
    clampPanelToViewport();
    repositionFloatingButtons();
  }

  function clampPanelToViewport() {
    if (!panel) return;
    var margin = 8;
    var maxWidth = Math.max(0, window.innerWidth - margin * 2);
    var maxHeight = Math.max(0, window.innerHeight - margin * 2);
    var rect = panel.getBoundingClientRect();
    var width = Math.min(rect.width || 320, maxWidth);
    var height = Math.min(rect.height || 600, maxHeight);
    panel.style.width = width + 'px';
    panel.style.height = height + 'px';
    var currentLeft = rect.left;
    var currentTop = rect.top;
    if (!panel.style.left && panel.style.right) currentLeft = window.innerWidth - width - parseFloat(panel.style.right || '0');
    if (!panel.style.top && panel.style.bottom) currentTop = window.innerHeight - height - parseFloat(panel.style.bottom || '0');
    if (currentLeft > window.innerWidth - margin || currentLeft < margin) currentLeft = window.innerWidth - width - margin;
    if (currentTop > window.innerHeight - margin || currentTop < margin) currentTop = window.innerHeight - height - margin;
    panel.style.left = Math.max(margin, Math.min(currentLeft, window.innerWidth - width - margin)) + 'px';
    panel.style.top = Math.max(margin, Math.min(currentTop, window.innerHeight - height - margin)) + 'px';
    panel.style.right = 'auto';
    panel.style.bottom = 'auto';
  }

  function buildPanel() {
    if (panel) return;

    panel = document.createElement('div');
    panel.className = 'core-panel';

    tabBar = document.createElement('div');
    tabBar.className = 'core-panel-tabs';
    panel.appendChild(tabBar);

    panesEl = document.createElement('div');
    panesEl.className = 'core-panel-panes';
    panel.appendChild(panesEl);

    // Resize handles
    var dirs = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'];
    dirs.forEach(function(dir) {
      var handle = document.createElement('div');
      handle.className = 'core-panel-resize core-panel-resize-' + dir;
      handle.dataset.resizeDir = dir;
      handle.addEventListener('mousedown', function(e) {
        isResizing = true;
        resizeDir = dir;
        resizeStartX = e.clientX;
        resizeStartY = e.clientY;
        var rect = panel.getBoundingClientRect();
        resizeStartW = rect.width;
        resizeStartH = rect.height;
        resizeStartL = rect.left;
        resizeStartT = rect.top;
        panel.style.transition = 'none';
        e.preventDefault();
        e.stopPropagation();
      });
      panel.appendChild(handle);
    });

    document.body.appendChild(panel);

    // Add existing tabs
    tabs.forEach(function(t) { addTabToDOM(t); });

    // Drag
    tabBar.addEventListener('mousedown', function(e) {
      if (e.target.classList.contains('core-panel-close')) return;
      if (e.target.classList.contains('core-panel-reset')) return;
      if (e.target.classList.contains('core-panel-resize')) return;
      isDragging = true;
      dragStartX = e.clientX;
      dragStartY = e.clientY;
      var rect = panel.getBoundingClientRect();
      panelStartX = rect.left;
      panelStartY = rect.top;
      panel.style.transition = 'none';
      e.preventDefault();
    });

    document.addEventListener('mousemove', function(e) {
      if (isDragging) {
        panel.style.right = 'auto';
        panel.style.bottom = 'auto';
        panel.style.left = (panelStartX + e.clientX - dragStartX) + 'px';
        panel.style.top = (panelStartY + e.clientY - dragStartY) + 'px';
        clampPanelToViewport();
        return;
      }
      if (isResizing) {
        var dx = e.clientX - resizeStartX;
        var dy = e.clientY - resizeStartY;
        var dir = resizeDir;

        var maxW = Math.max(0, window.innerWidth - 16);
        var maxH = Math.max(0, window.innerHeight - 16);
        var minW = Math.min(320, maxW);
        var minH = Math.min(280, maxH);
        if (dir.indexOf('e') !== -1) {
          panel.style.width = Math.min(maxW, Math.max(minW, resizeStartW + dx)) + 'px';
        }
        if (dir.indexOf('w') !== -1) {
          var newW = Math.min(maxW, Math.max(minW, resizeStartW - dx));
          panel.style.width = newW + 'px';
          panel.style.left = (resizeStartL + resizeStartW - newW) + 'px';
        }
        if (dir.indexOf('s') !== -1) {
          panel.style.height = Math.min(maxH, Math.max(minH, resizeStartH + dy)) + 'px';
        }
        if (dir.indexOf('n') !== -1) {
          var newH = Math.min(maxH, Math.max(minH, resizeStartH - dy));
          panel.style.height = newH + 'px';
          panel.style.top = (resizeStartT + resizeStartH - newH) + 'px';
        }
        clampPanelToViewport();
        repositionFloatingButtons();
      }
    });

    document.addEventListener('mouseup', function() {
      if (isDragging) {
        isDragging = false;
        panel.style.transition = '';
        savePanelState();
      }
      if (isResizing) {
        isResizing = false;
        resizeDir = null;
        panel.style.transition = '';
        savePanelState();
      }
    });

    window.addEventListener('resize', function() {
      if (panel && panel.classList.contains('open')) clampPanelToViewport();
    });

    // Reset size/position button
    var resetBtn = document.createElement('button');
    resetBtn.className = 'core-panel-reset';
    resetBtn.innerHTML = '&#x21BA;';
    resetBtn.title = '重置大小和位置';
    resetBtn.addEventListener('click', function(e) {
      e.stopPropagation();
      resetPanelState();
    });
    tabBar.appendChild(resetBtn);

    // Close button
    var closeBtn = document.createElement('button');
    closeBtn.className = 'core-panel-close';
    closeBtn.innerHTML = '&#x2715;';
    closeBtn.title = '关闭';
    closeBtn.addEventListener('click', function(e) {
      e.stopPropagation();
      core.panel.close();
    });
    tabBar.appendChild(closeBtn);

    // Escape to close
    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape' && panel.classList.contains('open')) {
        core.panel.close();
      }
    });
  }

  function removeTabFromDOM(tabId) {
    if (!tabBar || !panesEl) return;
    tabBar.querySelectorAll('.core-panel-tab[data-tab-id="' + tabId + '"]').forEach(function(btn) { btn.remove(); });
    panesEl.querySelectorAll('.core-panel-pane[data-tab-id="' + tabId + '"]').forEach(function(pane) { pane.remove(); });
    if (activeTabId === tabId) activeTabId = null;
  }

  function escapeDialogHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function getDialogHost() {
    if (panesEl && activeTabId) {
      var activePane = panesEl.querySelector('.core-panel-pane[data-tab-id="' + activeTabId + '"]');
      if (activePane) return activePane;
    }
    return panesEl || panel || document.body;
  }

  function closeExistingDialog() {
    var existing = document.querySelector('.core-panel-confirm-overlay');
    if (existing) existing.remove();
  }

  function closeExistingNotice() {
    var existing = document.querySelector('.core-panel-notice');
    if (existing) existing.remove();
  }

  function showPanelDialog(options) {
    options = options || {};
    buildPanel();
    closeExistingDialog();

    return new Promise(function(resolve) {
      var overlay = document.createElement('div');
      overlay.className = 'core-panel-confirm-overlay';

      var confirmClass = options.danger ? 'danger' : 'primary';
      var html = '<div class="core-panel-confirm-dialog">' +
        '<div class="core-panel-confirm-title">' + escapeDialogHtml(options.title || '确认操作') + '</div>';

      if (options.type === 'prompt') {
        html += '<input class="core-panel-confirm-input" value="' + escapeDialogHtml(options.value || '') + '" placeholder="' + escapeDialogHtml(options.placeholder || '') + '">';
      } else if (options.message) {
        html += '<div class="core-panel-confirm-preview">' + escapeDialogHtml(options.message) + '</div>';
      }

      html += '<div class="core-panel-confirm-actions">' +
        '<button class="cancel" type="button">' + escapeDialogHtml(options.cancelLabel || '取消') + '</button>' +
        '<button class="' + confirmClass + '" type="button">' + escapeDialogHtml(options.confirmLabel || '确认') + '</button>' +
        '</div>' +
        '</div>';

      overlay.innerHTML = html;
      getDialogHost().appendChild(overlay);

      var input = overlay.querySelector('.core-panel-confirm-input');
      var settled = false;

      function close(value) {
        if (settled) return;
        settled = true;
        document.removeEventListener('keydown', onKeydown);
        overlay.remove();
        resolve(value);
      }

      function onKeydown(e) {
        if (e.key === 'Escape') close(options.type === 'prompt' ? null : false);
        if (e.key === 'Enter' && input) close(input.value.trim());
      }

      overlay.querySelector('.cancel').addEventListener('click', function() {
        close(options.type === 'prompt' ? null : false);
      });
      overlay.querySelector('.' + confirmClass).addEventListener('click', function() {
        close(options.type === 'prompt' ? (input ? input.value.trim() : '') : true);
      });
      overlay.addEventListener('click', function(e) {
        if (e.target === overlay) close(options.type === 'prompt' ? null : false);
      });
      document.addEventListener('keydown', onKeydown);

      if (input) {
        input.focus();
        input.select();
      }
    });
  }

  core.panel.confirm = function(options) {
    options = options || {};
    options.type = 'confirm';
    return showPanelDialog(options);
  };

  core.panel.prompt = function(options) {
    options = options || {};
    options.type = 'prompt';
    return showPanelDialog(options);
  };

  core.panel.closeDialog = closeExistingDialog;

  core.panel.notice = function(options) {
    options = options || {};
    buildPanel();
    closeExistingNotice();

    var notice = document.createElement('div');
    notice.className = 'core-panel-notice ' + (options.type || 'info');
    notice.textContent = options.message || '';
    getDialogHost().appendChild(notice);

    var duration = options.duration == null ? 2400 : Number(options.duration);
    if (duration > 0) {
      setTimeout(function() {
        if (notice.parentNode) notice.remove();
      }, duration);
    }
    return function closeNotice() {
      if (notice.parentNode) notice.remove();
    };
  };

  function addTabToDOM(tab) {
    if (!tabBar || !panesEl) return;

    // Tab button
    var tabBtn = document.createElement('button');
    tabBtn.className = 'core-panel-tab';
    tabBtn.dataset.tabId = tab.id;
    tabBtn.innerHTML = '<span class="tab-icon">' + (tab.icon || '') + '</span>' + (tab.label || '');
    tabBtn.addEventListener('click', function() {
      switchTab(tab.id);
    });

    // Insert before spacer/action buttons
    var spacer = tabBar.querySelector('.core-panel-tab-spacer');
    if (spacer) {
      tabBar.insertBefore(tabBtn, spacer);
    } else {
      // Create spacer before reset/close buttons so actions stay at top-right
      var actionBtn = tabBar.querySelector('.core-panel-reset') || tabBar.querySelector('.core-panel-close');
      var spacerEl = document.createElement('div');
      spacerEl.className = 'core-panel-tab-spacer';
      tabBar.insertBefore(spacerEl, actionBtn);
      tabBar.insertBefore(tabBtn, spacerEl);
    }

    // Pane
    var pane = document.createElement('div');
    pane.className = 'core-panel-pane';
    pane.dataset.tabId = tab.id;
    panesEl.appendChild(pane);

    // Let plugin render into the pane
    if (tab.render) tab.render(pane);
  }


  function switchTab(tabId) {
    activeTabId = tabId;

    // Update tab buttons
    tabBar.querySelectorAll('.core-panel-tab').forEach(function(btn) {
      btn.classList.toggle('active', btn.dataset.tabId === tabId);
    });

    // Update panes
    panesEl.querySelectorAll('.core-panel-pane').forEach(function(pane) {
      pane.classList.toggle('active', pane.dataset.tabId === tabId);
    });
  }
})();
