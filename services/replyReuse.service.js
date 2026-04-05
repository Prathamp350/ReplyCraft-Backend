const crypto = require('crypto');
const ReplyTemplateCache = require('../models/ReplyTemplateCache');

const normalizeReviewText = (text) =>
  String(text || '')
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const hashText = (text) =>
  crypto.createHash('sha256').update(text).digest('hex');

const buildBloomSignature = (normalizedText) => {
  const words = normalizedText.split(' ').filter(Boolean);
  const signature = new Set();

  for (let index = 0; index < words.length; index += 1) {
    const shingle = [words[index], words[index + 1], words[index + 2]]
      .filter(Boolean)
      .join(' ');

    if (!shingle) continue;

    for (let slot = 0; slot < 4; slot += 1) {
      const digest = crypto.createHash('md5').update(`${slot}:${shingle}`).digest('hex');
      signature.add(parseInt(digest.slice(0, 8), 16) % 256);
    }
  }

  return [...signature].sort((a, b) => a - b);
};

const overlapRatio = (a, b) => {
  const left = new Set(a);
  const right = new Set(b);
  const intersection = [...left].filter((value) => right.has(value)).length;
  const union = new Set([...left, ...right]).size || 1;
  return intersection / union;
};

async function findReusableReply({ userId, aiConfigurationId, platform, rating, reviewText }) {
  const normalizedReviewText = normalizeReviewText(reviewText);
  if (!normalizedReviewText) return null;

  const reviewHash = hashText(normalizedReviewText);
  const exact = await ReplyTemplateCache.findOne({
    userId,
    aiConfigurationId: aiConfigurationId || null,
    platform: platform || 'generic',
    rating,
    reviewHash
  }).sort({ wasPosted: -1, updatedAt: -1 });

  if (exact) {
    exact.lastUsedAt = new Date();
    exact.postCount += 1;
    await exact.save();
    return {
      replyText: exact.replyText,
      matchType: 'exact',
      cacheId: exact._id,
      wasPosted: exact.wasPosted
    };
  }

  const bloomSignature = buildBloomSignature(normalizedReviewText);
  const candidates = await ReplyTemplateCache.find({
    userId,
    aiConfigurationId: aiConfigurationId || null,
    platform: platform || 'generic',
    rating,
    bloomSignature: { $in: bloomSignature }
  })
    .sort({ wasPosted: -1, updatedAt: -1 })
    .limit(10);

  const best = candidates
    .map((candidate) => ({
      candidate,
      score: overlapRatio(bloomSignature, candidate.bloomSignature || [])
    }))
    .filter((entry) => entry.score >= 0.92)
    .sort((a, b) => b.score - a.score)[0];

  if (!best) {
    return null;
  }

  best.candidate.lastUsedAt = new Date();
  best.candidate.postCount += 1;
  await best.candidate.save();

  return {
    replyText: best.candidate.replyText,
    matchType: 'bloom',
    cacheId: best.candidate._id,
    wasPosted: best.candidate.wasPosted
  };
}

async function storeReplyTemplate({
  userId,
  aiConfigurationId,
  platform,
  rating,
  reviewText,
  replyText,
  sourceReviewId = null,
  sourceConnectionId = null,
  wasPosted = false
}) {
  const normalizedReviewText = normalizeReviewText(reviewText);
  if (!normalizedReviewText || !replyText) return null;

  const reviewHash = hashText(normalizedReviewText);
  const bloomSignature = buildBloomSignature(normalizedReviewText);

  return ReplyTemplateCache.findOneAndUpdate(
    {
      userId,
      aiConfigurationId: aiConfigurationId || null,
      platform: platform || 'generic',
      rating,
      reviewHash
    },
    {
      $set: {
        normalizedReviewText,
        bloomSignature,
        replyText,
        sourceReviewId,
        sourceConnectionId,
        wasPosted: wasPosted || false,
        lastUsedAt: new Date()
      },
      $inc: {
        postCount: wasPosted ? 1 : 0
      }
    },
    {
      upsert: true,
      new: true,
      setDefaultsOnInsert: true
    }
  );
}

module.exports = {
  findReusableReply,
  storeReplyTemplate,
  normalizeReviewText,
  buildBloomSignature
};
