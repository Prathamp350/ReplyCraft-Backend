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
function buildPrompt(review, restaurantProfile = null) {
  const tone = detectTone(review);

  // Default values if no profile
  const restaurantName = restaurantProfile?.restaurantName || 'our restaurant';
  const cuisineType = restaurantProfile?.cuisineType || '';
  const brandTone = restaurantProfile?.brandTone || 'professional';
  const emojiAllowed = restaurantProfile?.emojiAllowed || false;

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

  const prompt = `You are writing a reply for the restaurant "${restaurantName}".

${cuisineContext}Brand tone: ${brandTone}
${toneInstructions[brandTone]}
${emojiInstruction}

Tone: ${tone}

Write a short natural reply to the customer review.

Rules:
- Maximum 2 sentences
- Thank the customer
- Address the feedback
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
