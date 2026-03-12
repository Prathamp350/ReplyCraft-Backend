/**
 * Bull Board Queue Monitoring Setup
 * Accessible at /admin/queues
 * Only enabled in development mode
 */

let bullBoardRouter = null;

try {
  // Only load Bull Board if not in production
  if (process.env.NODE_ENV !== 'production') {
    const { createBullBoard } = require('@bull-board/api');
    const { ExpressAdapter } = require('@bull-board/express');
    const { replyQueue } = require('../queues/reply.queue');

    // Create Bull adapters for each queue
    const adapters = [
      new ExpressAdapter().setQueues(replyQueue)
    ];

    // Create Bull Board instance
    const { router } = createBullBoard(adapters);
    bullBoardRouter = router;
    
    console.log('✅ Bull Board queue monitoring enabled at /admin/queues');
  }
} catch (error) {
  console.warn('⚠️  Bull Board could not be initialized:', error.message);
  bullBoardRouter = null;
}

// Export for use in server.js
module.exports = {
  bullBoardRouter
};
