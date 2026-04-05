const googleAIService = require('./googleAi.service');

/**
 * Legacy compatibility shim.
 * Older parts of the backend still import ollama.service.js, but the project
 * now uses Google AI. Keep this module alive so those imports do not crash the app.
 */
async function generateReply(model, prompt) {
  return googleAIService.generateText({
    model: model || process.env.GOOGLE_AI_MODEL || 'gemini-2.5-pro',
    prompt,
  });
}

module.exports = {
  generateReply,
};
