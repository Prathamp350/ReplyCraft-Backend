const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

// ================================================================
//  SINGLE SOURCE OF TRUTH — Plans & Pricing (Backend)
//  Mirrors frontend/src/data/plans-config.ts
//  Edit BOTH files when changing plan data.
// ================================================================

const plans = {
  free: {
    name: 'Free',
    monthlyLimit: 30,
    perMinute: 5,
    platformLimit: 1,
    storageMB: 10,
    hasWatermark: true,
    canBuyExtraStorage: false,
    priceINR: 0,
    priceUSD: 0,
    features: [
      '1 platform',
      'Basic AI replies',
      'Standard speed',
      'ReplyCraft watermark',
      '10 MB storage',
    ],
  },
  starter: {
    name: 'Starter',
    monthlyLimit: 300,
    perMinute: 10,
    platformLimit: 1,
    storageMB: 100,
    hasWatermark: false,
    canBuyExtraStorage: true,
    priceINR: 299,
    priceUSD: 5,
    features: [
      '1 platform',
      'Improved AI quality',
      'Faster replies',
      'Basic tone customization',
      'No watermark',
      '100 MB storage',
    ],
  },
  pro: {
    name: 'Pro',
    monthlyLimit: 1500,
    perMinute: 30,
    platformLimit: 3,
    storageMB: 500,
    hasWatermark: false,
    canBuyExtraStorage: true,
    priceINR: 999,
    priceUSD: 15,
    features: [
      '3 platforms',
      'Advanced tone control',
      'Priority speed',
      'Analytics dashboard',
      'Save reply templates',
      'No watermark',
      '500 MB storage',
    ],
  },
  business: {
    name: 'Business',
    monthlyLimit: 5000,
    perMinute: 100,
    platformLimit: Infinity, // unlimited
    storageMB: 2000,
    hasWatermark: false,
    canBuyExtraStorage: true,
    priceINR: 2499,
    priceUSD: 35,
    features: [
      'All platforms',
      'Team access (up to 5)',
      'Custom tone training',
      'Advanced analytics',
      'Priority support',
      'White-glove onboarding',
      'No watermark',
      '2 GB storage',
    ],
  },
};

const validPlans = Object.keys(plans);

// Extra storage pricing
const extraStorage = {
  blockSizeMB: 100,
  basePriceINR: 49, // ₹49 per 100 MB/month
};

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
  
  plans,
  defaultPlan: 'free',
  validPlans,
  extraStorage,

  // Watermark appended to Free plan AI replies
  watermarkText: '\n\n— Powered by ReplyCraft',
};
