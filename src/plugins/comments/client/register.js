// Register Comments plugin with core UI infrastructure.
(function () {
  'use strict';

  function init() {
    var core = window.__core__;
    var cmt = window.__comments__;
    if (!core || !cmt) return;

    // Selection popup action
    core.selection.addAction({
      id: 'comments',
      icon: '💬',
      label: '评论',
      visible: function (ctx) {
        return ctx && ctx.source === 'article';
      },
      handler: function (ctx) {
        cmt.handleSelection(ctx);
      },
    });

    // Floating button
    core.floating.addButton({
      icon: '💬',
      label: '评论',
      id: 'comments-toggle',
      onClick: function () {
        core.panel.open('comments');
      },
    });

    cmt.configure({
      currentFile: core.state.currentFile,
      escapeHtml: core.dom.escapeHtml,
      locateSource: core.article.locateText,
      annotateSource: core.article.annotateText,
      clearSourceAnnotation: core.article.clearAnnotation,
      updateBadge: function(count) { core.floating.updateBadge('comments-toggle', count); },
      openPanel: function(tabId) { core.panel.open(tabId); },
      confirmDialog: function(options) { return core.panel.confirm(options); },
      notice: function(options) { return core.panel.notice(options); },
    });

    // Panel tab
    core.panel.addTab({
      id: 'comments',
      icon: '💬',
      label: '评论',
      render: function (container) {
        cmt.render(container);
      },
    });
  }

  window.__coreWhenReady__(init);
})();
