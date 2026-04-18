const axios = require('axios');
const logger = require('../utils/logger');
const { getAiRuntimeConfig } = require('./aiRuntimeConfig.service');

let BedrockRuntimeClient;
let ConverseCommand;

try {
  ({ BedrockRuntimeClient, ConverseCommand } = require('@aws-sdk/client-bedrock-runtime'));
} catch (error) {
  BedrockRuntimeClient = null;
  ConverseCommand = null;
}

const GOOGLE_AI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';
const DEFAULT_TIMEOUT_MS = parseInt(process.env.GOOGLE_AI_TIMEOUT_MS || '45000', 10);
const DEFAULT_COOLDOWN_MS = parseInt(process.env.GOOGLE_AI_KEY_COOLDOWN_MS || '900000', 10);
const DEFAULT_MAX_OUTPUT_TOKENS = parseInt(process.env.GOOGLE_AI_MAX_OUTPUT_TOKENS || '220', 10);
const DEFAULT_TEMPERATURE = parseFloat(process.env.GOOGLE_AI_TEMPERATURE || '0.45');
const DEFAULT_FLASH_MODEL = process.env.GOOGLE_AI_FLASH_MODEL || 'gemini-2.5-flash';
const DEFAULT_PRO_MODEL =
  process.env.GOOGLE_AI_PRO_MODEL ||
  process.env.GOOGLE_AI_MODEL ||
  process.env.GOOGLE_AI_FLASH_MODEL ||
  'gemini-2.5-flash';
const DEFAULT_GOOGLE_BACKUP_MODEL = process.env.GOOGLE_AI_BACKUP_MODEL || 'gemma-3-27b-it';
const DEFAULT_BEDROCK_MODEL =
  process.env.BEDROCK_CLAUDE_MODEL ||
  process.env.AWS_BEDROCK_MODEL ||
  'anthropic.claude-3-sonnet-20240229-v1:0';

const splitKeys = (value) =>
  String(value || '')
    .split(/[\n,]/)
    .map((key) => key.trim())
    .filter(Boolean);

const collectGoogleApiKeys = () => {
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

const hasBedrockCredentials = () =>
  !!(
    (process.env.AWS_ACCESS_KEY_ID || process.env.BEDROCK_ACCESS_KEY_ID) &&
    (process.env.AWS_SECRET_ACCESS_KEY || process.env.BEDROCK_SECRET_ACCESS_KEY) &&
    (process.env.AWS_REGION || process.env.BEDROCK_REGION || process.env.AWS_DEFAULT_REGION)
  );

const shouldCooldownGoogleError = (error) => {
  const status = error?.response?.status;
  const message = JSON.stringify(error?.response?.data || '').toLowerCase();

  return (
    status === 429 ||
    status === 403 ||
    message.includes('resource_exhausted') ||
    message.includes('quota') ||
    message.includes('rate limit') ||
    message.includes('api key not valid') ||
    message.includes('api_key_invalid') ||
    message.includes('permission denied')
  );
};

const isBlockedGoogleModel = (model) =>
  String(model || '')
    .trim()
    .toLowerCase()
    .includes('gemini-2.5-pro');

const sanitizeGoogleModel = (model, fallback) =>
  isBlockedGoogleModel(model) ? fallback : model;

class MultiProviderAIService {
  constructor() {
    this.googleKeyStates = collectGoogleApiKeys().map((key, index) => ({
      key,
      index,
      cooldownUntil: 0,
      lastUsedAt: 0,
      failureCount: 0,
      invalid: false,
      disabled: false,
    }));
    this.lastGoogleIndex = -1;
    this.bedrockState = {
      cooldownUntil: 0,
      failureCount: 0,
      client: null,
    };
    this.recentExecutions = [];
  }

  refreshGoogleKeys() {
    const latestKeys = collectGoogleApiKeys();
    const existingByKey = new Map(this.googleKeyStates.map((state) => [state.key, state]));

    this.googleKeyStates = latestKeys.map((key, index) => {
      const existing = existingByKey.get(key);
      return existing
        ? { ...existing, index }
        : {
            key,
            index,
            cooldownUntil: 0,
            lastUsedAt: 0,
            failureCount: 0,
            invalid: false,
            disabled: false,
          };
    });
  }

  applyGoogleKeyOverrides(runtimeConfig = {}) {
    const overrides = runtimeConfig.googleKeyOverrides || {};
    this.googleKeyStates = this.googleKeyStates.map((state) => ({
      ...state,
      disabled: overrides[String(state.index + 1)] === false,
    }));
  }

  getGoogleKeyState() {

    const now = Date.now();
    const availableStates = this.googleKeyStates.filter(
      (state) => !state.disabled && !state.invalid && state.cooldownUntil <= now
    );

    if (!availableStates.length) {
      return null;
    }

    for (let offset = 1; offset <= this.googleKeyStates.length; offset += 1) {
      const candidateIndex = (this.lastGoogleIndex + offset) % this.googleKeyStates.length;
      const candidate = this.googleKeyStates[candidateIndex];
      if (!candidate.disabled && !candidate.invalid && candidate.cooldownUntil <= now) {
        this.lastGoogleIndex = candidateIndex;
        candidate.lastUsedAt = now;
        return candidate;
      }
    }

    return availableStates[0];
  }

  markGoogleFailure(state, error) {
    if (!state) return;

    state.failureCount += 1;
    const retryAfter = parseInt(error?.response?.headers?.['retry-after'] || '0', 10);
    const message = JSON.stringify(error?.response?.data || '').toLowerCase();

    if (
      message.includes('api key not valid') ||
      message.includes('api_key_invalid') ||
      message.includes('permission denied')
    ) {
      state.invalid = true;
      state.cooldownUntil = Date.now() + 24 * 60 * 60 * 1000;
      logger.warn('Google AI key marked invalid', { keyIndex: state.index + 1 });
      return;
    }

    if (shouldCooldownGoogleError(error)) {
      const cooldownMs = retryAfter > 0 ? retryAfter * 1000 : DEFAULT_COOLDOWN_MS;
      state.cooldownUntil = Date.now() + cooldownMs;
      logger.warn('Google AI key placed on cooldown', {
        keyIndex: state.index + 1,
        cooldownMs,
        status: error?.response?.status,
      });
    }
  }

  markGoogleSuccess(state) {
    if (!state) return;
    state.failureCount = 0;
    state.cooldownUntil = 0;
    state.invalid = false;
  }

  resetGoogleKeyStates(targetIndex = null) {
    this.refreshGoogleKeys();
    this.googleKeyStates = this.googleKeyStates.map((state) => {
      if (targetIndex && state.index + 1 !== targetIndex) {
        return state;
      }

      return {
        ...state,
        cooldownUntil: 0,
        failureCount: 0,
        invalid: false,
      };
    });
  }

  extractGoogleText(responseData) {
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

  extractBedrockText(responseData) {
    const parts = responseData?.output?.message?.content || [];
    const text = parts
      .map((part) => part?.text || '')
      .join('')
      .trim();

    if (!text) {
      throw new Error('Amazon Bedrock returned an empty response.');
    }

    return text;
  }

  getBedrockClient() {
    if (!BedrockRuntimeClient || !ConverseCommand) {
      throw new Error(
        'Amazon Bedrock SDK is not installed. Run npm install @aws-sdk/client-bedrock-runtime in backend.'
      );
    }

    if (!hasBedrockCredentials()) {
      throw new Error(
        'Amazon Bedrock credentials are missing. Set AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, and AWS_REGION.'
      );
    }

    if (!this.bedrockState.client) {
      this.bedrockState.client = new BedrockRuntimeClient({
        region: process.env.AWS_REGION || process.env.BEDROCK_REGION || process.env.AWS_DEFAULT_REGION,
        credentials: {
          accessKeyId: process.env.AWS_ACCESS_KEY_ID || process.env.BEDROCK_ACCESS_KEY_ID,
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || process.env.BEDROCK_SECRET_ACCESS_KEY,
          sessionToken: process.env.AWS_SESSION_TOKEN || process.env.BEDROCK_SESSION_TOKEN,
        },
      });
    }

    return this.bedrockState.client;
  }

  resolveRouting({
    taskType = 'general',
    quality = 'standard',
    providerPreference,
    model,
    longContext = false,
    runtimeConfig = {},
  } = {}) {
    const flashModel = sanitizeGoogleModel(
      runtimeConfig.flashModel || DEFAULT_FLASH_MODEL,
      DEFAULT_FLASH_MODEL
    );
    const googleBackupModel = sanitizeGoogleModel(
      runtimeConfig.googleBackupModel || DEFAULT_GOOGLE_BACKUP_MODEL,
      flashModel
    );
    const proModel = sanitizeGoogleModel(
      runtimeConfig.proModel || DEFAULT_PRO_MODEL,
      googleBackupModel || flashModel
    );
    const reviewModel = sanitizeGoogleModel(
      runtimeConfig.reviewModel || proModel,
      proModel
    );
    const finalModel = runtimeConfig.finalModel || runtimeConfig.bedrockModel || DEFAULT_BEDROCK_MODEL;
    const bedrockModel = runtimeConfig.bedrockModel || DEFAULT_BEDROCK_MODEL;
    const bulkProvider = runtimeConfig.bulkProvider || 'google';
    const finalProvider = runtimeConfig.finalProvider || 'bedrock';
    const googleEnabled = runtimeConfig.googleEnabled !== false;
    const bedrockEnabled = runtimeConfig.bedrockEnabled === true;
    const googleFallbackAvailable =
      googleEnabled &&
      !!googleBackupModel &&
      googleBackupModel !== flashModel &&
      googleBackupModel !== proModel &&
      !String(googleBackupModel).startsWith('anthropic.');

    const googleFastSequenceBase = googleFallbackAvailable
      ? ['google-flash', 'google-backup']
      : ['google-flash'];
    const googleDeepSequenceBase = googleFallbackAvailable
      ? ['google-deep', 'google-backup', 'google-flash']
      : ['google-deep', 'google-flash'];

    const withBedrockFallback = (sequence) => {
      const base = sequence.filter((provider) => {
        if (provider.startsWith('google')) return googleEnabled;
        if (provider === 'bedrock') return bedrockEnabled;
        return true;
      });

      if (bedrockEnabled && !base.includes('bedrock')) {
        base.push('bedrock');
      }

      return [...new Set(base)];
    };

    const googleFastSequence = withBedrockFallback(googleFastSequenceBase);
    const googleDeepSequence = withBedrockFallback(googleDeepSequenceBase);

    const selectGoogleDeepModel = () => {
      if (taskType === 'review_reply' && reviewModel) {
        return reviewModel;
      }
      if (proModel) {
        return proModel;
      }
      if (googleFallbackAvailable) {
        return googleBackupModel;
      }
      return flashModel;
    };

    if (model) {
      if (String(model).startsWith('anthropic.')) {
        return {
          providerSequence: withBedrockFallback(['bedrock', 'google-deep', 'google-flash']),
          resolvedModel: model,
          taskType,
        };
      }

      return {
        providerSequence: googleDeepSequence,
        resolvedModel: sanitizeGoogleModel(model, selectGoogleDeepModel()),
        taskType,
      };
    }

    if (providerPreference === 'bedrock') {
      return {
        providerSequence: withBedrockFallback(['bedrock', 'google-deep', 'google-flash']),
        resolvedModel: bedrockEnabled ? bedrockModel : selectGoogleDeepModel(),
        taskType,
      };
    }

    if (longContext || quality === 'long_context') {
      return {
        providerSequence: googleDeepSequence,
        resolvedModel: selectGoogleDeepModel(),
        taskType,
      };
    }

    if (quality === 'final' || taskType === 'final_output') {
      return {
        providerSequence:
          finalProvider === 'google' || !bedrockEnabled
            ? googleDeepSequence
            : withBedrockFallback(['bedrock', 'google-deep', 'google-flash']),
        resolvedModel:
          finalProvider === 'google' || !bedrockEnabled ? selectGoogleDeepModel() : finalModel,
        taskType,
      };
    }

    if (taskType === 'review_reply') {
      return {
        providerSequence: googleDeepSequence,
        resolvedModel: reviewModel,
        taskType,
      };
    }

    if (taskType === 'bulk' || taskType === 'draft' || taskType === 'classification') {
      return {
        providerSequence:
          bulkProvider === 'bedrock'
            ? withBedrockFallback(['bedrock', 'google-flash', 'google-deep'])
            : googleFastSequence,
        resolvedModel: bulkProvider === 'bedrock' ? bedrockModel : flashModel,
        taskType,
      };
    }

    return {
      providerSequence: googleFastSequence,
      resolvedModel: flashModel,
      taskType,
    };
  }

  recordExecution(entry) {
    this.recentExecutions.unshift({
      timestamp: new Date().toISOString(),
      ...entry,
    });
    this.recentExecutions = this.recentExecutions.slice(0, 40);
  }

  async generateWithGoogle({ prompt, systemInstruction, model, temperature, maxOutputTokens }) {
    const attempts = [];
    const tryCount = Math.max(this.googleKeyStates.length, 1);

    while (attempts.length < tryCount) {
      const state = this.getGoogleKeyState();
      if (!state) {
        break;
      }

      try {
        const response = await axios.post(
          `${GOOGLE_AI_BASE_URL}/models/${model}:generateContent`,
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
              'x-goog-api-key': state.key,
            },
          }
        );

        this.markGoogleSuccess(state);
        return {
          text: this.extractGoogleText(response.data),
          provider: 'google',
          model,
          keyIndex: state.index + 1,
        };
      } catch (error) {
        attempts.push({
          provider: 'google',
          keyIndex: state.index + 1,
          status: error?.response?.status || 0,
          message: error?.response?.data?.error?.message || error.message,
        });
        this.markGoogleFailure(state, error);

        logger.warn('Google AI request failed on key', {
          keyIndex: state.index + 1,
          status: error?.response?.status,
          message: error?.response?.data?.error?.message || error.message,
          model,
        });
      }
    }

    const finalAttempt = attempts[attempts.length - 1];
    const error = new Error(
      finalAttempt?.message ||
        'Google AI generation failed across all configured API keys.'
    );
    error.attempts = attempts;
    throw error;
  }

  async generateWithBedrock({ prompt, systemInstruction, model, temperature, maxOutputTokens }) {
    const now = Date.now();
    if (this.bedrockState.cooldownUntil > now) {
      const waitMs = this.bedrockState.cooldownUntil - now;
      throw new Error(`Amazon Bedrock is cooling down. Retry in ${Math.ceil(waitMs / 1000)}s.`);
    }

    try {
      const client = this.getBedrockClient();
      const response = await client.send(
        new ConverseCommand({
          modelId: model || DEFAULT_BEDROCK_MODEL,
          system: systemInstruction ? [{ text: systemInstruction }] : undefined,
          messages: [
            {
              role: 'user',
              content: [{ text: prompt }],
            },
          ],
          inferenceConfig: {
            maxTokens: maxOutputTokens,
            temperature,
          },
        })
      );

      this.bedrockState.failureCount = 0;
      this.bedrockState.cooldownUntil = 0;

      return {
        text: this.extractBedrockText(response),
        provider: 'bedrock',
        model: model || DEFAULT_BEDROCK_MODEL,
      };
    } catch (error) {
      this.bedrockState.failureCount += 1;

      const message = error?.message || '';
      const shouldCooldown =
        message.toLowerCase().includes('throttl') ||
        message.toLowerCase().includes('quota') ||
        message.toLowerCase().includes('rate exceeded');

      if (shouldCooldown) {
        this.bedrockState.cooldownUntil = Date.now() + DEFAULT_COOLDOWN_MS;
      }

      logger.warn('Amazon Bedrock request failed', {
        message,
        model: model || DEFAULT_BEDROCK_MODEL,
      });

      const wrapped = new Error(message || 'Amazon Bedrock request failed.');
      wrapped.provider = 'bedrock';
      throw wrapped;
    }
  }

  async generateTextWithMetadata({
    prompt,
    systemInstruction,
    model,
    temperature = DEFAULT_TEMPERATURE,
    maxOutputTokens = DEFAULT_MAX_OUTPUT_TOKENS,
    taskType = 'general',
    quality = 'standard',
    providerPreference,
    longContext = false,
  }) {
    if (!prompt || !String(prompt).trim()) {
      throw new Error('Prompt is required for AI generation.');
    }

    this.refreshGoogleKeys();
    const runtimeConfig = await getAiRuntimeConfig();
    this.applyGoogleKeyOverrides(runtimeConfig);
    const routing = this.resolveRouting({
      taskType,
      quality,
      providerPreference,
      model,
      longContext,
      runtimeConfig,
    });

    const errors = [];

    for (const route of routing.providerSequence) {
      try {
        if (route === 'google-flash') {
          const result = await this.generateWithGoogle({
            prompt,
            systemInstruction,
            model:
              model && !String(model).startsWith('anthropic.')
                ? model
                : sanitizeGoogleModel(runtimeConfig.flashModel || DEFAULT_FLASH_MODEL, DEFAULT_FLASH_MODEL),
            temperature,
            maxOutputTokens,
          });
          this.recordExecution({ taskType, route, provider: result.provider, model: result.model, success: true });
          return result;
        }

        if (route === 'google-deep') {
          const result = await this.generateWithGoogle({
            prompt,
            systemInstruction,
            model:
              model && !String(model).startsWith('anthropic.')
                ? model
                : (taskType === 'review_reply'
                    ? sanitizeGoogleModel(
                        runtimeConfig.reviewModel || runtimeConfig.proModel || DEFAULT_PRO_MODEL,
                        runtimeConfig.googleBackupModel || runtimeConfig.flashModel || DEFAULT_FLASH_MODEL
                      )
                    : sanitizeGoogleModel(
                        runtimeConfig.proModel || DEFAULT_PRO_MODEL,
                        runtimeConfig.googleBackupModel || runtimeConfig.flashModel || DEFAULT_FLASH_MODEL
                      )),
            temperature,
            maxOutputTokens,
          });
          this.recordExecution({ taskType, route, provider: result.provider, model: result.model, success: true });
          return result;
        }

        if (route === 'google-backup') {
          const result = await this.generateWithGoogle({
            prompt,
            systemInstruction,
            model:
              model && !String(model).startsWith('anthropic.')
                ? model
                : sanitizeGoogleModel(
                    runtimeConfig.googleBackupModel || DEFAULT_GOOGLE_BACKUP_MODEL,
                    runtimeConfig.flashModel || DEFAULT_FLASH_MODEL
                  ),
            temperature,
            maxOutputTokens,
          });
          this.recordExecution({ taskType, route, provider: result.provider, model: result.model, success: true });
          return result;
        }

        if (route === 'bedrock') {
          const result = await this.generateWithBedrock({
            prompt,
            systemInstruction,
            model:
              model && String(model).startsWith('anthropic.')
                ? model
                : (runtimeConfig.bedrockModel || runtimeConfig.finalModel || DEFAULT_BEDROCK_MODEL),
            temperature,
            maxOutputTokens,
          });
          this.recordExecution({ taskType, route, provider: result.provider, model: result.model, success: true });
          return result;
        }
      } catch (error) {
        errors.push({
          route,
          message: error.message,
          attempts: error.attempts || [],
        });
        this.recordExecution({ taskType, route, provider: route.startsWith('google') ? 'google' : 'bedrock', model: routing.resolvedModel, success: false, error: error.message });
      }
    }

    const summary = errors
      .map((entry) => `${entry.route}: ${entry.message}`)
      .join(' | ');

    throw new Error(summary || 'AI generation failed across all configured providers.');
  }

  async generateText(options) {
    const result = await this.generateTextWithMetadata(options);
    return result.text;
  }

  async getHealthSnapshot() {
    this.refreshGoogleKeys();
    const runtimeConfig = await getAiRuntimeConfig();
    this.applyGoogleKeyOverrides(runtimeConfig);
    const now = Date.now();

    let bedrockStatus = {
      enabled: runtimeConfig.bedrockEnabled === true,
      configured: hasBedrockCredentials(),
      sdkInstalled: !!(BedrockRuntimeClient && ConverseCommand),
      reachable: false,
      cooldownUntil: this.bedrockState.cooldownUntil || 0,
      failureCount: this.bedrockState.failureCount,
      model: runtimeConfig.bedrockModel || runtimeConfig.finalModel || DEFAULT_BEDROCK_MODEL,
    };

    if (runtimeConfig.bedrockEnabled === true) {
      try {
        this.getBedrockClient();
        bedrockStatus = {
          ...bedrockStatus,
          reachable: true,
        };
      } catch (error) {
        bedrockStatus = {
          ...bedrockStatus,
          reachable: false,
          error: error.message,
        };
      }
    } else {
      bedrockStatus = {
        ...bedrockStatus,
        reachable: false,
        error: 'Bedrock is disabled in AI Ops runtime controls.',
      };
    }

    return {
      runtimeConfig,
      google: {
        enabled: runtimeConfig.googleEnabled !== false,
        totalKeys: this.googleKeyStates.length,
        activeKeys: this.googleKeyStates.filter((state) => !state.disabled && !state.invalid && state.cooldownUntil <= now).length,
        keys: this.googleKeyStates.map((state) => ({
          index: state.index + 1,
          enabled: !state.disabled,
          status: state.disabled ? 'disabled' : state.invalid ? 'invalid' : state.cooldownUntil > now ? 'cooling' : 'active',
          cooldownUntil: state.cooldownUntil || 0,
          failureCount: state.failureCount,
          lastUsedAt: state.lastUsedAt || 0,
        })),
      },
      bedrock: bedrockStatus,
      routing: {
        bulk: this.resolveRouting({ taskType: 'draft', runtimeConfig }),
        reviewReply: this.resolveRouting({ taskType: 'review_reply', runtimeConfig }),
        finalOutput: this.resolveRouting({ quality: 'final', runtimeConfig }),
        longContext: this.resolveRouting({ longContext: true, runtimeConfig }),
      },
      recentExecutions: this.recentExecutions,
    };
  }
}

module.exports = new MultiProviderAIService();
