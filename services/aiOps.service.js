const googleAiService = require('./googleAi.service');
const Ticket = require('../models/Ticket');
const SystemConfig = require('../models/SystemConfig');

const defaultAiOpsConfig = {
  globalEnabled: false,
  marketingEnabled: true,
  supportEnabled: true,
  financeEnabled: true,
  emergencyStop: false,
  supportAutoEmail: false,
  marketingAutoSend: false,
  financeAutoSend: false,
  blockDestructiveActions: true,
  blockRoleChanges: true,
  blockPlanChanges: true,
  lastUpdatedAt: null,
};

const parseJsonResponse = (text) => {
  const trimmed = String(text || '').trim();
  const fenced = trimmed.match(/```json\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : trimmed;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  const jsonText = start >= 0 && end > start ? candidate.slice(start, end + 1) : candidate;
  return JSON.parse(jsonText);
};

async function getSystemConfig() {
  let config = await SystemConfig.findOne({ configId: 'global' });
  if (!config) {
    config = await SystemConfig.create({ configId: 'global' });
  }
  return config;
}

async function getAiOpsConfig() {
  const config = await getSystemConfig();
  return {
    ...defaultAiOpsConfig,
    ...(config.aiOps || {}),
  };
}

async function updateAiOpsConfig(patch, userId = null) {
  const config = await getSystemConfig();
  config.aiOps = {
    ...defaultAiOpsConfig,
    ...(config.aiOps || {}),
    ...patch,
    lastUpdatedAt: new Date(),
  };
  if (userId) {
    config.updatedBy = userId;
  }
  await config.save();
  return config.aiOps;
}

async function assertAiScopeEnabled(scope) {
  const config = await getAiOpsConfig();
  if (!config.globalEnabled || config.emergencyStop) {
    const error = new Error('AI Ops is currently disabled by the admin failsafe.');
    error.statusCode = 409;
    throw error;
  }

  if (scope === 'marketing' && !config.marketingEnabled) {
    const error = new Error('Marketing AI is currently disabled.');
    error.statusCode = 409;
    throw error;
  }

  if (scope === 'support' && !config.supportEnabled) {
    const error = new Error('Support AI is currently disabled.');
    error.statusCode = 409;
    throw error;
  }

  if (scope === 'finance' && !config.financeEnabled) {
    const error = new Error('Finance AI is currently disabled.');
    error.statusCode = 409;
    throw error;
  }

  return config;
}

async function generateMarketingDraft({ brief, audienceSummary }) {
  await assertAiScopeEnabled('marketing');

  const response = await googleAiService.generateText({
    systemInstruction:
      'You are ReplyCraft marketing AI. Draft polished SaaS campaign copy. Never suggest legal guarantees, fake discounts, or misleading urgency. Return valid JSON only.',
    prompt: `Create a marketing email draft for ReplyCraft.

Audience summary: ${audienceSummary || 'General platform users'}
Campaign brief: ${brief}

Return JSON with:
{
  "subject": "short subject line",
  "preheader": "short inbox preview text",
  "body": "plain text email body with paragraphs"
}`,
    maxOutputTokens: 700,
    temperature: 0.55,
  });

  return parseJsonResponse(response);
}

async function generateFinanceDraft({ brief, mode = 'renewal_reminder', audienceSummary }) {
  await assertAiScopeEnabled('finance');

  const response = await googleAiService.generateText({
    systemInstruction:
      'You are ReplyCraft finance AI. Draft calm, precise, non-threatening billing communication. Never promise refunds or plan changes unless explicitly stated. Return valid JSON only.',
    prompt: `Create a finance communication draft for ReplyCraft.

Mode: ${mode}
Audience summary: ${audienceSummary || 'Current customers'}
Brief: ${brief}

Return JSON with:
{
  "subject": "short subject line",
  "preheader": "preview text",
  "body": "plain text email body with paragraphs",
  "internalSummary": "one sentence for staff"
}`,
    maxOutputTokens: 700,
    temperature: 0.35,
  });

  return parseJsonResponse(response);
}

async function generateSupportDraft(ticketId) {
  await assertAiScopeEnabled('support');

  const ticket = await Ticket.findOne({ ticketId }).populate('assignedTo', 'name role');
  if (!ticket) {
    const error = new Error('Ticket not found');
    error.statusCode = 404;
    throw error;
  }

  const notesSummary = (ticket.notes || [])
    .slice(-6)
    .map((note) => `${note.authorName}: ${note.content}`)
    .join('\n');

  const response = await googleAiService.generateText({
    systemInstruction:
      'You are ReplyCraft support AI. Help resolve tickets politely and clearly. You may draft replies, but you must never claim the ticket is closed or resolved by the customer unless they have confirmed satisfaction. Return valid JSON only.',
    prompt: `Draft a support response for this ticket.

Ticket ID: ${ticket.ticketId}
Customer name: ${ticket.name}
Customer email: ${ticket.email}
Subject: ${ticket.subject}
Status: ${ticket.status}
Priority: ${ticket.priority}
Customer message:
${ticket.message}

Recent internal notes:
${notesSummary || 'No notes yet.'}

Return JSON with:
{
  "replySubject": "short subject line",
  "replyBody": "email body to customer in plain text",
  "internalNote": "concise note for staff",
  "recommendedStatus": "open or in-progress or resolved",
  "requiresCustomerConfirmation": true,
  "resolutionChecklist": ["item 1", "item 2"]
}`,
    maxOutputTokens: 800,
    temperature: 0.4,
  });

  return {
    ticket,
    draft: parseJsonResponse(response),
  };
}

module.exports = {
  defaultAiOpsConfig,
  getAiOpsConfig,
  updateAiOpsConfig,
  assertAiScopeEnabled,
  generateMarketingDraft,
  generateFinanceDraft,
  generateSupportDraft,
};
