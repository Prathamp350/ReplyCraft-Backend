const Ticket = require('../models/Ticket');
const logger = require('../utils/logger');
const {
  defaultAiOpsConfig,
  getAiOpsConfig,
  updateAiOpsConfig,
  assertAiScopeEnabled,
  generateMarketingDraft,
  generateFinanceDraft,
  generateSupportDraft,
} = require('../services/aiOps.service');
const googleAiService = require('../services/googleAi.service');
const { queueSupportAiReplyEmail } = require('../queues/email.queue');

const safeSupportStatus = (value) => {
  if (value === 'resolved') return 'resolved';
  if (value === 'in-progress') return 'in-progress';
  return 'open';
};

const aiOpsController = {
  getConfig: async (req, res) => {
    try {
      const config = await getAiOpsConfig();
      return res.status(200).json({ success: true, config });
    } catch (error) {
      logger.error('Failed to fetch AI ops config', { error: error.message });
      return res.status(500).json({ success: false, error: 'Failed to fetch AI ops configuration' });
    }
  },

  updateConfig: async (req, res) => {
    try {
      const allowed = [
        'globalEnabled',
        'marketingEnabled',
        'supportEnabled',
        'financeEnabled',
        'emergencyStop',
        'supportAutoEmail',
        'marketingAutoSend',
        'financeAutoSend',
        'blockDestructiveActions',
        'blockRoleChanges',
        'blockPlanChanges',
        'googleEnabled',
        'bedrockEnabled',
        'flashModel',
        'proModel',
        'reviewModel',
        'googleBackupModel',
        'finalModel',
        'bedrockModel',
        'bulkProvider',
        'finalProvider',
      ];
      const patch = Object.fromEntries(
        Object.entries(req.body || {}).filter(([key]) => allowed.includes(key))
      );
      const config = await updateAiOpsConfig(patch, req.user?._id);
      return res.status(200).json({ success: true, config });
    } catch (error) {
      logger.error('Failed to update AI ops config', { error: error.message });
      return res.status(500).json({ success: false, error: 'Failed to update AI ops configuration' });
    }
  },

  getProviderHealth: async (_req, res) => {
    try {
      const health = await googleAiService.getHealthSnapshot();
      return res.status(200).json({ success: true, health });
    } catch (error) {
      logger.error('Failed to fetch AI provider health', { error: error.message });
      return res.status(500).json({ success: false, error: 'Failed to fetch AI provider health' });
    }
  },

  updateGoogleKeyState: async (req, res) => {
    try {
      const keyIndex = parseInt(req.params.index, 10);
      if (!Number.isInteger(keyIndex) || keyIndex < 1) {
        return res.status(400).json({ success: false, error: 'Invalid key index' });
      }

      const enabled = req.body?.enabled !== false;
      const config = await getAiOpsConfig();
      const nextOverrides = {
        ...(config.googleKeyOverrides || {}),
        [String(keyIndex)]: enabled,
      };

      const updated = await updateAiOpsConfig({ googleKeyOverrides: nextOverrides }, req.user?._id);
      const health = await googleAiService.getHealthSnapshot();
      return res.status(200).json({ success: true, config: updated, health });
    } catch (error) {
      logger.error('Failed to update Google key state', { error: error.message });
      return res.status(500).json({ success: false, error: 'Failed to update Google key state' });
    }
  },

  refreshGoogleKeys: async (req, res) => {
    try {
      const keyIndex = req.body?.index ? parseInt(req.body.index, 10) : null;
      if (keyIndex !== null && (!Number.isInteger(keyIndex) || keyIndex < 1)) {
        return res.status(400).json({ success: false, error: 'Invalid key index' });
      }

      googleAiService.resetGoogleKeyStates(keyIndex);
      const health = await googleAiService.getHealthSnapshot();
      return res.status(200).json({
        success: true,
        message: keyIndex
          ? `Gemini key ${keyIndex} state refreshed.`
          : 'All Gemini key cooldown and invalid states refreshed.',
        health,
      });
    } catch (error) {
      logger.error('Failed to refresh Google key states', { error: error.message });
      return res.status(500).json({ success: false, error: 'Failed to refresh Google key states' });
    }
  },

  generateMarketingDraft: async (req, res) => {
    try {
      const draft = await generateMarketingDraft({
        brief: String(req.body?.brief || '').trim(),
        audienceSummary: String(req.body?.audienceSummary || '').trim(),
      });
      return res.status(200).json({ success: true, draft });
    } catch (error) {
      return res.status(error.statusCode || 500).json({ success: false, error: error.message || 'Failed to generate marketing draft' });
    }
  },

  generateFinanceDraft: async (req, res) => {
    try {
      const draft = await generateFinanceDraft({
        brief: String(req.body?.brief || '').trim(),
        mode: String(req.body?.mode || 'renewal_reminder').trim(),
        audienceSummary: String(req.body?.audienceSummary || '').trim(),
      });
      return res.status(200).json({ success: true, draft });
    } catch (error) {
      return res.status(error.statusCode || 500).json({ success: false, error: error.message || 'Failed to generate finance draft' });
    }
  },

  generateSupportDraft: async (req, res) => {
    try {
      const result = await generateSupportDraft(req.params.ticketId);
      await Ticket.updateOne(
        { ticketId: req.params.ticketId },
        { aiLastSuggestion: result.draft.replyBody || null }
      );

      return res.status(200).json({
        success: true,
        draft: result.draft,
        ticket: result.ticket,
      });
    } catch (error) {
      return res.status(error.statusCode || 500).json({ success: false, error: error.message || 'Failed to generate support draft' });
    }
  },

  sendSupportDraft: async (req, res) => {
    try {
      const config = await assertAiScopeEnabled('support');
      if (!config.supportAutoEmail) {
        return res.status(409).json({
          success: false,
          error: 'Support AI email sending is disabled in Guardrails.',
        });
      }

      const { subject, body, internalNote, recommendedStatus } = req.body || {};
      if (!subject || !String(subject).trim() || !body || !String(body).trim()) {
        return res.status(400).json({ success: false, error: 'Subject and body are required' });
      }

      const ticket = await Ticket.findOne({ ticketId: req.params.ticketId });
      if (!ticket) {
        return res.status(404).json({ success: false, error: 'Ticket not found' });
      }

      await queueSupportAiReplyEmail({
        to: ticket.email,
        name: ticket.name,
        ticketId: ticket.ticketId,
        subject: String(subject).trim(),
        messageHtml: String(body).trim(),
      });

      ticket.awaitingCustomerConfirmation = true;
      ticket.customerSatisfied = false;
      ticket.lastCustomerContactAt = new Date();
      ticket.aiLastSentAt = new Date();
      ticket.aiLastSuggestion = String(body).trim();
      ticket.status = safeSupportStatus(recommendedStatus);
      ticket.notes.push({
        author: req.user._id,
        authorName: `${req.user.name} (AI Ops)`,
        content: internalNote
          ? `AI sent customer update: ${String(internalNote).trim()}`
          : 'AI sent a customer-facing support response and is waiting for customer confirmation.',
      });
      await ticket.save();

      return res.status(200).json({
        success: true,
        message: `AI support reply queued for ${ticket.ticketId}. The ticket stays open until customer satisfaction is confirmed.`,
        ticket,
      });
    } catch (error) {
      logger.error('Failed to send AI support draft', { error: error.message, stack: error.stack });
      return res.status(500).json({ success: false, error: 'Failed to send AI support reply' });
    }
  },

  markTicketSatisfaction: async (req, res) => {
    try {
      const { satisfied } = req.body || {};
      const ticket = await Ticket.findOne({ ticketId: req.params.ticketId });
      if (!ticket) {
        return res.status(404).json({ success: false, error: 'Ticket not found' });
      }

      ticket.customerSatisfied = !!satisfied;
      ticket.awaitingCustomerConfirmation = !satisfied;
      if (satisfied) {
        ticket.status = 'closed';
      } else if (ticket.status === 'closed') {
        ticket.status = 'resolved';
      }

      ticket.notes.push({
        author: req.user._id,
        authorName: req.user.name,
        content: satisfied
          ? 'Customer satisfaction confirmed. Ticket can be safely closed.'
          : 'Customer has not confirmed satisfaction yet. Keeping ticket open for follow-up.',
      });
      await ticket.save();

      return res.status(200).json({ success: true, ticket });
    } catch (error) {
      logger.error('Failed to update ticket satisfaction', { error: error.message });
      return res.status(500).json({ success: false, error: 'Failed to update customer satisfaction' });
    }
  },
};

module.exports = aiOpsController;
