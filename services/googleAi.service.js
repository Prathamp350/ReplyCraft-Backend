const axios = require('axios');
const logger = require('../utils/logger');

const GOOGLE_AI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';
const DEFAULT_MODEL = process.env.GOOGLE_AI_MODEL || 'gemini-2.5-pro';
const DEFAULT_TIMEOUT_MS = parseInt(process.env.GOOGLE_AI_TIMEOUT_MS || '45000', 10);
const DEFAULT_COOLDOWN_MS = parseInt(process.env.GOOGLE_AI_KEY_COOLDOWN_MS || '900000', 10);
const DEFAULT_MAX_OUTPUT_TOKENS = parseInt(process.env.GOOGLE_AI_MAX_OUTPUT_TOKENS || '220', 10);
const DEFAULT_TEMPERATURE = parseFloat(process.env.GOOGLE_AI_TEMPERATURE || '0.45');

const splitKeys = (value) =>
  String(value || '')
    .split(/[\n,]/)
    .map((key) => key.trim())
    .filter(Boolean);

const collectApiKeys = () => {
  const keys = [
    ...splitKeys(process.env.GOOGLE_AI_API_KEYS),
    ...splitKeys(process.env.GOOGLE_AI_API_KEY),
    ...splitKeys(process.env.GEMINI_API_KEY),
  ];

  for (let index = 1; index <= 20; index += 1) {
    keys.push(...splitKeys(process.env[`GOOGLE_AI_API_KEY_${index}`]));
    keys.push(...splitKeys(process.env[`GEMINI_API_KEY_${index}`]));
  }

  return [...new Set(keys)];
};

class GoogleAIService {
  constructor() {
    this.keyStates = collectApiKeys().map((key, index) => ({
      key,
      index,
      cooldownUntil: 0,
      lastUsedAt: 0,
      failureCount: 0,
    }));
    this.lastIndex = -1;
  }

  refreshKeys() {
    const latestKeys = collectApiKeys();
    const existingByKey = new Map(this.keyStates.map((state) => [state.key, state]));

    this.keyStates = latestKeys.map((key, index) => {
      const existing = existingByKey.get(key);
      return existing
        ? { ...existing, index }
        : {
            key,
            index,
            cooldownUntil: 0,
            lastUsedAt: 0,
            failureCount: 0,
          };
    });
  }

  getAvailableKeyState() {
    this.refreshKeys();

    if (!this.keyStates.length) {
      throw new Error(
        'No Google AI API keys configured. Set GOOGLE_AI_API_KEYS or GOOGLE_AI_API_KEY_1..N in backend/.env.'
      );
    }

    const now = Date.now();
    const availableStates = this.keyStates.filter((state) => state.cooldownUntil <= now);

    if (!availableStates.length) {
      const nextReadyAt = Math.min(...this.keyStates.map((state) => state.cooldownUntil));
      const waitMs = Math.max(nextReadyAt - now, 1000);
      throw new Error(`All Google AI API keys are cooling down. Retry in ${Math.ceil(waitMs / 1000)}s.`);
    }

    for (let offset = 1; offset <= this.keyStates.length; offset += 1) {
      const candidateIndex = (this.lastIndex + offset) % this.keyStates.length;
      const candidate = this.keyStates[candidateIndex];
      if (candidate.cooldownUntil <= now) {
        this.lastIndex = candidateIndex;
        candidate.lastUsedAt = now;
        return candidate;
      }
    }

    const fallback = availableStates[0];
    this.lastIndex = fallback.index;
    fallback.lastUsedAt = now;
    return fallback;
  }

  markFailure(state, error) {
    state.failureCount += 1;

    const status = error?.response?.status;
    const retryAfter = parseInt(error?.response?.headers?.['retry-after'] || '0', 10);
    const message = JSON.stringify(error?.response?.data || '').toLowerCase();
    const quotaLimited =
      status === 429 ||
      message.includes('resource_exhausted') ||
      message.includes('quota') ||
      message.includes('rate limit');

    if (quotaLimited) {
      const cooldownMs = retryAfter > 0 ? retryAfter * 1000 : DEFAULT_COOLDOWN_MS;
      state.cooldownUntil = Date.now() + cooldownMs;
      logger.warn('Google AI key placed on cooldown', {
        keyIndex: state.index + 1,
        cooldownMs,
        status,
      });
    }
  }

  markSuccess(state) {
    state.failureCount = 0;
    state.cooldownUntil = 0;
  }

  extractText(responseData) {
    const candidates = responseData?.candidates || [];
    const parts = candidates[0]?.content?.parts || [];
    const text = parts
      .map((part) => part?.text || '')
      .join('')
      .trim();

    if (!text) {
      throw new Error('Google AI returned an empty response.');
    }

    return text;
  }

  async generateText({
    prompt,
    systemInstruction,
    model = DEFAULT_MODEL,
    temperature = DEFAULT_TEMPERATURE,
    maxOutputTokens = DEFAULT_MAX_OUTPUT_TOKENS,
  }) {
    if (!prompt || !String(prompt).trim()) {
      throw new Error('Prompt is required for Google AI generation.');
    }

    const attempts = [];

    while (attempts.length < Math.max(this.keyStates.length, 1)) {
      const state = this.getAvailableKeyState();

      try {
        const response = await axios.post(
          `${GOOGLE_AI_BASE_URL}/models/${model}:generateContent?key=${encodeURIComponent(state.key)}`,
          {
            ...(systemInstruction
              ? {
                  systemInstruction: {
                    parts: [{ text: systemInstruction }],
                  },
                }
              : {}),
            contents: [
              {
                role: 'user',
                parts: [{ text: prompt }],
              },
            ],
            generationConfig: {
              temperature,
              maxOutputTokens,
            },
          },
          {
            timeout: DEFAULT_TIMEOUT_MS,
            headers: {
              'Content-Type': 'application/json',
            },
          }
        );

        this.markSuccess(state);
        return this.extractText(response.data);
      } catch (error) {
        attempts.push({
          keyIndex: state.index + 1,
          status: error?.response?.status || 0,
          message: error?.response?.data?.error?.message || error.message,
        });
        this.markFailure(state, error);

        logger.warn('Google AI request failed on key', {
          keyIndex: state.index + 1,
          status: error?.response?.status,
          message: error?.response?.data?.error?.message || error.message,
        });
      }
    }

    const finalAttempt = attempts[attempts.length - 1];
    throw new Error(
      finalAttempt?.message || 'Google AI generation failed across all configured API keys.'
    );
  }
}

module.exports = new GoogleAIService();
