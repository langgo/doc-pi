(function () {
  'use strict';

  var currentFile = null;
  var conversationId = null;
  var isStreaming = false;

  // === DOM elements ===
  var messagesEl = null;
  var textarea = null;
  var sendBtn = null;
  var stopBtn = null;
  var activeReader = null;
  var stopRequested = false;
  var contextEl = null;
  var sessionBarEl = null;
  var sessionSelectEl = null;
  var btnNewEl = null;
  var btnRenameEl = null;
  var btnDeleteEl = null;
  var escapeHtml = null;
  var markdownRenderer = null;
  var inlineMarkdownRenderer = null;
  var sourceLocator = null;
  var annotateSource = null;
  var clearSourceAnnotation = null;
  var updateBadge = null;
  var openPanel = null;
  var confirmDialog = null;
  var promptDialog = null;
  var pendingAnnotationId = null;
  var activeMessageContextId = null;
  var annotationSeq = 0;
  var annotationCount = 0;
  var historyAnnotationIds = [];
  var resumeOffset = 0;

  // Current selection context
  var currentContext = {
    selectedText: '',
    contextBefore: '',
    contextAfter: '',
    chapterFile: currentFile,
  };

  // === Session management ===
  function saveConversationId(id) {
    conversationId = id;
    try { localStorage.setItem('ai-qa-conversationId', id); } catch (_) {}
  }

  function forgetConversationId() {
    conversationId = null;
    try { localStorage.removeItem('ai-qa-conversationId'); } catch (_) {}
  }

  function restoreConversationId() {
    try {
      var stored = localStorage.getItem('ai-qa-conversationId');
      if (stored) conversationId = stored;
    } catch (_) {}
  }

  async function fetchSessions() {
    try {
      var resp = await fetch('/api/ai-qa/sessions');
      if (!resp.ok) return [];
      var data = await resp.json();
      return data.sessions || [];
    } catch (_) {
      return [];
    }
  }

  async function createConversation(title) {
    try {
      var resp = await fetch('/api/ai-qa/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: title || undefined }),
      });
      if (!resp.ok) throw new Error('创建失败');
      var data = await resp.json();
      return data.session;
    } catch (e) {
      addMessage('error', '创建会话失败: ' + e.message);
      throw e;
    }
  }

  async function ensureConversation() {
    if (conversationId) return conversationId;
    var conv = await createConversation();
    saveConversationId(conv.id);
    return conv.id;
  }

  async function loadConversation(id) {
    try {
      var resp = await fetch('/api/ai-qa/sessions/' + encodeURIComponent(id));
      if (!resp.ok) return null;
      var data = await resp.json();
      return data.session;
    } catch (_) {
      return null;
    }
  }

  async function renameConversation(id, title) {
    try {
      var resp = await fetch('/api/ai-qa/sessions/' + encodeURIComponent(id), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: title }),
      });
      if (!resp.ok) throw new Error('重命名失败');
      return true;
    } catch (e) {
      addMessage('error', '重命名失败: ' + e.message);
      return false;
    }
  }

  async function deleteConversation(id) {
    try {
      var resp = await fetch('/api/ai-qa/sessions/' + encodeURIComponent(id), {
        method: 'DELETE',
      });
      if (!resp.ok) throw new Error('删除失败');
      return true;
    } catch (e) {
      addMessage('error', '删除失败: ' + e.message);
      return false;
    }
  }

  // === Session bar ===
  var sessionDropdownOpen = false;

  function formatSessionTime(iso) {
    try {
      var d = new Date(iso);
      var now = new Date();
      var diffMs = now - d;
      var diffMin = Math.floor(diffMs / 60000);
      if (diffMin < 1) return '刚刚';
      if (diffMin < 60) return diffMin + '分钟前';
      var diffHour = Math.floor(diffMin / 60);
      if (diffHour < 24) return diffHour + '小时前';
      var diffDay = Math.floor(diffHour / 24);
      if (diffDay < 7) return diffDay + '天前';
      return d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
    } catch (_) { return ''; }
  }

  function closeSessionDropdown() {
    sessionDropdownOpen = false;
    var list = document.querySelector('.ai-qa-session-dropdown');
    if (list) list.remove();
  }

  function toggleSessionDropdown() {
    if (sessionDropdownOpen) { closeSessionDropdown(); return; }
    sessionDropdownOpen = true;

    var existing = document.querySelector('.ai-qa-session-dropdown');
    if (existing) existing.remove();

    var list = document.createElement('div');
    list.className = 'ai-qa-session-dropdown';

    // Position relative to trigger element in viewport
    var triggerRect = sessionSelectEl.getBoundingClientRect();
    list.style.position = 'fixed';
    list.style.top = (triggerRect.bottom + 2) + 'px';
    list.style.left = triggerRect.left + 'px';
    list.style.width = triggerRect.width + 'px';

    fetchSessions().then(function(sessions) {
      if (!sessionDropdownOpen) return;
      list.innerHTML = sessions.map(function(s) {
        var active = s.id === conversationId ? ' active' : '';
        return '<div class="ai-qa-session-item' + active + '" data-id="' + s.id + '">' +
          '<span class="ai-qa-session-item-title">' + escapeHtml(s.title) + '</span>' +
          '<span class="ai-qa-session-item-time">' + formatSessionTime(s.updatedAt) + '</span>' +
        '</div>';
      }).join('');

      list.querySelectorAll('.ai-qa-session-item').forEach(function(item) {
        item.addEventListener('click', function() {
          var id = this.dataset.id;
          closeSessionDropdown();
          if (id !== conversationId) switchSession(id);
        });
      });
    });

    document.body.appendChild(list);

    // Close on outside click
    setTimeout(function() {
      document.addEventListener('click', function handler(e) {
        if (!list.contains(e.target) && e.target !== sessionSelectEl) {
          closeSessionDropdown();
          document.removeEventListener('click', handler);
        }
      });
    }, 0);
  }

  function updateSessionTrigger(sessions) {
    if (!sessionSelectEl) return;
    var current = null;
    for (var i = 0; i < sessions.length; i++) {
      if (sessions[i].id === conversationId) { current = sessions[i]; break; }
    }
    if (current) {
      sessionSelectEl.innerHTML =
        '<span class="ai-qa-session-trigger-title">' + escapeHtml(current.title) + '</span>' +
        '<span class="ai-qa-session-trigger-time">' + formatSessionTime(current.updatedAt) + '</span>';
    } else {
      sessionSelectEl.textContent = '选择会话';
    }
  }

  async function refreshSessionBar() {
    if (!sessionSelectEl) return;
    var sessions = await fetchSessions();

    // Auto-select first session on initial load
    if (!conversationId && sessions.length > 0) {
      conversationId = sessions[0].id;
      saveConversationId(conversationId);
    }

    updateSessionTrigger(sessions);
  }

  async function switchSession(id) {
    if (!id || id === conversationId) return;
    saveConversationId(id);
    await renderHistory(id);
    refreshSessionBar();
  }

  async function handleNewSession() {
    var conv = await createConversation();
    saveConversationId(conv.id);
    clearMessages();
    await refreshSessionBar();
    if (textarea) textarea.focus();
  }

  async function handleRenameSession() {
    if (!conversationId || !promptDialog) return;
    var conv = await loadConversation(conversationId);
    if (!conv) return;

    var newTitle = await promptDialog({
      title: '重命名会话',
      value: conv.title,
      confirmLabel: '确认',
    });
    if (!newTitle || newTitle === conv.title) return;
    await renameConversation(conversationId, newTitle);
    await refreshSessionBar();
  }

  async function handleDeleteSession() {
    if (!conversationId || !confirmDialog) return;
    var conv = await loadConversation(conversationId);
    if (!conv) return;

    var confirmed = await confirmDialog({
      title: '确认删除会话？',
      message: conv.title,
      confirmLabel: '确认删除',
      danger: true,
    });
    if (!confirmed) return;

    await deleteConversation(conversationId);
    forgetConversationId();
    clearMessages();
    var sessions = await fetchSessions();
    if (sessions.length > 0) {
      saveConversationId(sessions[0].id);
      await renderHistory(sessions[0].id);
    }
    await refreshSessionBar();
  }

  // === Build DOM into core panel pane ===
  function buildUI(container) {
    container.innerHTML =
      '<div class="ai-qa-session-bar">' +
      '<div class="ai-qa-session-select" tabindex="0"></div>' +
      '<button class="ai-qa-btn-new" title="新建会话" type="button">+</button>' +
      '<button class="ai-qa-btn-rename" title="重命名" type="button">✎</button>' +
      '<button class="ai-qa-btn-delete" title="删除" type="button">✕</button>' +
      '</div>' +
      '<div class="ai-qa-messages">' +
      '<div class="empty-state">选中文章内容后点击 "Ask AI" 开始提问<br>AI 会结合文章内容为你解答</div>' +
      '</div>' +
      '<div class="ai-qa-context">' +
      '<div class="context-header">' +
      '<div class="context-label">📖 将随下一条问题发送的上下文</div>' +
      '<button class="btn-clear-context" title="移除上下文" type="button">×</button>' +
      '</div>' +
      '<div class="context-text"></div>' +
      '</div>' +
      '<div class="ai-qa-input-area">' +
      '<textarea placeholder="输入你的问题..." rows="1"></textarea>' +
      '<button class="btn-send">发送</button>' +
      '<button class="btn-stop" type="button" hidden>停止</button>' +
      '</div>';

    messagesEl = container.querySelector('.ai-qa-messages');
    textarea = container.querySelector('textarea');
    sendBtn = container.querySelector('.btn-send');
    stopBtn = container.querySelector('.btn-stop');
    contextEl = container.querySelector('.ai-qa-context');
    sessionBarEl = container.querySelector('.ai-qa-session-bar');
    sessionSelectEl = container.querySelector('.ai-qa-session-select');
    btnNewEl = container.querySelector('.ai-qa-btn-new');
    btnRenameEl = container.querySelector('.ai-qa-btn-rename');
    btnDeleteEl = container.querySelector('.ai-qa-btn-delete');

    contextEl.querySelector('.btn-clear-context').addEventListener('click', clearContext);

    sendBtn.addEventListener('click', sendMessage);
    stopBtn.addEventListener('click', stopGeneration);
    textarea.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    });

    textarea.addEventListener('input', function () {
      this.style.height = 'auto';
      this.style.height = Math.min(this.scrollHeight, 120) + 'px';
    });

    sessionSelectEl.addEventListener('click', function () {
      toggleSessionDropdown();
    });

    btnNewEl.addEventListener('click', handleNewSession);
    btnRenameEl.addEventListener('click', handleRenameSession);
    btnDeleteEl.addEventListener('click', handleDeleteSession);

    updateContextDisplay();

    // Load sessions and restore history
    initSessions().then(function () {
      window.__ai_qa_ready__ = true;
    });
  }

  async function preloadHistoryAnnotations() {
    if (!conversationId) return;
    var conv = await loadConversation(conversationId);
    if (!conv || !conv.messages) return;
    clearHistoryAnnotations();
    for (var i = 0; i < conv.messages.length; i++) {
      var msg = conv.messages[i];
      if (msg.role === 'user') annotateHistoryUserMessage(msg);
    }
  }

  async function initSessions() {
    await refreshSessionBar();

    // If we have a stored conversationId, try to restore it
    if (conversationId) {
      var resumed = await resumeConversation(conversationId);
      if (resumed) return;
      var conv = await loadConversation(conversationId);
      if (conv) {
        renderHistoryMessages(conv.messages);
        return;
      }
      // Stored conversation no longer exists
      forgetConversationId();
    }

    // Auto-select first available session
    var sessions = await fetchSessions();
    if (sessions.length > 0) {
      saveConversationId(sessions[0].id);
      var firstConv = await loadConversation(sessions[0].id);
      if (!(await resumeConversation(sessions[0].id)) && firstConv) {
        renderHistoryMessages(firstConv.messages);
      }
    }
  }

  async function renderHistory(id) {
    var conv = await loadConversation(id);
    if (conv) {
      if (!(await resumeConversation(id))) renderHistoryMessages(conv.messages);
    }
  }

  function clearHistoryAnnotations() {
    if (clearSourceAnnotation) {
      for (var i = 0; i < historyAnnotationIds.length; i++) {
        clearSourceAnnotation(historyAnnotationIds[i]);
      }
    }
    historyAnnotationIds = [];
    setAnnotationCount(0);
  }

  function annotateHistoryUserMessage(msg) {
    var ctx = msg.context || null;
    if (!ctx || !ctx.selectedText || !annotateSource) return ctx;

    var annotationId = 'ai-qa-history-' + msg.id;
    var contextWithFile = {
      selectedText: ctx.selectedText || '',
      contextBefore: ctx.contextBefore || '',
      contextAfter: ctx.contextAfter || '',
      chapterFile: ctx.chapterFile || currentFile,
      annotationId: annotationId,
    };

    var annotated = annotateSource(contextWithFile, {
      id: annotationId,
      className: 'ai-qa-context-highlight',
      title: 'AI 问答历史上下文',
      onClick: function(payload) {
        if (openPanel) openPanel('ai-qa');
        if (payload && payload.annotationId) focusMessageContext(payload.annotationId);
        if (textarea) textarea.focus();
      },
      payload: { annotationId: annotationId },
    });

    if (!annotated) return ctx;
    historyAnnotationIds.push(annotationId);
    setAnnotationCount(historyAnnotationIds.length);
    return contextWithFile;
  }

  function renderHistoryMessages(messages) {
    clearMessages();
    clearHistoryAnnotations();
    if (!messages || messages.length === 0) return;

    for (var i = 0; i < messages.length; i++) {
      var msg = messages[i];
      if (msg.role === 'user') {
        addUserMessage(msg.content, annotateHistoryUserMessage(msg));
      } else if (msg.role === 'assistant') {
        addAssistantMessage(msg.content, msg.thinking || null, msg.status === 'streaming', msg.tools || null, msg.segments || null);
      }
    }
  }

  function clearMessages() {
    if (!messagesEl) return;
    clearHistoryAnnotations();
    messagesEl.innerHTML = '<div class="empty-state">选中文章内容后点击 "Ask AI" 开始提问<br>AI 会结合文章内容为你解答</div>';
  }

  // === Context display ===
  function updateContextDisplay() {
    if (!contextEl) return;
    var text = currentContext.selectedText || '';
    if (text) {
      contextEl.querySelector('.context-text').textContent = text.length > 200 ? text.slice(0, 200) + '...' : text;
      contextEl.classList.add('visible');
    } else {
      contextEl.classList.remove('visible');
    }
  }

  function resetContextState() {
    currentContext = {
      selectedText: '',
      contextBefore: '',
      contextAfter: '',
      chapterFile: currentFile,
    };
    updateContextDisplay();
  }

  function setAnnotationCount(count) {
    annotationCount = Math.max(0, count);
    if (updateBadge) updateBadge(annotationCount);
  }

  function clearContext() {
    if (clearSourceAnnotation && pendingAnnotationId) {
      clearSourceAnnotation(pendingAnnotationId);
      setAnnotationCount(annotationCount - 1);
    }
    pendingAnnotationId = null;
    resetContextState();
  }

  function snapshotContext() {
    return {
      selectedText: currentContext.selectedText || '',
      contextBefore: currentContext.contextBefore || '',
      contextAfter: currentContext.contextAfter || '',
      chapterFile: currentContext.chapterFile || currentFile,
    };
  }

  function toModelContext(context) {
    return {
      selectedText: context.selectedText || '',
      contextBefore: context.contextBefore || '',
      contextAfter: context.contextAfter || '',
      chapterFile: context.chapterFile || currentFile,
    };
  }

  // === Messages ===
  function addMessage(role, text) {
    if (!messagesEl) return;
    var empty = messagesEl.querySelector('.empty-state');
    if (empty) empty.remove();

    var msg = document.createElement('div');
    msg.className = 'ai-qa-message ' + role;
    msg.innerHTML = renderMarkdown(text);
    messagesEl.appendChild(msg);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    return msg;
  }

  function createLoadingDots(kind) {
    var loading = document.createElement('span');
    loading.className = 'ai-qa-node-loading';
    loading.dataset.loadingFor = kind || 'assistant';
    loading.setAttribute('aria-label', '加载中');
    loading.innerHTML = '<span></span><span></span><span></span>';
    return loading;
  }

  function setAssistantLoading(msgEl, visible) {
    if (!msgEl) return;
    var loading = msgEl.querySelector(':scope > .ai-qa-node-loading[data-loading-for="assistant"]');
    if (visible && !loading) msgEl.appendChild(createLoadingDots('assistant'));
    else if (!visible && loading) loading.remove();
  }

  function setNodeLoading(nodeEl, kind, visible) {
    if (!nodeEl) return;
    var selector = '.ai-qa-node-loading[data-loading-for="' + kind + '"]';
    var loading = nodeEl.querySelector(selector);
    var summary = nodeEl.querySelector('summary');
    if (visible && !loading) {
      var dots = createLoadingDots(kind);
      if (summary) summary.classList.add('has-node-loading');
      if (summary) summary.appendChild(dots);
      else nodeEl.appendChild(dots);
    } else if (!visible && loading) {
      loading.remove();
      if (summary) summary.classList.remove('has-node-loading');
    }
  }

  function formatToolValue(value) {
    if (value === undefined) return '';
    if (typeof value === 'string') return value;
    try { return JSON.stringify(value, null, 2); }
    catch (_) { return String(value); }
  }

  function renderToolDisplay(toolState) {
    if (!toolState) return '';
    var lines = [];
    if (toolState.name && toolState.name !== 'tool') lines.push('工具：' + toolState.name);
    if (toolState.args !== undefined) lines.push('参数：\n' + formatToolValue(toolState.args));
    if (toolState.status === 'running') lines.push('状态：执行中');
    else if (toolState.status === 'error') lines.push('状态：失败');
    else if (toolState.status === 'done') lines.push('状态：完成');
    if (toolState.result !== undefined) lines.push('结果：\n' + formatToolValue(toolState.result));
    if (toolState.error) lines.push('错误：\n' + formatToolValue(toolState.error));
    return lines.join('\n\n');
  }

  function mergeToolState(current, tool, label) {
    var next = current || { name: 'tool', status: 'running' };
    if (tool.name) next.name = tool.name;
    if (tool.id) next.id = tool.id;
    if (tool.contentIndex !== undefined) next.contentIndex = tool.contentIndex;
    if (tool.args !== undefined) next.args = tool.args;
    if (tool.arguments !== undefined) next.args = tool.arguments;
    if (tool.result !== undefined) next.result = tool.result;
    if (tool.error !== undefined) next.error = tool.error;
    if (tool.isError) next.status = 'error';
    else if (label === 'execution_end' || tool.status === 'done') next.status = 'done';
    else next.status = 'running';
    return next;
  }

  function toolSummaryText(tool) {
    if (!tool) return '工具调用';
    var name = tool.name || tool.id || 'tool';
    var target = tool.args && tool.args.path ? ' ' + tool.args.path : '';
    return '工具调用 ' + name + target;
  }

  function appendTreeText(container, className, text) {
    if (!container || !text) return null;
    var last = container.lastElementChild;
    if (last && last.className === className) {
      last.dataset.rawText = (last.dataset.rawText || '') + text;
      last.innerHTML = renderMarkdown(last.dataset.rawText);
      return last;
    }
    var item = document.createElement('div');
    item.className = className;
    item.dataset.rawText = text;
    item.innerHTML = renderMarkdown(text);
    container.appendChild(item);
    return item;
  }

  function ensureTreeItems(sectionEl) {
    var items = sectionEl.querySelector(':scope > .ai-qa-tree-items');
    if (!items) {
      items = document.createElement('div');
      items.className = 'ai-qa-tree-items';
      sectionEl.appendChild(items);
    }
    return items;
  }

  function addAssistantMessage(text, thinking, streaming, tools, segments) {
    if (!messagesEl) return;
    var empty = messagesEl.querySelector('.empty-state');
    if (empty) empty.remove();

    var msg = document.createElement('div');
    msg.className = 'ai-qa-message assistant' + (streaming ? ' streaming' : '');

    if (segments && segments.length) {
      renderAssistantSegments(msg, segments);
    } else {
      if (thinking) {
        var details = addThinkingBlock(msg);
        appendToThinkingBlock(details, thinking);
        finalizeThinkingBlock(details);
      }

      if (tools && tools.length) {
        var fallbackTool = addToolCallBlock(ensureThinkingItems(msg), tools[tools.length - 1]);
        for (var toolIndex = 0; toolIndex < tools.length; toolIndex++) {
          appendToToolBlock(fallbackTool, tools[toolIndex], tools[toolIndex].status || 'done');
        }
        finalizeToolBlock(fallbackTool);
      }
    }

    var body = document.createElement('div');
    body.className = 'ai-qa-message-body';
    body.innerHTML = renderMarkdown(text);
    msg.appendChild(body);
    if (streaming) {
      msg.dataset.rawMarkdown = text || '';
      setAssistantLoading(msg, true);
    }

    messagesEl.appendChild(msg);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    return msg;
  }

  function focusMessageContext(annotationId) {
    if (!annotationId || !messagesEl) return false;
    var quote = messagesEl.querySelector('.ai-qa-message-context[data-annotation-id="' + annotationId + '"]');
    if (!quote) return false;
    messagesEl.querySelectorAll('.ai-qa-message-context.active').forEach(function(el) {
      el.classList.remove('active');
    });
    quote.classList.add('active');
    quote.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return true;
  }

  function addUserMessage(text, context) {
    if (!messagesEl) return;
    var empty = messagesEl.querySelector('.empty-state');
    if (empty) empty.remove();

    var msg = document.createElement('div');
    msg.className = 'ai-qa-message user';

    if (context && context.selectedText) {
      var quote = document.createElement('div');
      quote.className = 'ai-qa-message-context';
      if (context.annotationId) quote.dataset.annotationId = context.annotationId;
      var header = document.createElement('div');
      header.className = 'message-context-header';
      var label = document.createElement('div');
      label.className = 'message-context-label';
      label.textContent = '引用上下文';
      header.appendChild(label);
      if (context.chapterFile) {
        var chapter = document.createElement('div');
        chapter.className = 'message-context-chapter';
        chapter.textContent = context.chapterFile;
        header.appendChild(chapter);
      }
      var body = document.createElement('div');
      body.className = 'message-context-text';
      body.textContent = context.selectedText.length > 240 ? context.selectedText.slice(0, 240) + '...' : context.selectedText;
      var isCrossChapter = context.chapterFile && context.chapterFile !== currentFile;
      quote.title = isCrossChapter ? '点击跳转到 ' + context.chapterFile : '点击定位到原文';
      quote.addEventListener('click', function () {
        if (isCrossChapter) {
          window.location.href = '/' + encodeURIComponent(context.chapterFile) + '#ai-qa';
          return;
        }
        if (sourceLocator) sourceLocator(context);
      });
      quote.appendChild(header);
      quote.appendChild(body);
      msg.appendChild(quote);
    }

    var question = document.createElement('div');
    question.className = 'message-question';
    question.innerHTML = escapeHtml(text).replace(/\n/g, '<br>');
    msg.appendChild(question);

    messagesEl.appendChild(msg);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    return msg;
  }

  function addStreamingMessage() {
    if (!messagesEl) return null;
    var empty = messagesEl.querySelector('.empty-state');
    if (empty) empty.remove();

    var msg = document.createElement('div');
    msg.className = 'ai-qa-message assistant streaming';
    msg.dataset.rawMarkdown = '';
    var body = document.createElement('div');
    body.className = 'ai-qa-message-body';
    msg.appendChild(body);
    setAssistantLoading(msg, true);
    messagesEl.appendChild(msg);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    return msg;
  }

  function appendToMessage(msgEl, delta) {
    if (!msgEl) return;
    var raw = (msgEl.dataset.rawMarkdown || '') + delta;
    msgEl.dataset.rawMarkdown = raw;
    var body = msgEl.querySelector('.ai-qa-message-body');
    if (!body) {
      body = document.createElement('div');
      body.className = 'ai-qa-message-body';
      var loading = msgEl.querySelector(':scope > .ai-qa-node-loading[data-loading-for="assistant"]');
      if (loading) msgEl.insertBefore(body, loading);
      else msgEl.appendChild(body);
    }
    body.innerHTML = renderMarkdown(raw);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function addThinkingBlock(parent) {
    var target = parent || messagesEl;
    if (!target) return null;
    var empty = messagesEl.querySelector('.empty-state');
    if (empty) empty.remove();

    var details = document.createElement('details');
    details.className = 'ai-qa-thinking';
    details.innerHTML = '<summary><span>思考过程</span><span class="thinking-hint">点击展开</span></summary><div class="ai-qa-tree-items"></div>';
    var anchor = parent ? parent.querySelector(':scope > .ai-qa-message-body') || parent.querySelector(':scope > .ai-qa-node-loading[data-loading-for="assistant"]') : null;
    if (anchor) parent.insertBefore(details, anchor);
    else target.appendChild(details);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    return details;
  }

  function ensureThinkingItems(parent) {
    var thinking = parent.querySelector(':scope > .ai-qa-thinking');
    if (!thinking) thinking = addThinkingBlock(parent);
    return ensureTreeItems(thinking);
  }

  function toolIdentity(tool) {
    if (!tool) return '';
    if (tool.id) return 'id:' + tool.id;
    if (tool.contentIndex !== undefined) return 'content:' + tool.contentIndex;
    return '';
  }

  function findToolCallBlock(container, tool) {
    if (!container) return null;
    var identity = toolIdentity(tool);
    if (!identity) return container.querySelector(':scope > .ai-qa-tool-call:last-of-type');
    var blocks = container.querySelectorAll(':scope > .ai-qa-tool-call');
    for (var i = blocks.length - 1; i >= 0; i--) {
      if (blocks[i].dataset.toolIdentity === identity || (tool.id && blocks[i].dataset.toolContentIndex === String(tool.contentIndex))) return blocks[i];
      if (tool.id && blocks[i].dataset.toolId === tool.id) return blocks[i];
      if (tool.contentIndex !== undefined && blocks[i].dataset.toolContentIndex === String(tool.contentIndex)) return blocks[i];
    }
    return null;
  }

  function addToolCallBlock(container, tool) {
    if (!container) return null;
    var existing = findToolCallBlock(container, tool);
    if (existing) return existing;
    var details = document.createElement('details');
    details.className = 'ai-qa-tool-call';
    var identity = toolIdentity(tool);
    if (identity) details.dataset.toolIdentity = identity;
    if (tool && tool.id) details.dataset.toolId = tool.id;
    if (tool && tool.contentIndex !== undefined) details.dataset.toolContentIndex = String(tool.contentIndex);
    var summary = document.createElement('summary');
    summary.innerHTML = '<span></span><span class="tools-hint">点击展开</span>';
    summary.querySelector('span').textContent = toolSummaryText(tool);
    var pre = document.createElement('pre');
    details.appendChild(summary);
    details.appendChild(pre);
    container.appendChild(details);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    return details;
  }

  function appendToToolBlock(detailsEl, tool, label) {
    if (!detailsEl || !tool) return;
    if (tool.id) {
      detailsEl.dataset.toolId = tool.id;
      detailsEl.dataset.toolIdentity = 'id:' + tool.id;
    }
    if (tool.contentIndex !== undefined) detailsEl.dataset.toolContentIndex = String(tool.contentIndex);
    var pre = detailsEl.querySelector('pre');
    var currentState = {};
    if (detailsEl.dataset.toolState) {
      try { currentState = JSON.parse(detailsEl.dataset.toolState); }
      catch (_) { currentState = {}; }
    }
    var nextState = mergeToolState(currentState, tool, label);
    detailsEl.dataset.toolState = JSON.stringify(nextState);
    pre.textContent = renderToolDisplay(nextState);
    var labelEl = detailsEl.querySelector('summary > span:first-child');
    if (labelEl && (tool.name || tool.id)) labelEl.textContent = toolSummaryText(tool);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function finalizeToolBlock(detailsEl) {
    if (!detailsEl) return;
    setNodeLoading(detailsEl, 'tool', false);
    var hint = detailsEl.querySelector('.tools-hint');
    if (hint) hint.textContent = '默认折叠';
  }

  function appendToThinkingBlock(detailsEl, delta) {
    if (!detailsEl) return;
    appendTreeText(ensureTreeItems(detailsEl), 'ai-qa-tree-text', delta);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function renderAssistantSegments(msg, segments) {
    var answerStarted = false;
    for (var i = 0; i < segments.length; i++) {
      var segment = segments[i];
      if (segment.type === 'thinking') {
        appendTreeText(ensureThinkingItems(msg), 'ai-qa-tree-text', segment.text || '');
      } else if (segment.type === 'tool') {
        var parentItems = answerStarted ? null : ensureThinkingItems(msg);
        var toolBlock = addToolCallBlock(parentItems, segment.tool || {});
        appendToToolBlock(toolBlock, segment.tool || {}, (segment.tool && segment.tool.status) || 'tool');
        if (segment.tool && (segment.tool.status === 'done' || segment.tool.status === 'error')) finalizeToolBlock(toolBlock);
      } else if (segment.type === 'answer') {
        answerStarted = true;
      }
    }
  }

  function finalizeThinkingBlock(detailsEl) {
    if (!detailsEl) return;
    setNodeLoading(detailsEl, 'thinking', false);
    var hint = detailsEl.querySelector('.thinking-hint');
    if (hint) hint.textContent = '默认折叠';
  }

  function finalizeMessage(msgEl) {
    if (!msgEl) return;
    msgEl.classList.remove('streaming');
    setAssistantLoading(msgEl, false);
    if (!Object.prototype.hasOwnProperty.call(msgEl.dataset, 'rawMarkdown')) return;
    var raw = msgEl.dataset.rawMarkdown || '';
    var body = msgEl.querySelector('.ai-qa-message-body');
    if (!body) {
      body = document.createElement('div');
      body.className = 'ai-qa-message-body';
      msgEl.appendChild(body);
    }
    body.innerHTML = renderMarkdown(raw);
    delete msgEl.dataset.rawMarkdown;
  }

  function activeStreamingAssistant() {
    return messagesEl ? messagesEl.querySelector('.ai-qa-message.assistant.streaming') : null;
  }

  function parseSseChunk(buffer, chunk, onEvent) {
    buffer.text += chunk;
    var lines = buffer.text.split('\n');
    buffer.text = lines.pop() || '';
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      if (line === '') {
        if (buffer.eventType) onEvent(buffer.eventType, buffer.data);
        buffer.eventType = '';
        buffer.data = '';
      } else if (line.startsWith('event: ')) {
        buffer.eventType = line.slice(7).trim();
      } else if (line.startsWith('data: ')) {
        buffer.data += (buffer.data ? '\n' : '') + line.slice(6);
      }
    }
  }

  async function readSseResponse(resp, handlers) {
    var reader = resp.body.getReader();
    activeReader = reader;
    var decoder = new TextDecoder();
    var buffer = { text: '', eventType: '', data: '' };
    try {
      while (true) {
        var result = await reader.read();
        if (result.done) break;
        parseSseChunk(buffer, decoder.decode(result.value, { stream: true }), handlers.onEvent);
      }
      parseSseChunk(buffer, decoder.decode(), handlers.onEvent);
      if (buffer.text) parseSseChunk(buffer, '\n', handlers.onEvent);
      if (buffer.eventType) handlers.onEvent(buffer.eventType, buffer.data);
    } finally {
      if (activeReader === reader) activeReader = null;
    }
  }

  async function resumeConversation(id) {
    if (!id) return false;
    var resp;
    try {
      resp = await fetch('/api/ai-qa/sessions/' + encodeURIComponent(id) + '/resume');
    } catch (_) {
      return false;
    }
    if (!resp.ok || !resp.body) return false;

    var thinkingBlock = null;
    var toolBlock = null;
    var streamingMsg = null;
    var sawSnapshot = false;
    var shouldStream = false;

    try {
      await readSseResponse(resp, {
        onEvent: function(eventType, dataStr) {
          if (eventType === 'session') {
            try {
              var sessionData = JSON.parse(dataStr);
              if (sessionData.id) saveConversationId(sessionData.id);
            } catch (_) {}
          } else if (eventType === 'snapshot') {
            try {
              var snapshot = JSON.parse(dataStr);
              var conv = snapshot.session;
              if (!conv) return;
              sawSnapshot = true;
              renderHistoryMessages(conv.messages);
              var messages = conv.messages || [];
              var last = messages[messages.length - 1];
              shouldStream = !!(last && last.role === 'assistant' && last.status === 'streaming');
              if (shouldStream) {
                isStreaming = true;
                setStreamingControls(true);
                resumeOffset = Number(last.streamOffset || 0);
                streamingMsg = activeStreamingAssistant();
                thinkingBlock = streamingMsg ? streamingMsg.querySelector('.ai-qa-thinking') : messagesEl.querySelector('.ai-qa-thinking');
                toolBlock = streamingMsg ? streamingMsg.querySelector('.ai-qa-tool-call:last-of-type') : messagesEl.querySelector('.ai-qa-tool-call:last-of-type');
              }
            } catch (_) {}
          } else if (eventType === 'thinking_delta') {
            try {
              var thinkingData = JSON.parse(dataStr);
              resumeOffset = Math.max(resumeOffset, (thinkingData.index || 0) + 1);
              if (!streamingMsg) streamingMsg = addStreamingMessage();
              setAssistantLoading(streamingMsg, false);
              if (!thinkingBlock) thinkingBlock = addThinkingBlock(streamingMsg);
              setNodeLoading(thinkingBlock, 'thinking', true);
              toolBlock = null;
              appendToThinkingBlock(thinkingBlock, thinkingData.delta);
            } catch (_) {}
          } else if (eventType === 'tool_execution_start' || eventType === 'tool_execution_end' || eventType === 'tool_call_start' || eventType === 'tool_call_delta' || eventType === 'tool_call_end') {
            try {
              var toolData = JSON.parse(dataStr);
              if (!streamingMsg) streamingMsg = addStreamingMessage();
              setAssistantLoading(streamingMsg, false);
              toolBlock = addToolCallBlock(ensureThinkingItems(streamingMsg), toolData.tool);
              setNodeLoading(toolBlock, 'tool', eventType !== 'tool_execution_end');
              appendToToolBlock(toolBlock, toolData.tool, eventType.replace(/^tool_/, ''));
            } catch (_) {}
          } else if (eventType === 'text_delta') {
            try {
              var data = JSON.parse(dataStr);
              resumeOffset = Math.max(resumeOffset, (data.index || 0) + 1);
              if (!streamingMsg) streamingMsg = addStreamingMessage();
              setAssistantLoading(streamingMsg, false);
              if (thinkingBlock) setNodeLoading(thinkingBlock, 'thinking', false);
              if (toolBlock) setNodeLoading(toolBlock, 'tool', false);
              appendToMessage(streamingMsg, data.delta);
            } catch (_) {}
          } else if (eventType === 'stopped') {
            if (thinkingBlock) finalizeThinkingBlock(thinkingBlock);
            if (toolBlock) finalizeToolBlock(toolBlock);
            if (streamingMsg) finalizeMessage(streamingMsg);
          } else if (eventType === 'done') {
            if (thinkingBlock) finalizeThinkingBlock(thinkingBlock);
            if (toolBlock) finalizeToolBlock(toolBlock);
            if (streamingMsg) finalizeMessage(streamingMsg);
          } else if (eventType === 'error') {
            try {
              var errData = JSON.parse(dataStr);
              addMessage('error', '错误: ' + (errData.error || '未知错误'));
            } catch (_) {
              addMessage('error', '请求出错');
            }
          }
        },
      });
      await refreshSessionBar();
      return sawSnapshot;
    } finally {
      if (shouldStream) {
        isStreaming = false;
        setStreamingControls(false);
      }
    }
  }

  function renderMarkdown(text) {
    if (markdownRenderer) return markdownRenderer(text);
    return escapeHtml(text).replace(/\n/g, '<br>');
  }

  function renderInlineMarkdown(text) {
    if (inlineMarkdownRenderer) return inlineMarkdownRenderer(text);
    return escapeHtml(text);
  }

  function setStreamingControls(active) {
    if (sendBtn) {
      sendBtn.disabled = active;
      sendBtn.hidden = active;
    }
    if (stopBtn) stopBtn.hidden = !active;
    if (textarea) textarea.disabled = active;
  }

  async function stopGeneration() {
    if (!isStreaming || stopRequested) return;
    stopRequested = true;
    if (stopBtn) stopBtn.disabled = true;
    try {
      if (conversationId) {
        await fetch('/api/ai-qa/sessions/' + encodeURIComponent(conversationId) + '/stop', { method: 'POST' }).catch(function() {});
      }
      if (activeReader) await activeReader.cancel().catch(function() {});
      var streamingMsg = activeStreamingAssistant();
      if (streamingMsg) finalizeMessage(streamingMsg);
    } finally {
      isStreaming = false;
      stopRequested = false;
      if (stopBtn) stopBtn.disabled = false;
      setStreamingControls(false);
      if (textarea) textarea.focus();
    }
  }

  // === Send message ===
  async function sendMessage() {
    if (isStreaming) return;
    var question = textarea.value.trim();
    if (!question) return;

    isStreaming = true;
    stopRequested = false;
    setStreamingControls(true);

    var contextForRequest = snapshotContext();
    if (pendingAnnotationId) {
      contextForRequest.annotationId = pendingAnnotationId;
      activeMessageContextId = pendingAnnotationId;
    }
    addUserMessage(question, contextForRequest);
    pendingAnnotationId = null;
    resetContextState();
    textarea.value = '';
    textarea.style.height = 'auto';

    var loadingEl = addStreamingMessage();

    try {
      await ensureConversation();

      var resp = await fetch('/api/ai-qa/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversationId: conversationId,
          question: question,
          context: toModelContext(contextForRequest),
        }),
      });

      if (!resp.ok) {
        var errText = await resp.text();
        throw new Error(errText || '请求失败');
      }

      var thinkingBlock = null;
      var toolBlock = null;
      var streamingMsg = loadingEl;

      await readSseResponse(resp, {
        onEvent: function(eventType, dataStr) {
          if (eventType === 'session') {
            try {
              var sessionData = JSON.parse(dataStr);
              if (sessionData.id) saveConversationId(sessionData.id);
            } catch (_) {}
          } else if (eventType === 'thinking_delta') {
            try {
              var thinkingData = JSON.parse(dataStr);
              if (!streamingMsg) streamingMsg = addStreamingMessage();
              setAssistantLoading(streamingMsg, false);
              if (!thinkingBlock) thinkingBlock = addThinkingBlock(streamingMsg);
              setNodeLoading(thinkingBlock, 'thinking', true);
              toolBlock = null;
              appendToThinkingBlock(thinkingBlock, thinkingData.delta);
            } catch (_) {}
          } else if (eventType === 'tool_execution_start' || eventType === 'tool_execution_end' || eventType === 'tool_call_start' || eventType === 'tool_call_delta' || eventType === 'tool_call_end') {
            try {
              var toolData = JSON.parse(dataStr);
              if (!streamingMsg) streamingMsg = addStreamingMessage();
              setAssistantLoading(streamingMsg, false);
              toolBlock = addToolCallBlock(ensureThinkingItems(streamingMsg), toolData.tool);
              setNodeLoading(toolBlock, 'tool', eventType !== 'tool_execution_end');
              appendToToolBlock(toolBlock, toolData.tool, eventType.replace(/^tool_/, ''));
            } catch (_) {}
          } else if (eventType === 'text_delta') {
            try {
              var data = JSON.parse(dataStr);
              if (!streamingMsg) streamingMsg = addStreamingMessage();
              setAssistantLoading(streamingMsg, false);
              if (thinkingBlock) setNodeLoading(thinkingBlock, 'thinking', false);
              if (toolBlock) setNodeLoading(toolBlock, 'tool', false);
              appendToMessage(streamingMsg, data.delta);
            } catch (_) {}
          } else if (eventType === 'error') {
            try {
              var errData = JSON.parse(dataStr);
              var errorMessage = errData.error || '未知错误';
              if (/不存在|过期|not found|expired/i.test(errorMessage)) forgetConversationId();
              addMessage('error', '错误: ' + errorMessage);
            } catch (_) {
              addMessage('error', '请求出错');
            }
          } else if (eventType === 'stopped') {
            if (thinkingBlock) finalizeThinkingBlock(thinkingBlock);
            if (toolBlock) finalizeToolBlock(toolBlock);
            if (streamingMsg) finalizeMessage(streamingMsg);
          } else if (eventType === 'done') {
            if (thinkingBlock) finalizeThinkingBlock(thinkingBlock);
            if (toolBlock) finalizeToolBlock(toolBlock);
            if (streamingMsg) finalizeMessage(streamingMsg);
          }
        },
      });

      if (thinkingBlock) finalizeThinkingBlock(thinkingBlock);
      if (streamingMsg) finalizeMessage(streamingMsg);

      // Refresh session bar to update title/message count
      await refreshSessionBar();
    } catch (e) {
      if (loadingEl.parentNode) loadingEl.remove();
      addMessage('error', '请求失败: ' + e.message);
    } finally {
      isStreaming = false;
      stopRequested = false;
      setStreamingControls(false);
      textarea.focus();
    }
  }

  // === Public API (called by register.js) ===
  window.__ai_qa__ = {
    configure: function (options) {
      options = options || {};
      if (options.currentFile) currentFile = options.currentFile;
      else if (!currentFile) throw new Error('ai-qa requires currentFile');
      if (options.escapeHtml) escapeHtml = options.escapeHtml;
      else if (!escapeHtml) throw new Error('ai-qa requires escapeHtml');
      markdownRenderer = options.renderMarkdown ? options.renderMarkdown : null;
      inlineMarkdownRenderer = options.renderInlineMarkdown ? options.renderInlineMarkdown : null;
      sourceLocator = options && options.locateSource ? options.locateSource : null;
      annotateSource = options && options.annotateSource ? options.annotateSource : null;
      clearSourceAnnotation = options && options.clearSourceAnnotation ? options.clearSourceAnnotation : null;
      updateBadge = options && options.updateBadge ? options.updateBadge : null;
      openPanel = options && options.openPanel ? options.openPanel : null;
      confirmDialog = options && options.confirmDialog ? options.confirmDialog : null;
      promptDialog = options && options.promptDialog ? options.promptDialog : null;
      setAnnotationCount(annotationCount);
      preloadHistoryAnnotations().catch(function() {});
    },
    render: buildUI,
    setContext: function (ctx) {
      if (clearSourceAnnotation && pendingAnnotationId) {
        clearSourceAnnotation(pendingAnnotationId);
        setAnnotationCount(annotationCount - 1);
      }
      currentContext = ctx || {
        selectedText: '',
        contextBefore: '',
        contextAfter: '',
        chapterFile: currentFile,
      };
      pendingAnnotationId = null;
      if (annotateSource && currentContext.selectedText && currentContext.source === 'article') {
        pendingAnnotationId = 'ai-qa-context-' + (++annotationSeq);
        var annotated = annotateSource(currentContext, {
          id: pendingAnnotationId,
          className: 'ai-qa-context-highlight',
          title: 'AI 问答上下文',
          onClick: function(payload) {
            if (openPanel) openPanel('ai-qa');
            if (payload && payload.annotationId) focusMessageContext(payload.annotationId);
            else if (activeMessageContextId) focusMessageContext(activeMessageContextId);
            if (textarea) textarea.focus();
          },
          payload: { annotationId: pendingAnnotationId },
        });
        if (annotated) setAnnotationCount(annotationCount + 1);
      }
      updateContextDisplay();
    },
    focus: function () {
      if (textarea) textarea.focus();
    },
  };

  // === Initialize ===
  restoreConversationId();
})();
