// Register AI QA plugin with core UI infrastructure.
(function () {
  'use strict';

  function init() {
    var core = window.__core__;
    var aiqa = window.__ai_qa__;
    if (!core || !aiqa) return;

    // Selection popup action
    core.selection.addAction({
      id: 'ai-qa',
      icon: '🤖',
      label: 'Ask AI',
      handler: function (ctx) {
        aiqa.setContext(ctx);
        core.panel.open('ai-qa');
        aiqa.focus();
      },
    });

    // Floating button
    core.floating.addButton({
      icon: '🤖',
      label: 'AI 问答',
      id: 'ai-qa-toggle',
      onClick: function () {
        core.panel.open('ai-qa');
        aiqa.focus();
      },
    });

    aiqa.configure({
      currentFile: core.state.currentFile,
      escapeHtml: core.dom.escapeHtml,
      renderMarkdown: core.dom.renderMarkdown,
      renderInlineMarkdown: core.dom.renderInlineMarkdown,
      locateSource: core.article.locateText,
      annotateSource: core.article.annotateText,
      clearSourceAnnotation: core.article.clearAnnotation,
      updateBadge: function(count) { core.floating.updateBadge('ai-qa-toggle', count); },
      openPanel: function(tabId) { core.panel.open(tabId); },
      confirmDialog: function(options) { return core.panel.confirm(options); },
      promptDialog: function(options) { return core.panel.prompt(options); },
    });

    // Panel tab
    core.panel.addTab({
      id: 'ai-qa',
      icon: '🤖',
      label: 'AI 问答',
      render: function (container) {
        aiqa.render(container);
      },
    });
  }

  window.__coreWhenReady__(init);
})();
