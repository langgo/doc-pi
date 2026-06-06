import { parseBody, json } from '../../../core/server/server.js';
import { loadComments, saveComments, getCommentSummary } from './store.js';

export const apiRoutes = [
  {
    method: 'GET',
    path: '/api/comments/summary',
    async handler(req, res) {
      const chapters = await getCommentSummary();
      json(res, 200, { chapters });
    }
  },
  {
    method: 'GET',
    path: '/api/comments/:file',
    async handler(req, res, { file }) {
      json(res, 200, await loadComments(file));
    }
  },
  {
    method: 'POST',
    path: '/api/comments/:file',
    async handler(req, res, { file }) {
      let body;
      try {
        body = await parseBody(req);
      } catch (err) {
        return json(res, 400, { error: err.message });
      }
      if (!body || !body.selectedText || !body.comment) {
        return json(res, 400, { error: 'Missing required fields: selectedText, comment' });
      }
      const data = await loadComments(file);
      const comment = {
        id: crypto.randomUUID().slice(0, 8),
        author: body.author || '匿名',
        sectionHeading: body.sectionHeading || '',
        sectionLevel: body.sectionLevel || 0,
        selectedText: body.selectedText,
        textHash: body.textHash || '',
        contextBefore: body.contextBefore || '',
        contextAfter: body.contextAfter || '',
        comment: body.comment,
        createdAt: new Date().toISOString(),
        resolved: false,
      };
      data.comments.push(comment);
      await saveComments(file, data);
      json(res, 201, comment);
    }
  },
  {
    method: 'DELETE',
    path: '/api/comments/:file',
    async handler(req, res, { file }) {
      const url = new URL(req.url, 'http://localhost');
      const id = url.searchParams.get('id');
      if (!id) return json(res, 400, { error: 'Missing id parameter' });
      const data = await loadComments(file);
      const idx = data.comments.findIndex(c => c.id === id);
      if (idx === -1) return json(res, 404, { error: 'Comment not found' });
      data.comments.splice(idx, 1);
      await saveComments(file, data);
      json(res, 200, { deleted: id });
    }
  },
  {
    method: 'PATCH',
    path: '/api/comments/:file',
    async handler(req, res, { file }) {
      const url = new URL(req.url, 'http://localhost');
      const id = url.searchParams.get('id');
      if (!id) return json(res, 400, { error: 'Missing id parameter' });
      let body;
      try {
        body = await parseBody(req);
      } catch (err) {
        return json(res, 400, { error: err.message });
      }
      const data = await loadComments(file);
      const comment = data.comments.find(c => c.id === id);
      if (!comment) return json(res, 404, { error: 'Comment not found' });
      if (body.resolved !== undefined) comment.resolved = body.resolved;
      if (body.comment !== undefined) comment.comment = body.comment;
      await saveComments(file, data);
      json(res, 200, comment);
    }
  }
];
