/**
 * Clean and format the model response
 */
function cleanReply(rawReply) {
  if (!rawReply) {
    return '';
  }

  let cleaned = rawReply.trim();

  // Remove any text in brackets (square, round, curly)
  cleaned = cleaned.replace(/[\[\](){}]/g, '');

  // Remove placeholder text patterns
  const placeholderPatterns = [
    /\[.*?\]/g,
    /\[restaurant\s*name\]/gi,
    /\[your\s*name\]/gi,
    /\[business\s*name\]/gi,
    /company\s*name/gi,
    /restaurant\s*name/gi
  ];

  for (const pattern of placeholderPatterns) {
    cleaned = cleaned.replace(pattern, '');
  }

  // Remove closing phrases and signatures
  const closingPatterns = [
    /best\s*regards[.,\s]*/gi,
    /sincerely[.,\s]*/gi,
    /kind\s*regards[.,\s]*/gi,
    /warm\s*regards[.,\s]*/gi,
    /regards[.,\s]*/gi,
    /thank\s*you[.,\s]*(and\s*)?(have\s*a\s*)?(great|good|nice)\s*day.*$/gi,
    /thanks[.,\s]*(and\s*)?(have\s*a\s*)?(great|good|nice)\s*day.*$/gi,
    /customer\s*support[.,\s]*/gi,
    /the\s*team[.,\s]*/gi,
    /from\s*the\s*team[.,\s]*/gi,
    /management[.,\s]*/gi,
    /owner[.,\s]*/gi,
    /\.\s*$/ // Remove trailing period if it ends with just punctuation
  ];

  for (const pattern of closingPatterns) {
    cleaned = cleaned.replace(pattern, '');
  }

  // Remove multiple spaces
  cleaned = cleaned.replace(/\s+/g, ' ');

  // Remove newlines within the reply
  cleaned = cleaned.replace(/\n+/g, ' ');

  // Remove common prefixes the model might add
  const prefixesToRemove = [
    /^sure[, ]*/i,
    /^of course[, ]*/i,
    /^certainly[, ]*/i,
    /^here is.*:/i,
    /^here's a.*:/i,
    /^response:/i,
    /^reply:/i,
    /^thank you for.*:/i
  ];

  for (const prefix of prefixesToRemove) {
    cleaned = cleaned.replace(prefix, '');
  }

  // Trim again after all cleaning
  cleaned = cleaned.trim();

  // Ensure it ends with proper punctuation
  if (cleaned && !/[.!?]$/.test(cleaned)) {
    cleaned += '.';
  }

  // Final check - if it's too long or has multiple sentences, truncate
  const sentences = cleaned.split(/[.!?]+/);
  if (sentences.length > 2) {
    cleaned = sentences.slice(0, 2).join('. ').trim();
    if (!/[.!?]$/.test(cleaned)) {
      cleaned += '.';
    }
  }

  return cleaned;
}

module.exports = {
  cleanReply
};
