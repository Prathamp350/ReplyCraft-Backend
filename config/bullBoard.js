/**
 * Bull Board Queue Monitoring Setup
 * Accessible at /admin/queues
 * Only enabled in development mode
 */

let bullBoardRouter = null;

try {
  // Only load Bull Board if not in production
  if (process.env.NODE_ENV !== 'production' && process.env.NODE_ENV !== 'test') {
    const { createBullBoard } = require('@bull-board/api');
    const { BullMQAdapter } = require('@bull-board/api/bullMQAdapter');
    const { ExpressAdapter } = require('@bull-board/express');
    const { replyQueue } = require('../queues/reply.queue');

    const serverAdapter = new ExpressAdapter();
    serverAdapter.setBasePath('/admin/queues');

    createBullBoard({
      queues: [new BullMQAdapter(replyQueue)],
      serverAdapter: serverAdapter,
    });

    bullBoardRouter = serverAdapter.getRouter();
    
    console.log('✅ Bull Board queue monitoring enabled at /admin/queues');
  }
} catch (error) {
  if (process.env.NODE_ENV !== 'test') {
    console.warn('⚠️  Bull Board could not be initialized:', error.message);
  }
  bullBoardRouter = null;
}

// Export for use in server.js
module.exports = {
  bullBoardRouter
};
