    (function() {
      var comments = window.__PLUGIN_comments__ || [];
      var currentFile = null;
      var escapeHtml = null;
      var sourceLocator = null;
      var annotateSource = null;
      var clearSourceAnnotation = null;
      var updateBadge = null;
      var openPanel = null;
      var confirmDialog = null;
      var notice = null;

      // === Author management ===
      function getStoredAuthor() {
        return localStorage.getItem('comment-author') || '';
      }

      // === Hash selected text (SHA-256 first 8 hex chars) ===
      async function hashText(text) {
        var encoder = new TextEncoder();
        var data = encoder.encode(text);
        var hashBuffer = await crypto.subtle.digest('SHA-256', data);
        var hashArray = Array.from(new Uint8Array(hashBuffer));
        return hashArray.slice(0, 4).map(function(b) { return b.toString(16).padStart(2, '0'); }).join('');
      }

      // === Find nearest heading element above a DOM node ===
      function findSectionHeading(node) {
        var el = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
        var content = el.closest('.markdown-content');
        if (!content) return { text: '', level: 0 };
        while (el && el !== content) {
          var prev = el.previousElementSibling;
          while (prev) {
            if (prev.matches && prev.matches('h1, h2, h3, h4')) {
              return { text: prev.textContent.trim(), level: parseInt(prev.tagName.charAt(1)) };
            }
            prev = prev.previousElementSibling;
          }
          el = el.parentElement;
        }
        return { text: '', level: 0 };
      }

      // === DOM refs ===
      var listEl = null;
      var chapterBarEl = null;
      var chapterSelectEl = null;

      // === Fetch chapter summary from API ===
      async function fetchChapterSummary() {
        try {
          var resp = await fetch('/api/comments/summary');
          if (!resp.ok) return [];
          var data = await resp.json();
          return data.chapters || [];
        } catch (_) {
          return [];
        }
      }

      // === Build chapter management bar ===
      function buildChapterBar(container) {
        chapterBarEl = document.createElement('div');
        chapterBarEl.className = 'comment-chapter-bar';
        chapterBarEl.innerHTML = '<select class="comment-chapter-select"></select>';
        chapterSelectEl = chapterBarEl.querySelector('.comment-chapter-select');
        container.appendChild(chapterBarEl);

        chapterSelectEl.addEventListener('change', function() {
          var selected = this.value;
          if (!selected || selected === currentFile) return;
          window.location.href = '/' + encodeURIComponent(selected) + '#comments';
        });

        refreshChapterBar();
      }

      async function refreshChapterBar() {
        if (!chapterSelectEl) return;
        var chapters = await fetchChapterSummary();
        var hasCurrent = chapters.some(function(c) { return c.file === currentFile; });
        if (!hasCurrent) {
          chapters.push({ file: currentFile, count: comments.length, latestAt: '' });
        }
        chapterSelectEl.innerHTML = chapters.map(function(c) {
          var label = c.file + ' (' + c.count + ')';
          var selected = c.file === currentFile ? ' selected' : '';
          return '<option value="' + c.file + '"' + selected + '>' + label + '</option>';
        }).join('');
      }

      // === Build comment list into core panel pane ===
      function buildUI(container) {
        buildChapterBar(container);
        var listContainer = document.createElement('div');
        listContainer.className = 'comment-panel-list';
        listContainer.id = 'comment-panel-list';
        container.appendChild(listContainer);
        listEl = listContainer;
        renderCommentList();
      }

      function updateCommentBadge() {
        if (updateBadge) updateBadge(comments.length);
        refreshChapterBar();
      }

      // === Render comment list ===
      function renderCommentList() {
        if (!listEl) return;
        if (comments.length === 0) {
          listEl.innerHTML = '<div class="comment-panel-empty">暂无评论<br>选中文本即可添加</div>';
        } else {
          listEl.innerHTML = comments.map(function(c) {
            return '<div class="comment-card" data-comment-id="' + c.id + '">' +
              '<div class="card-header">' +
                '<span class="card-author">' + escapeHtml(c.author) + '</span>' +
                '<span class="card-id" data-comment-id="' + c.id + '" title="点击复制">#' + c.id + '</span>' +
                '<span class="card-time">' + formatTime(c.createdAt) + '</span>' +
              '</div>' +
              '<div class="card-quote" data-comment-id="' + c.id + '">' + escapeHtml(c.selectedText.substring(0, 100)) + '</div>' +
              '<div class="card-body">' + escapeHtml(c.comment) + '</div>' +
              '<div class="card-actions">' +
                '<button class="danger" data-action="delete" data-comment-id="' + c.id + '">删除</button>' +
              '</div>' +
            '</div>';
          }).join('');
        }

        listEl.querySelectorAll('[data-action="delete"]').forEach(function(btn) {
          btn.addEventListener('click', function(e) {
            e.stopPropagation();
            showDeleteOverlay(this.dataset.commentId);
          });
        });

        listEl.querySelectorAll('.card-id').forEach(function(el) {
          el.addEventListener('click', function(e) {
            e.stopPropagation();
            var id = this.dataset.commentId;
            navigator.clipboard.writeText(id).then(function() {
              var orig = el.textContent;
              el.textContent = '已复制!';
              setTimeout(function() { el.textContent = orig; }, 1500);
            }).catch(function() {
              var input = document.createElement('input');
              input.value = id;
              document.body.appendChild(input);
              input.select();
              document.execCommand('copy');
              document.body.removeChild(input);
              var orig = el.textContent;
              el.textContent = '已复制!';
              setTimeout(function() { el.textContent = orig; }, 1500);
            });
          });
        });

        listEl.querySelectorAll('.card-quote').forEach(function(el) {
          el.addEventListener('click', function() {
            var id = this.dataset.commentId;
            var comment = comments.find(function(c) { return c.id === id; });
            if (!sourceLocator || !comment) return;
            sourceLocator({
              selectedText: comment.selectedText,
              contextBefore: comment.contextBefore,
              contextAfter: comment.contextAfter,
              chapterFile: currentFile,
            });
          });
        });
      }

      function formatTime(iso) {
        try {
          var d = new Date(iso);
          return d.toLocaleDateString('zh-CN') + ' ' + d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
        } catch(e) {
          return iso;
        }
      }

      function focusCommentCard(id) {
        if (openPanel) openPanel('comments');
        if (!listEl) return;
        var card = listEl.querySelector('.comment-card[data-comment-id="' + id + '"]');
        if (!card) return;
        listEl.querySelectorAll('.comment-card.active').forEach(function(el) { el.classList.remove('active'); });
        card.classList.add('active');
        card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }

      // === Delete comment ===
      async function showDeleteOverlay(id) {
        var comment = comments.find(function(c) { return c.id === id; });
        if (!comment || !confirmDialog) return;
        var confirmed = await confirmDialog({
          title: '确认删除这条评论？',
          message: comment.comment.substring(0, 120),
          confirmLabel: '确认删除',
          danger: true,
        });
        if (confirmed) await executeDelete(id);
      }

      async function executeDelete(id) {
        try {
          var resp = await fetch('/api/comments/' + currentFile + '?id=' + id, { method: 'DELETE' });
          if (!resp.ok) throw new Error('Delete failed');
          comments = comments.filter(function(c) { return c.id !== id; });
          if (clearSourceAnnotation) clearSourceAnnotation('comment-' + id);
          updateCommentBadge();
          renderCommentList();
        } catch(e) {
          if (notice) notice({ type: 'error', message: '删除失败: ' + e.message });
        }
      }

      // === Show comment form ===
      function showCommentForm(selectedText, sectionHeading, sectionLevel, textHash, contextBefore, contextAfter) {
        var existing = document.getElementById('comment-form-overlay');
        if (existing) existing.remove();

        var overlay = document.createElement('div');
        overlay.className = 'comment-form-overlay visible';
        overlay.id = 'comment-form-overlay';
        overlay.innerHTML = '<div class="comment-form">' +
          '<h3>添加评论</h3>' +
          '<div class="selected-preview">' + escapeHtml(selectedText.substring(0, 150)) + '</div>' +
          '<div class="author-row">' +
            '<label>署名：</label>' +
            '<input type="text" id="comment-author-input" value="' + escapeHtml(getStoredAuthor()) + '" placeholder="你的名字（可选）">' +
          '</div>' +
          '<textarea id="comment-textarea" placeholder="输入你的评论..."></textarea>' +
          '<div class="comment-form-error" id="comment-form-error"></div>' +
          '<div class="form-actions">' +
            '<button id="comment-cancel">取消</button>' +
            '<button class="primary" id="comment-submit">提交</button>' +
          '</div>' +
        '</div>';
        document.body.appendChild(overlay);

        var textarea = document.getElementById('comment-textarea');
        textarea.focus();

        function close() {
          overlay.remove();
        }

        function showFormError(message) {
          var el = document.getElementById('comment-form-error');
          if (!el) return;
          el.textContent = message;
          el.classList.add('visible');
        }

        document.getElementById('comment-cancel').addEventListener('click', close);
        overlay.addEventListener('click', function(e) {
          if (e.target === overlay) close();
        });

        document.getElementById('comment-submit').addEventListener('click', async function() {
          var commentText = textarea.value.trim();
          if (!commentText) { showFormError('请输入评论内容'); return; }
          var author = document.getElementById('comment-author-input').value.trim() || '匿名';
          localStorage.setItem('comment-author', author);

          try {
            var resp = await fetch('/api/comments/' + currentFile, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                author: author,
                selectedText: selectedText,
                sectionHeading: sectionHeading,
                sectionLevel: sectionLevel,
                textHash: textHash,
                contextBefore: contextBefore,
                contextAfter: contextAfter,
                comment: commentText
              })
            });
            if (!resp.ok) throw new Error('Save failed');
            var newComment = await resp.json();
            comments.push(newComment);
            annotateComment(newComment);
            updateCommentBadge();
            renderCommentList();
            close();
          } catch(e) {
            showFormError('保存失败: ' + e.message);
          }
        });

        document.addEventListener('keydown', function escHandler(e) {
          if (e.key === 'Escape') { close(); document.removeEventListener('keydown', escHandler); }
        });
      }

      // === Annotate a single comment in article DOM via core ===
      function annotateComment(comment) {
        if (!annotateSource) return;
        annotateSource({
          selectedText: comment.selectedText,
          contextBefore: comment.contextBefore,
          contextAfter: comment.contextAfter,
          chapterFile: currentFile,
        }, {
          id: 'comment-' + comment.id,
          className: 'comment-highlight',
          title: comment.author + ': ' + comment.comment,
          attributes: { commentId: comment.id },
          payload: { commentId: comment.id },
          onClick: function(payload) {
            focusCommentCard(payload.commentId);
          },
        });
      }

      // === Handle selection from core (called by register.js) ===
      async function handleSelection(ctx) {
        if (!ctx || !ctx.selectedText) return;
        var sel = window.getSelection();
        if (!sel || !sel.rangeCount) return;
        var range = sel.getRangeAt(0);
        var section = findSectionHeading(range.startContainer);
        var hash = await hashText(ctx.selectedText);
        showCommentForm(ctx.selectedText, section.text, section.level, hash, ctx.contextBefore || '', ctx.contextAfter || '');
      }

      // === Public API (called by register.js) ===
      window.__comments__ = {
        configure: function(options) {
          options = options || {};
          if (options.currentFile) currentFile = options.currentFile;
          else if (!currentFile) throw new Error('comments requires currentFile');
          if (options.escapeHtml) escapeHtml = options.escapeHtml;
          else if (!escapeHtml) throw new Error('comments requires escapeHtml');
          sourceLocator = options && options.locateSource ? options.locateSource : null;
          annotateSource = options && options.annotateSource ? options.annotateSource : null;
          clearSourceAnnotation = options && options.clearSourceAnnotation ? options.clearSourceAnnotation : null;
          updateBadge = options && options.updateBadge ? options.updateBadge : null;
          openPanel = options && options.openPanel ? options.openPanel : null;
          confirmDialog = options && options.confirmDialog ? options.confirmDialog : null;
          notice = options && options.notice ? options.notice : null;
          comments.forEach(function(c) { annotateComment(c); });
          updateCommentBadge();
          refreshChapterBar();
        },
        render: buildUI,
        handleSelection: handleSelection,
        focusComment: focusCommentCard,
      };

      // === Initialize ===
      comments.forEach(function(c) { annotateComment(c); });
    })();
