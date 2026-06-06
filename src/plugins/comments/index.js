import { apiRoutes } from './server/api.js';
import { loadComments } from './server/store.js';

export default {
  name: 'comments',
  apiRoutes,
  pageInjections: {
    cssUrls: ['/plugins/comments/client/comment.css'],
    jsUrls: ['/plugins/comments/client/comment.js', '/plugins/comments/client/register.js'],
    data: async (file) => {
      const data = await loadComments(file);
      return data.comments;
    }
  }
};
