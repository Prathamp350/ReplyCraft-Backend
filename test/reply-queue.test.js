const test = require('node:test');
const assert = require('node:assert/strict');

process.env.NODE_ENV = process.env.NODE_ENV || 'test';

const {
  queueReplyGeneration,
  queueBulkReplyGeneration,
} = require('../queues/reply.queue');

test('queueReplyGeneration creates tenant-aware idempotency keys', async () => {
  const first = await queueReplyGeneration({
    userId: 'user-a',
    platform: 'google',
    reviewId: 'review-1',
    reviewText: 'Great',
    rating: 5,
  });

  const second = await queueReplyGeneration({
    userId: 'user-b',
    platform: 'google',
    reviewId: 'review-1',
    reviewText: 'Great',
    rating: 5,
  });

  assert.equal(first.id, 'user-a-google-review-1-generateReply');
  assert.equal(second.id, 'user-b-google-review-1-generateReply');
  assert.notEqual(first.id, second.id);
});

test('queueReplyGeneration uses different keys for generate and post actions', async () => {
  const generate = await queueReplyGeneration({
    userId: 'user-a',
    platform: 'google',
    reviewId: 'review-2',
    reviewText: 'Great',
    rating: 5,
  });

  const post = await queueReplyGeneration({
    userId: 'user-a',
    platform: 'google',
    reviewId: 'review-2',
    reviewText: 'Great',
    rating: 5,
    action: 'postReply',
    replyText: 'Thanks',
  });

  assert.equal(generate.id, 'user-a-google-review-2-generateReply');
  assert.equal(post.id, 'user-a-google-review-2-postReply');
});

test('queueBulkReplyGeneration preserves tenant-aware job ids', async () => {
  const jobs = await queueBulkReplyGeneration([
    {
      userId: 'user-a',
      platform: 'google',
      reviewId: 'bulk-1',
      reviewText: 'Nice',
      rating: 4,
    },
    {
      userId: 'user-b',
      platform: 'google',
      reviewId: 'bulk-1',
      reviewText: 'Nice',
      rating: 4,
    },
  ]);

  assert.equal(jobs[0].id, 'user-a-google-bulk-1-generateReply');
  assert.equal(jobs[1].id, 'user-b-google-bulk-1-generateReply');
}
);
