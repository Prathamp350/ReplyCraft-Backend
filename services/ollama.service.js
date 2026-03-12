const axios = require('axios');
const config = require('../config/config');

const ollamaBaseUrl = config.ollama.baseUrl;

/**
 * Send prompt to Ollama API and get response
 */
async function generateReply(model, prompt) {
  try {
    const response = await axios.post(`${ollamaBaseUrl}/api/generate`, {
      model: model,
      prompt: prompt,
      stream: false,
      options: {
        temperature: config.ollama.temperature,
        num_predict: config.ollama.maxTokens
      }
    }, {
      timeout: 60000,
      headers: {
        'Content-Type': 'application/json'
      }
    });

    return response.data.response;
  } catch (error) {
    console.error('Ollama API Error:', error.message);
    
    if (error.code === 'ECONNREFUSED') {
      throw new Error('Ollama service is not running. Please start Ollama.');
    }
    
    if (error.response) {
      throw new Error(`Ollama API error: ${error.response.status} - ${error.response.data?.error || 'Unknown error'}`);
    }
    
    throw new Error('Failed to generate reply from Ollama');
  }
}

module.exports = {
  generateReply
};
