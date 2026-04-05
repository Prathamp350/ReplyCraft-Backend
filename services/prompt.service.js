/**
 * Detect tone of customer review
 */
function detectTone(review) {
  const text = review.toLowerCase();

  const positiveWords = ["great", "amazing", "excellent", "love", "perfect", "good", "awesome", "wonderful", "fantastic", "delicious"];
  const negativeWords = ["bad", "terrible", "slow", "worst", "awful", "poor", "disappointed", "waited", "horrible", "rude"];

  if (negativeWords.some(word => text.includes(word))) {
    return "apologetic";
  }

  if (positiveWords.some(word => text.includes(word))) {
    return "friendly";
  }

  return "professional";
}

/**
 * Build optimized prompt for reply generation with restaurant profile context
 */
function buildPrompt(review, restaurantProfile = null, aiConfiguration = null, metadata = {}) {
  const tone = detectTone(review);

  // Default values if no profile
  const restaurantName =
    metadata.businessName ||
    aiConfiguration?.businessName ||
    restaurantProfile?.restaurantName ||
    'our business';
  const cuisineType = restaurantProfile?.cuisineType || '';
  const brandTone = aiConfiguration?.brandTone || restaurantProfile?.brandTone || 'professional';
  const emojiAllowed = aiConfiguration?.emojiAllowed ?? restaurantProfile?.emojiAllowed ?? false;
  const authorName = metadata.author || 'the customer';
  const rating = metadata.rating ? `${metadata.rating}/5` : 'unknown';
  const platform = metadata.platform || 'review platform';

  // Build cuisine context
  const cuisineContext = cuisineType ? `Cuisine type: ${cuisineType}\n` : '';

  // Build emoji instruction
  const emojiInstruction = emojiAllowed 
    ? 'You may include one relevant emoji where appropriate.' 
    : 'Do not use emojis.';

  // Build tone instruction based on brand tone
  const toneInstructions = {
    casual: 'Use a casual, relaxed tone. Be friendly and conversational.',
    professional: 'Use a professional but warm tone. Be polite and business-appropriate.',
    friendly: 'Use a warm, friendly tone. Be enthusiastic and personable.'
  };

  const prompt = `You are writing a reply for "${restaurantName}" on ${platform}.

${cuisineContext}Brand tone: ${brandTone}
${toneInstructions[brandTone]}
${emojiInstruction}

Tone: ${tone}
Reviewer: ${authorName}
Rating: ${rating}

Write a short natural reply to the customer review.

Rules:
- Maximum 2 sentences
- Thank the customer
- Address the feedback
- Sound like a real business owner, not a bot
- No signatures
- No placeholders
- No brackets
- No closing phrases like "Best regards"

Examples:
Review: "Amazing food and great service!"
Reply: "Thank you for the wonderful feedback! We're glad you enjoyed both the food and service."

Review: "Food was good but service slow."
Reply: "Thank you for your feedback. We're glad you enjoyed the food and apologize for the slow service."

Review: "Terrible experience. Waited 40 minutes."
Reply: "We're sorry to hear about your experience and appreciate you bringing this to our attention. We'll work on improving our service."

Customer Review:
"${review}"

Reply:
`;

  return prompt;
}

module.exports = {
  buildPrompt,
  detectTone
};
