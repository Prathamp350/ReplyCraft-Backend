const Review = require('../models/Review');
const Insight = require('../models/Insight');
const ollamaService = require('./ollama.service');
const config = require('../config/config');

/**
 * Review Insights Service
 * Analyzes reviews to extract trends, complaints, praises, and keywords
 */
class ReviewInsightsService {
  /**
   * Generate weekly insights for a user
   * @param {string} userId - User ID
   * @returns {Object} - Generated insights
   */
  async generateWeeklyInsights(userId) {
    // 1. Get reviews from last 7 days
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    
    const reviews = await Review.find({
      userId: userId,
      createdAt: { $gte: sevenDaysAgo }
    }).sort({ createdAt: -1 });
    
    if (reviews.length === 0) {
      return null;
    }
    
    // 2. Calculate basic statistics
    const stats = this._calculateStats(reviews);
    
    // 3. Extract keywords and themes
    const analysis = this._analyzeReviews(reviews);
    
    // 4. Generate AI summary
    let summary = null;
    try {
      summary = await this._generateAISummary(reviews, analysis);
    } catch (error) {
      console.error('AI summary generation failed:', error.message);
    }
    
    // 5. Create and save insight
    const insight = new Insight({
      userId,
      topComplaints: analysis.complaints,
      topPraises: analysis.praises,
      commonKeywords: analysis.keywords,
      reviewCount: stats.total,
      averageRating: stats.averageRating,
      positivePercentage: stats.positivePercentage,
      negativePercentage: stats.negativePercentage,
      neutralPercentage: stats.neutralPercentage,
      platformBreakdown: stats.platformBreakdown,
      periodStart: sevenDaysAgo,
      periodEnd: new Date(),
      summary
    });
    
    await insight.save();
    
    return insight;
  }

  /**
   * Calculate review statistics
   * @private
   */
  _calculateStats(reviews) {
    const total = reviews.length;
    const ratingSum = reviews.reduce((sum, r) => sum + (r.rating || 0), 0);
    const averageRating = total > 0 ? (ratingSum / total).toFixed(1) : 0;
    
    const sentimentCounts = {
      positive: 0,
      negative: 0,
      neutral: 0,
      unknown: 0
    };
    
    const platformCounts = {
      google: 0,
      yelp: 0,
      tripadvisor: 0,
      appstore: 0,
      playstore: 0
    };
    
    reviews.forEach(review => {
      // Count sentiments
      const sentiment = review.sentiment || 'unknown';
      sentimentCounts[sentiment] = (sentimentCounts[sentiment] || 0) + 1;
      
      // Count platforms
      const platform = review.platform || 'google';
      platformCounts[platform] = (platformCounts[platform] || 0) + 1;
    });
    
    return {
      total,
      averageRating: parseFloat(averageRating),
      positivePercentage: Math.round((sentimentCounts.positive / total) * 100),
      negativePercentage: Math.round((sentimentCounts.negative / total) * 100),
      neutralPercentage: Math.round((sentimentCounts.neutral / total) * 100),
      platformBreakdown: platformCounts
    };
  }

  /**
   * Analyze reviews for keywords, complaints, and praises
   * @private
   */
  _analyzeReviews(reviews) {
    // Common complaint keywords
    const complaintKeywords = [
      'slow', 'bad', 'poor', 'cold', 'wait', 'rude', 'dirty', 'expensive',
      'overpriced', 'mistake', 'wrong', 'late', 'terrible', 'awful', 'worst',
      'disappointed', 'never', 'hate', 'horrible', 'long', 'queue'
    ];
    
    // Common praise keywords
    const praiseKeywords = [
      'great', 'good', 'excellent', 'amazing', 'love', 'best', 'friendly',
      'fast', 'fresh', 'delicious', 'wonderful', 'perfect', 'awesome',
      'recommend', 'fantastic', 'outstanding', 'nice', 'quick', 'helpful'
    ];
    
    const keywordCounts = {};
    const complaintMatches = {};
    const praiseMatches = {};
    
    reviews.forEach(review => {
      const text = (review.reviewText || '').toLowerCase();
      const words = text.split(/\s+/);
      
      // Count all keywords
      words.forEach(word => {
        const cleanWord = word.replace(/[^a-z]/g, '');
        if (cleanWord.length > 3) {
          keywordCounts[cleanWord] = (keywordCounts[cleanWord] || 0) + 1;
        }
      });
      
      // Find complaints
      complaintKeywords.forEach(keyword => {
        if (text.includes(keyword)) {
          if (!complaintMatches[keyword]) {
            complaintMatches[keyword] = { count: 0, examples: [] };
          }
          complaintMatches[keyword].count++;
          if (complaintMatches[keyword].examples.length < 2) {
            complaintMatches[keyword].examples.push(review.reviewText);
          }
        }
      });
      
      // Find praises
      praiseKeywords.forEach(keyword => {
        if (text.includes(keyword)) {
          if (!praiseMatches[keyword]) {
            praiseMatches[keyword] = { count: 0, examples: [] };
          }
          praiseMatches[keyword].count++;
          if (praiseMatches[keyword].examples.length < 2) {
            praiseMatches[keyword].examples.push(review.reviewText);
          }
        }
      });
    });
    
    // Convert to arrays and sort
    const topComplaints = Object.entries(complaintMatches)
      .map(([keyword, data]) => ({ keyword, ...data }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
    
    const topPraises = Object.entries(praiseMatches)
      .map(([keyword, data]) => ({ keyword, ...data }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
    
    const commonKeywords = Object.entries(keywordCounts)
      .map(([keyword, count]) => ({ keyword, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 20);
    
    return {
      complaints: topComplaints,
      praises: topPraises,
      keywords: commonKeywords
    };
  }

  /**
   * Generate AI summary of reviews
   * @private
   */
  async _generateAISummary(reviews, analysis) {
    const model = config.ollama.model || 'llama2';
    
    const reviewTexts = reviews.slice(0, 10).map(r => r.reviewText).join('\n- ');
    const prompt = `Analyze these customer reviews and provide a brief summary (2-3 sentences) of the main feedback. Focus on overall sentiment and key themes.

Reviews:
- ${reviewTexts}

Summary:`;
    
    try {
      const summary = await ollamaService.generateReply(model, prompt);
      return summary.trim();
    } catch (error) {
      console.error('Failed to generate AI summary:', error.message);
      return null;
    }
  }

  /**
   * Get latest insights for a user
   * @param {string} userId - User ID
   * @returns {Object|null} - Latest insight or null
   */
  async getLatestInsights(userId) {
    return await Insight.findOne({ userId })
      .sort({ generatedAt: -1 });
  }

  /**
   * Get insight history for a user
   * @param {string} userId - User ID
   * @param {number} limit - Number of insights to return
   * @returns {Array} - Array of insights
   */
  async getInsightHistory(userId, limit = 4) {
    return await Insight.find({ userId })
      .sort({ generatedAt: -1 })
      .limit(limit);
  }
}

module.exports = new ReviewInsightsService();
