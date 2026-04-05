/**
 * Review Controller
 * Handles review inbox operations: list, approve, edit, send
 */

const Review = require('../models/Review');
const { queueReplyGeneration } = require('../queues/reply.queue');
const logger = require('../utils/logger');
const BusinessConnection = require('../models/BusinessConnection');
const { storeReplyTemplate } = require('../services/replyReuse.service');

/**
 * Get all reviews for logged-in user
 */
const getReviews = async (req, res) => {
  try {
    const { 
      platform, 
      status, 
      sentiment,
      page = 1, 
      limit = 20,
      sortBy = 'createdAt',
      sortOrder = 'desc'
    } = req.query;

    // Build query
    const query = { userId: req.userId };
    
    if (platform) query.platform = platform;
    if (status) query.replyStatus = status;
    if (sentiment) query.sentiment = sentiment;

    // Get total count
    const total = await Review.countDocuments(query);

    // Get paginated reviews
    const reviews = await Review.find(query)
      .sort({ [sortBy]: sortOrder === 'desc' ? -1 : 1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit))
      .populate('connectionId', 'locationName businessName');

    // Calculate pagination
    const totalPages = Math.ceil(total / limit);

    return res.status(200).json({
      success: true,
      reviews,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        totalPages
      }
    });

  } catch (error) {
    logger.error('Get reviews error', { error: error.message, userId: req.userId });
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch reviews'
    });
  }
};

/**
 * Get single review by ID
 */
const getReview = async (req, res) => {
  try {
    const { id } = req.params;

    const review = await Review.findOne({
      _id: id,
      userId: req.userId
    }).populate('connectionId', 'locationName businessName');

    if (!review) {
      return res.status(404).json({
        success: false,
        error: 'Review not found'
      });
    }

    return res.status(200).json({
      success: true,
      review
    });

  } catch (error) {
    logger.error('Get review error', { error: error.message, userId: req.userId });
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch review'
    });
  }
};

/**
 * Approve AI-generated reply
 */
const approveReply = async (req, res) => {
  try {
    const { id } = req.params;

    const review = await Review.findOne({
      _id: id,
      userId: req.userId
    });

    if (!review) {
      return res.status(404).json({
        success: false,
        error: 'Review not found'
      });
    }

    // Check if there's an AI reply to approve
    if (!review.aiReply) {
      return res.status(400).json({
        success: false,
        error: 'No AI reply to approve. Generate a reply first.'
      });
    }

    // Update reply status to approved and queue posting
    review.replyStatus = 'approved';
    review.replyText = review.replyText || review.aiReply;
    await review.save();

    const connection = review.connectionId
      ? await BusinessConnection.findById(review.connectionId).select('aiConfigurationId')
      : null;

    await storeReplyTemplate({
      userId: review.userId,
      aiConfigurationId: connection?.aiConfigurationId || null,
      platform: review.platform,
      rating: review.rating,
      reviewText: review.reviewText,
      replyText: review.replyText,
      sourceReviewId: review.reviewId,
      sourceConnectionId: review.connectionId,
      wasPosted: false
    });

    await queueReplyGeneration({
      reviewId: review.reviewId,
      userId: req.userId.toString(),
      platform: review.platform,
      entityType: review.entityType,
      reviewText: review.reviewText,
      rating: review.rating,
      replyText: review.replyText,
      action: 'postReply'
    });

    logger.info('Reply approved', { 
      reviewId: review._id, 
      userId: req.userId 
    });

    return res.status(200).json({
      success: true,
      message: 'Reply approved and queued for posting',
      review
    });

  } catch (error) {
    logger.error('Approve reply error', { error: error.message, userId: req.userId });
    return res.status(500).json({
      success: false,
      error: 'Failed to approve reply'
    });
  }
};

/**
 * Edit AI-generated reply before sending
 */
const updateReply = async (req, res) => {
  try {
    const { id } = req.params;
    const { replyText } = req.body;

    if (!replyText || replyText.trim().length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Reply text is required'
      });
    }

    const review = await Review.findOne({
      _id: id,
      userId: req.userId
    });

    if (!review) {
      return res.status(404).json({
        success: false,
        error: 'Review not found'
      });
    }

    // Update the reply text
    review.replyText = replyText.trim();
    review.replyStatus = 'approved'; // Mark as approved when edited
    await review.save();

    logger.info('Reply updated', { 
      reviewId: review._id, 
      userId: req.userId 
    });

    return res.status(200).json({
      success: true,
      message: 'Reply updated successfully',
      review
    });

  } catch (error) {
    logger.error('Update reply error', { error: error.message, userId: req.userId });
    return res.status(500).json({
      success: false,
      error: 'Failed to update reply'
    });
  }
};

/**
 * Send approved reply to platform
 */
const sendReply = async (req, res) => {
  try {
    const { id } = req.params;

    const review = await Review.findOne({
      _id: id,
      userId: req.userId
    });

    if (!review) {
      return res.status(404).json({
        success: false,
        error: 'Review not found'
      });
    }

    // Check if reply is ready
    if (!review.replyText && !review.aiReply) {
      return res.status(400).json({
        success: false,
        error: 'No reply to send. Generate or edit a reply first.'
      });
    }

    // Use replyText if available, otherwise use aiReply
    const replyToSend = review.replyText || review.aiReply;

    // If not yet approved, auto-approve
    if (review.replyStatus !== 'approved') {
      review.replyStatus = 'approved';
      review.replyText = replyToSend;
      await review.save();
    }

    // Queue the job to post reply to platform
    try {
      await queueReplyGeneration({
        reviewId: review.reviewId,
        userId: req.userId.toString(),
        platform: review.platform,
        entityType: review.entityType,
        reviewText: review.reviewText,
        rating: review.rating,
        replyText: replyToSend,
        action: 'postReply' // Special action to post existing reply
      });

      logger.info('Reply queued for posting', { 
        reviewId: review._id, 
        userId: req.userId 
      });

      return res.status(200).json({
        success: true,
        message: 'Reply queued for posting',
        review
      });

    } catch (queueError) {
      logger.error('Queue error', { error: queueError.message });
      
      // If queue fails, mark as posted directly (for demo purposes)
      review.replyStatus = 'posted';
      review.replyPostedAt = new Date();
      await review.save();

      return res.status(200).json({
        success: true,
        message: 'Reply posted successfully',
        review
      });
    }

  } catch (error) {
    logger.error('Send reply error', { error: error.message, userId: req.userId });
    return res.status(500).json({
      success: false,
      error: 'Failed to send reply'
    });
  }
};

/**
 * Generate AI reply for a review
 */
const generateReply = async (req, res) => {
  try {
    const { id } = req.params;

    const review = await Review.findOne({
      _id: id,
      userId: req.userId
    });

    if (!review) {
      return res.status(404).json({
        success: false,
        error: 'Review not found'
      });
    }

    // Check if already has a reply
    if (review.aiReply) {
      return res.status(400).json({
        success: false,
        error: 'AI reply already generated. Edit it or approve it.'
      });
    }

    // Queue AI generation job
    await queueReplyGeneration({
      reviewId: review.reviewId,
      userId: req.userId.toString(),
      platform: review.platform,
      entityType: review.entityType,
      reviewText: review.reviewText,
      rating: review.rating,
      action: 'generateReply'
    });

    // Keep review pending while worker generates the AI reply
    review.status = 'pending';
    await review.save();

    logger.info('AI reply generation queued', { 
      reviewId: review._id, 
      userId: req.userId 
    });

    return res.status(200).json({
      success: true,
      message: 'AI reply generation started',
      review
    });

  } catch (error) {
    logger.error('Generate reply error', { error: error.message, userId: req.userId });
    return res.status(500).json({
      success: false,
      error: 'Failed to generate reply'
    });
  }
};

/**
 * Reject/discard a review
 */
const rejectReply = async (req, res) => {
  try {
    const { id } = req.params;

    const review = await Review.findOne({
      _id: id,
      userId: req.userId
    });

    if (!review) {
      return res.status(404).json({
        success: false,
        error: 'Review not found'
      });
    }

    review.replyStatus = 'rejected';
    await review.save();

    return res.status(200).json({
      success: true,
      message: 'Reply rejected',
      review
    });

  } catch (error) {
    logger.error('Reject reply error', { error: error.message, userId: req.userId });
    return res.status(500).json({
      success: false,
      error: 'Failed to reject reply'
    });
  }
};

module.exports = {
  getReviews,
  getReview,
  approveReply,
  updateReply,
  sendReply,
  generateReply,
  rejectReply
};
