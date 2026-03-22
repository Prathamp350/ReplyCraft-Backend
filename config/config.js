const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

module.exports = {
  port: process.env.PORT || 3000,
  nodeEnv: process.env.NODE_ENV || 'development',
  
  mongodb: {
    uri: process.env.MONGODB_URI || 'mongodb://localhost:27017/replycraft'
  },
  
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT) || 6379
  },
  
  jwt: {
    secret: process.env.JWT_SECRET || 'your-super-secret-jwt-key-change-in-production',
    expiresIn: process.env.JWT_EXPIRES_IN || '7d'
  },
  
  ollama: {
    baseUrl: process.env.OLLAMA_BASE_URL || 'http://localhost:11434',
    defaultModel: process.env.OLLAMA_DEFAULT_MODEL || 'mistral',
    temperature: parseFloat(process.env.OLLAMA_TEMPERATURE) || 0.3,
    maxTokens: parseInt(process.env.OLLAMA_MAX_TOKENS) || 60
  },
  
  allowedModels: (process.env.ALLOWED_MODELS || 'phi3,mistral,llama3,qwen3.5').split(','),
  
  // Plan Limits
  plans: {
    free: {
      name: 'Free',
      monthlyLimit: 30,
      perMinute: 5
    },
    starter: {
      name: 'Starter',
      monthlyLimit: 300,
      perMinute: 10
    },
    pro: {
      name: 'Pro',
      monthlyLimit: 1500,
      perMinute: 30
    },
    business: {
      name: 'Business',
      monthlyLimit: 5000,
      perMinute: 100
    }
  },
  
  defaultPlan: 'free',
  validPlans: ['free', 'starter', 'pro', 'business']
};
