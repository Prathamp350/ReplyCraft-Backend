const User = require('../models/User');
const TrackingEvent = require('../models/TrackingEvent');
const ActiveSession = require('../models/ActiveSession');
const BusinessConnection = require('../models/BusinessConnection');
const Review = require('../models/Review');
const Ticket = require('../models/Ticket');
const AuditLog = require('../models/AuditLog');
const AiExecutionLog = require('../models/AiExecutionLog');
const logger = require('../utils/logger');
const { getConfig, refreshConfig } = require('../services/configManager');
const baseConfig = require('../config/config');
const SystemConfig = require('../models/SystemConfig');
const PromoCode = require('../models/PromoCode');
const { queueMarketingBroadcastEmail } = require('../queues/email.queue');

const churnStatuses = ['canceled', 'expired', 'past_due', 'unpaid'];

const buildUserFilter = (query = {}) => {
  const {
    search,
    plan,
    subscriptionStatus,
    country,
    state,
    paid,
    churned,
    isActive,
    dateFrom,
    dateTo,
  } = query;

  const filter = { role: 'user' };

  if (search) {
    const escaped = String(search).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    filter.$or = [
      { name: { $regex: escaped, $options: 'i' } },
      { email: { $regex: escaped, $options: 'i' } },
      { appliedPromoCode: { $regex: escaped, $options: 'i' } },
      { businessName: { $regex: escaped, $options: 'i' } },
    ];
  }

  if (plan && plan !== 'all') filter.plan = plan;
  if (typeof paid === 'string' && paid === 'true' && !filter.plan) filter.plan = { $ne: 'free' };
  if (subscriptionStatus && subscriptionStatus !== 'all') filter.subscriptionStatus = subscriptionStatus;
  if (country && country !== 'all') filter.country = country;
  if (state && state !== 'all') filter.state = state;
  if (typeof isActive === 'string' && isActive !== 'all') filter.isActive = isActive === 'true';

  if (typeof churned === 'string' && churned === 'true') {
    filter.subscriptionStatus = { $in: churnStatuses };
  }

  if (dateFrom || dateTo) {
    filter.createdAt = {};
    if (dateFrom) filter.createdAt.$gte = new Date(dateFrom);
    if (dateTo) filter.createdAt.$lte = new Date(dateTo);
  }

  return filter;
};

const buildSessionFilter = (query = {}) => {
  const {
    search,
    plan,
    subscriptionStatus,
    country,
    state,
    activeWindowMinutes,
  } = query;

  const filter = {};

  if (search) {
    const escaped = String(search).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    filter.$or = [
      { userName: { $regex: escaped, $options: 'i' } },
      { userEmail: { $regex: escaped, $options: 'i' } },
      { businessName: { $regex: escaped, $options: 'i' } },
      { pagePath: { $regex: escaped, $options: 'i' } },
      { country: { $regex: escaped, $options: 'i' } },
      { state: { $regex: escaped, $options: 'i' } },
    ];
  }

  if (plan && plan !== 'all') filter.plan = plan;
  if (subscriptionStatus && subscriptionStatus !== 'all') filter.subscriptionStatus = subscriptionStatus;
  if (country && country !== 'all') filter.country = country;
  if (state && state !== 'all') filter.state = state;

  const activeMinutes = Math.min(Math.max(parseInt(activeWindowMinutes, 10) || 15, 5), 180);
  filter.lastSeenAt = {
    $gte: new Date(Date.now() - activeMinutes * 60 * 1000),
  };

  return filter;
};

const formatRelativeTime = (date) => {
  if (!date) return 'just now';

  const diffMs = Date.now() - new Date(date).getTime();
  const diffSeconds = Math.max(0, Math.floor(diffMs / 1000));

  if (diffSeconds < 60) return `${diffSeconds}s ago`;
  if (diffSeconds < 3600) return `${Math.floor(diffSeconds / 60)}m ago`;
  if (diffSeconds < 86400) return `${Math.floor(diffSeconds / 3600)}h ago`;
  return `${Math.floor(diffSeconds / 86400)}d ago`;
};

const buildUserLookupMatch = (query = {}) => {
  const match = { 'user.role': 'user' };

  if (query.plan && query.plan !== 'all') match['user.plan'] = query.plan;
  if (query.subscriptionStatus && query.subscriptionStatus !== 'all') {
    match['user.subscriptionStatus'] = query.subscriptionStatus;
  }
  if (query.country && query.country !== 'all') match['user.country'] = query.country;
  if (query.state && query.state !== 'all') match['user.state'] = query.state;

  return match;
};

const buildSearchMatch = (search, fields) => {
  if (!search) return null;

  const escaped = String(search).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (!escaped) return null;

  return {
    $or: fields.map((field) => ({
      [field]: { $regex: escaped, $options: 'i' },
    })),
  };
};

const escapeHtml = (value = '') =>
  String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const toMarketingHtml = (message = '') => {
  const safe = escapeHtml(message);
  return safe
    .split(/\n{2,}/)
    .map((paragraph) => `<p style="margin:0 0 18px;">${paragraph.replace(/\n/g, '<br />')}</p>`)
    .join('');
};

const parseManualEmails = (value) =>
  String(value || '')
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);

const isValidEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());

const STAFF_SIDEBAR_PRESETS = ['midnight', 'ocean', 'emerald', 'royal'];

const getOrCreateSystemConfig = async () => {
  let configDoc = await SystemConfig.findOne({ configId: 'global' });
  if (!configDoc) {
    configDoc = await SystemConfig.create({ configId: 'global' });
  }
  return configDoc;
};

const getStaffUiConfig = async (req, res) => {
  try {
    const configDoc = await getOrCreateSystemConfig();
    return res.status(200).json({
      success: true,
      staffUi: {
        sidebarPreset: configDoc.staffUi?.sidebarPreset || 'midnight',
        updatedAt: configDoc.staffUi?.updatedAt || null,
        availablePresets: STAFF_SIDEBAR_PRESETS,
      },
    });
  } catch (error) {
    logger.error('Failed to fetch staff UI config', { error: error.message });
    return res.status(500).json({ success: false, error: 'Failed to fetch staff UI config' });
  }
};

const updateStaffUiConfig = async (req, res) => {
  try {
    const { sidebarPreset } = req.body || {};

    if (!STAFF_SIDEBAR_PRESETS.includes(String(sidebarPreset || ''))) {
      return res.status(400).json({
        success: false,
        error: `Invalid sidebar preset. Must be one of: ${STAFF_SIDEBAR_PRESETS.join(', ')}`,
      });
    }

    const configDoc = await getOrCreateSystemConfig();
    configDoc.staffUi = {
      ...(configDoc.staffUi || {}),
      sidebarPreset,
      updatedAt: new Date(),
    };
    configDoc.updatedBy = req.userId;
    configDoc.markModified('staffUi');
    await configDoc.save();

    return res.status(200).json({
      success: true,
      staffUi: {
        sidebarPreset: configDoc.staffUi.sidebarPreset,
        updatedAt: configDoc.staffUi.updatedAt,
        availablePresets: STAFF_SIDEBAR_PRESETS,
      },
    });
  } catch (error) {
    logger.error('Failed to update staff UI config', { error: error.message });
    return res.status(500).json({ success: false, error: 'Failed to update staff UI config' });
  }
};

/**
 * Create a new staff account
 * Superadmin can create: admin, finance, support, superadmin
 * Admin can create: finance, support
 */
const createStaff = async (req, res) => {
  try {
    const { name, email, password, role } = req.body;

    if (!name || !email || !password || !role) {
      return res.status(400).json({
        success: false,
        error: 'Name, email, password, and role are required'
      });
    }

    const validRoles = ['support', 'finance', 'admin', 'superadmin'];
    if (!validRoles.includes(role)) {
      return res.status(400).json({
        success: false,
        error: `Invalid role. Must be one of: ${validRoles.join(', ')}`
      });
    }

    // Hierarchy enforcement: admin can only create finance and support
    if (req.user.role === 'admin' && ['admin', 'superadmin'].includes(role)) {
      return res.status(403).json({
        success: false,
        error: 'Admins can only create finance and support accounts'
      });
    }

    let user = await User.findOne({ email: email.toLowerCase() });
    if (user) {
      return res.status(400).json({
        success: false,
        error: 'User with this email already exists'
      });
    }

    user = new User({
      name: name.trim(),
      email: email.toLowerCase(),
      password,
      role: role,
      plan: baseConfig.defaultPlan,
      isEmailVerified: true,
      isOnboarded: true
    });

    await user.save();
    logger.logAuth(`Staff account created by ${req.user.email}`, { newUserId: user._id, role: user.role });

    return res.status(201).json({
      success: true,
      message: 'Staff account created successfully',
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role
      }
    });

  } catch (error) {
    logger.error('Create Staff Error', { error: error.message, stack: error.stack });
    return res.status(500).json({
      success: false,
      error: 'Failed to create staff account'
    });
  }
};

/**
 * List staff accounts
 * Superadmin sees all staff. Admin sees finance + support only.
 */
const listStaff = async (req, res) => {
  try {
    let roleFilter;
    if (req.user.role === 'superadmin') {
      roleFilter = ['support', 'finance', 'admin', 'superadmin'];
    } else {
      roleFilter = ['support', 'finance'];
    }

    const staff = await User.find({
      role: { $in: roleFilter }
    }).select('name email role isActive createdAt avatarUrl').sort({ createdAt: -1 });

    return res.status(200).json({
      success: true,
      staff
    });
  } catch (error) {
    logger.error('List Staff Error', { error: error.message });
    return res.status(500).json({ success: false, error: 'Failed to list staff' });
  }
};

/**
 * Deactivate a staff account
 */
const deleteStaff = async (req, res) => {
  try {
    const staffUser = await User.findById(req.params.id);
    if (!staffUser) {
      return res.status(404).json({ success: false, error: 'Staff member not found' });
    }

    // Cannot deactivate yourself
    if (staffUser._id.toString() === req.user._id.toString()) {
      return res.status(400).json({ success: false, error: 'Cannot deactivate your own account' });
    }

    // Admin cannot deactivate admin or superadmin
    if (req.user.role === 'admin' && ['admin', 'superadmin'].includes(staffUser.role)) {
      return res.status(403).json({ success: false, error: 'Insufficient permissions' });
    }

    staffUser.isActive = false;
    await staffUser.save();

    logger.logAuth(`Staff account deactivated by ${req.user.email}`, { staffId: staffUser._id, role: staffUser.role });

    return res.status(200).json({
      success: true,
      message: 'Staff account deactivated'
    });
  } catch (error) {
    logger.error('Delete Staff Error', { error: error.message });
    return res.status(500).json({ success: false, error: 'Failed to deactivate staff' });
  }
};

module.exports = {
  createStaff,
  listStaff,
  deleteStaff,
  getStaffUiConfig,
  updateStaffUiConfig,

  // --- Promo Codes ---
  createPromo: async (req, res) => {
    try {
      const { code, discountPercent, applicablePlan, maxUses, validUntil } = req.body;
      const promo = new PromoCode({
        code, discountPercent, applicablePlan, maxUses, validUntil, createdBy: req.userId
      });
      await promo.save();
      return res.status(201).json({ success: true, promo });
    } catch (error) {
      if (error.code === 11000) return res.status(400).json({ success: false, error: 'Promo code already exists' });
      return res.status(500).json({ success: false, error: 'Failed to create promo code' });
    }
  },

  listPromos: async (req, res) => {
    try {
      const promos = await PromoCode.find().populate('createdBy', 'name email').sort({ createdAt: -1 });
      return res.status(200).json({ success: true, promos });
    } catch (error) {
      return res.status(500).json({ success: false, error: 'Failed to fetch promos' });
    }
  },

  deletePromo: async (req, res) => {
    try {
      await PromoCode.findByIdAndDelete(req.params.id);
      return res.status(200).json({ success: true });
    } catch (error) {
      return res.status(500).json({ success: false, error: 'Failed to delete promo' });
    }
  },

  // --- Dynamic Plans ---
  getPlans: async (req, res) => {
    try {
      return res.status(200).json({ success: true, plans: getConfig().plans });
    } catch (error) {
      return res.status(500).json({ success: false, error: 'Failed to fetch planes' });
    }
  },

  updatePlan: async (req, res) => {
    try {
      const { planId } = req.params;
      const updates = req.body;
      
      const configDoc = await SystemConfig.findOne({ configId: 'global' });
      if (!configDoc) return res.status(404).json({ success: false, error: 'Config not found' });

      configDoc.plans[planId] = { ...configDoc.plans[planId], ...updates };
      configDoc.markModified(`plans.${planId}`);
      configDoc.updatedBy = req.userId;
      await configDoc.save();

      // IMPORTANT: refresh cache instantly across backend
      await refreshConfig();

      return res.status(200).json({ success: true, plan: configDoc.plans[planId] });
    } catch (error) {
      return res.status(500).json({ success: false, error: 'Failed to update plan' });
    }
  },

  // --- Live Users & Stats ---
  getUsers: async (req, res) => {
    try {
      const { page = 1, limit = 25 } = req.query;
      const parsedPage = Math.max(parseInt(page, 10) || 1, 1);
      const parsedLimit = Math.min(Math.max(parseInt(limit, 10) || 25, 1), 100);
      const skip = (parsedPage - 1) * parsedLimit;
      const filter = buildUserFilter(req.query);

      const [users, total, countries, states] = await Promise.all([
        User.find(filter)
          .select('name email plan subscriptionStatus storageUsedBytes extraStorageMB createdAt appliedPromoCode isActive businessName country state city monthlyUsage subscriptionCurrentPeriodEnd planExpiresAt')
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(parsedLimit),
        User.countDocuments(filter),
        User.distinct('country', { role: 'user', country: { $nin: [null, ''] } }),
        User.distinct('state', { role: 'user', state: { $nin: [null, ''] } }),
      ]);

      return res.status(200).json({
        success: true,
        users,
        pagination: {
          page: parsedPage,
          limit: parsedLimit,
          total,
          totalPages: Math.ceil(total / parsedLimit),
        },
        filters: {
          countries: countries.filter(Boolean).sort(),
          states: states.filter(Boolean).sort(),
          plans: Object.keys(getConfig().plans),
          subscriptionStatuses: ['active', 'trialing', 'past_due', 'canceled', 'unpaid', 'expired'],
        },
      });
    } catch (error) {
      return res.status(500).json({ success: false, error: 'Failed to fetch users' });
    }
  },

  getMarketingAudience: async (req, res) => {
    try {
      const filter = buildUserFilter(req.query);
      const [totalRecipients, countries, states] = await Promise.all([
        User.countDocuments(filter),
        User.distinct('country', { role: 'user', country: { $nin: [null, ''] } }),
        User.distinct('state', { role: 'user', state: { $nin: [null, ''] } }),
      ]);

      return res.status(200).json({
        success: true,
        audience: {
          totalRecipients,
          filters: {
            countries: countries.filter(Boolean).sort(),
            states: states.filter(Boolean).sort(),
            plans: Object.keys(getConfig().plans),
            subscriptionStatuses: ['active', 'trialing', 'past_due', 'canceled', 'unpaid', 'expired'],
          },
        },
      });
    } catch (error) {
      logger.error('Failed to fetch marketing audience', { error: error.message });
      return res.status(500).json({ success: false, error: 'Failed to load marketing audience' });
    }
  },

  sendMarketingBroadcast: async (req, res) => {
    try {
      const {
        subject,
        message,
        preheader,
        customEmails,
        search,
        plan,
        subscriptionStatus,
        country,
        state,
        paid,
        churned,
        isActive,
        dateFrom,
        dateTo,
      } = req.body || {};

      if (!subject || !String(subject).trim()) {
        return res.status(400).json({ success: false, error: 'Email subject is required' });
      }

      if (!message || !String(message).trim()) {
        return res.status(400).json({ success: false, error: 'Email message is required' });
      }

      const filter = buildUserFilter({
        search,
        plan,
        subscriptionStatus,
        country,
        state,
        paid,
        churned,
        isActive,
        dateFrom,
        dateTo,
      });

      const platformRecipients = await User.find(filter)
        .select('name email plan subscriptionStatus country state')
        .lean();

      const manualEmailList = [...new Set(parseManualEmails(customEmails))];
      const invalidManualEmails = manualEmailList.filter((email) => !isValidEmail(email));

      if (invalidManualEmails.length) {
        return res.status(400).json({
          success: false,
          error: `Invalid email address: ${invalidManualEmails[0]}`,
        });
      }

      const manualRecipients = manualEmailList.map((email) => ({
        name: email.split('@')[0] || 'there',
        email,
        plan: 'manual',
      }));

      const recipientsByEmail = new Map();
      [...platformRecipients, ...manualRecipients].forEach((recipient) => {
        if (!recipient?.email) return;
        recipientsByEmail.set(String(recipient.email).trim().toLowerCase(), recipient);
      });

      const recipients = [...recipientsByEmail.values()];

      if (!recipients.length) {
        return res.status(404).json({ success: false, error: 'No matching users found for this audience.' });
      }

      const messageHtml = toMarketingHtml(String(message).trim());
      const trimmedSubject = String(subject).trim();
      const trimmedPreheader = String(preheader || '').trim();

      await Promise.all(
        recipients.map((recipient) =>
          queueMarketingBroadcastEmail({
            to: recipient.email,
            name: recipient.name || 'there',
            subject: trimmedSubject,
            preheader: trimmedPreheader || trimmedSubject,
            messageHtml,
            audienceLabel: recipient.plan || 'free',
          })
        )
      );

      logger.info('Marketing broadcast queued', {
        queuedBy: req.user?.email,
        recipientCount: recipients.length,
        subject: trimmedSubject,
      });

      return res.status(200).json({
        success: true,
        message: `Broadcast queued for ${recipients.length} user${recipients.length === 1 ? '' : 's'}.`,
        queuedRecipients: recipients.length,
        manualRecipients: manualRecipients.length,
      });
    } catch (error) {
      logger.error('Failed to queue marketing broadcast', { error: error.message, stack: error.stack });
      return res.status(500).json({ success: false, error: 'Failed to queue marketing email' });
    }
  },

  getStats: async (req, res) => {
    try {
      const activeUsers = await User.countDocuments({ role: 'user', isActive: true });
      const paidUsers = await User.countDocuments({ role: 'user', isActive: true, plan: { $ne: 'free' } });
      const freeUsers = await User.countDocuments({ role: 'user', isActive: true, plan: 'free' });
      const staffUsers = await User.countDocuments({ role: { $in: ['support', 'finance', 'admin', 'superadmin'] }, isActive: true });

      return res.status(200).json({ 
        success: true, 
        stats: { activeUsers, freeUsers, paidUsers, staffUsers }
      });
    } catch (error) {
      return res.status(500).json({ success: false, error: 'Failed to fetch live stats' });
    }
  },

  getAnalyticsOverview: async (req, res) => {
    try {
      const totalUsers = await User.countDocuments({ role: 'user' });
      const activeUsers = await User.countDocuments({ role: 'user', isActive: true });
      const freeUsers = await User.countDocuments({ role: 'user', isActive: true, plan: 'free' });
      const paidUsers = await User.countDocuments({ role: 'user', isActive: true, plan: { $ne: 'free' } });
      const churnedUsers = await User.countDocuments({ role: 'user', subscriptionStatus: { $in: churnStatuses } });
      const onboardedUsers = await User.countDocuments({ role: 'user', isOnboarded: true });
      const verifiedUsers = await User.countDocuments({ role: 'user', isEmailVerified: true });

      const now = new Date();
      const last30Days = new Date(now);
      last30Days.setDate(now.getDate() - 30);
      const previous30Days = new Date(now);
      previous30Days.setDate(now.getDate() - 60);
      const trendStart = new Date(now.getFullYear(), now.getMonth() - 11, 1);

      const [
        signupsLast30Days,
        signupsPrevious30Days,
        planDistribution,
        subscriptionDistribution,
        countryDistribution,
        stateDistribution,
        signupTrend,
      ] = await Promise.all([
        User.countDocuments({ role: 'user', createdAt: { $gte: last30Days } }),
        User.countDocuments({ role: 'user', createdAt: { $gte: previous30Days, $lt: last30Days } }),
        User.aggregate([
          { $match: { role: 'user' } },
          { $group: { _id: '$plan', users: { $sum: 1 } } },
          { $project: { _id: 0, label: '$_id', users: 1 } },
          { $sort: { users: -1 } },
        ]),
        User.aggregate([
          { $match: { role: 'user' } },
          { $group: { _id: { $ifNull: ['$subscriptionStatus', 'none'] }, users: { $sum: 1 } } },
          { $project: { _id: 0, label: '$_id', users: 1 } },
          { $sort: { users: -1 } },
        ]),
        User.aggregate([
          { $match: { role: 'user', country: { $nin: [null, ''] } } },
          { $group: { _id: '$country', users: { $sum: 1 } } },
          { $project: { _id: 0, label: '$_id', users: 1 } },
          { $sort: { users: -1 } },
          { $limit: 15 },
        ]),
        User.aggregate([
          { $match: { role: 'user', state: { $nin: [null, ''] } } },
          { $group: { _id: '$state', users: { $sum: 1 } } },
          { $project: { _id: 0, label: '$_id', users: 1 } },
          { $sort: { users: -1 } },
          { $limit: 15 },
        ]),
        User.aggregate([
          { $match: { role: 'user', createdAt: { $gte: trendStart } } },
          {
            $group: {
              _id: {
                year: { $year: '$createdAt' },
                month: { $month: '$createdAt' },
              },
              users: { $sum: 1 },
            },
          },
          { $sort: { '_id.year': 1, '_id.month': 1 } },
        ]),
      ]);

      const conversionRate = totalUsers > 0 ? Number(((paidUsers / totalUsers) * 100).toFixed(1)) : 0;
      const churnRate = totalUsers > 0 ? Number(((churnedUsers / totalUsers) * 100).toFixed(1)) : 0;
      const growthDelta =
        signupsPrevious30Days > 0
          ? Number((((signupsLast30Days - signupsPrevious30Days) / signupsPrevious30Days) * 100).toFixed(1))
          : signupsLast30Days > 0
            ? 100
            : 0;

      return res.status(200).json({
        success: true,
        analytics: {
          totals: {
            totalUsers,
            activeUsers,
            freeUsers,
            paidUsers,
            churnedUsers,
            onboardedUsers,
            verifiedUsers,
          },
          rates: {
            conversionRate,
            churnRate,
            growthDelta,
          },
          planDistribution,
          subscriptionDistribution,
          countryDistribution,
          stateDistribution,
          signupTrend: signupTrend.map((entry) => ({
            month: `${String(entry._id.month).padStart(2, '0')}/${String(entry._id.year).slice(-2)}`,
            users: entry.users,
          })),
        },
      });
    } catch (error) {
      logger.error('Admin analytics overview error', { error: error.message });
      return res.status(500).json({ success: false, error: 'Failed to fetch admin analytics overview' });
    }
  },

  getGodModeAnalytics: async (req, res) => {
    try {
      const activeFilter = buildSessionFilter(req.query);
      const userLookupMatch = buildUserLookupMatch(req.query);
      const recentEventsWindowHours = Math.min(Math.max(parseInt(req.query.eventWindowHours, 10) || 24, 1), 168);
      const recentEventsSince = new Date(Date.now() - recentEventsWindowHours * 60 * 60 * 1000);
      const reviewWindowDays = Math.min(Math.max(parseInt(req.query.reviewWindowDays, 10) || 7, 1), 90);
      const reviewWindowSince = new Date(Date.now() - reviewWindowDays * 24 * 60 * 60 * 1000);
      const alertWindowHours = Math.min(Math.max(parseInt(req.query.alertWindowHours, 10) || 24, 1), 168);
      const alertWindowSince = new Date(Date.now() - alertWindowHours * 60 * 60 * 1000);

      const eventFilter = {
        createdAt: { $gte: recentEventsSince },
        eventType: { $ne: 'heartbeat' },
      };

      if (req.query.country && req.query.country !== 'all') {
        eventFilter['metadata.country'] = req.query.country;
      }

      if (req.query.state && req.query.state !== 'all') {
        eventFilter['metadata.state'] = req.query.state;
      }

      const businessPipeline = [
        { $match: { isActive: true, status: 'active' } },
        {
          $lookup: {
            from: 'users',
            localField: 'userId',
            foreignField: '_id',
            as: 'user',
          },
        },
        { $unwind: '$user' },
        { $match: userLookupMatch },
      ];

      const businessSearchMatch = buildSearchMatch(req.query.search, [
        'locationName',
        'locationId',
        'platform',
        'user.businessName',
        'user.name',
        'user.email',
      ]);

      if (businessSearchMatch) businessPipeline.push({ $match: businessSearchMatch });

      const reviewPipeline = [
        { $match: { createdAt: { $gte: reviewWindowSince } } },
        {
          $lookup: {
            from: 'users',
            localField: 'userId',
            foreignField: '_id',
            as: 'user',
          },
        },
        { $unwind: '$user' },
        { $match: userLookupMatch },
      ];

      const reviewSearchMatch = buildSearchMatch(req.query.search, [
        'author',
        'platform',
        'reviewText',
        'user.businessName',
        'user.name',
        'user.email',
      ]);

      if (reviewSearchMatch) reviewPipeline.push({ $match: reviewSearchMatch });

      const alertPipeline = [
        { $match: { createdAt: { $gte: alertWindowSince }, rating: { $lte: 2 } } },
        {
          $lookup: {
            from: 'users',
            localField: 'userId',
            foreignField: '_id',
            as: 'user',
          },
        },
        { $unwind: '$user' },
        { $match: userLookupMatch },
      ];

      if (reviewSearchMatch) alertPipeline.push({ $match: reviewSearchMatch });

      const [
        activeSessions,
        totalActiveSessions,
        totalRecentEvents,
        recentEvents,
        mapCountries,
        stateDistribution,
        planBreakdown,
        activeUserCount,
        activeCountries,
        activeStates,
        businessSummary,
        businessCountries,
        businessPlatforms,
        reviewSummary,
        reviewCountries,
        reviewPlatforms,
        alertSummary,
        alertHotspots,
        recentNegativeReviews,
        recentTickets,
      ] = await Promise.all([
        ActiveSession.find(activeFilter)
          .sort({ lastSeenAt: -1 })
          .limit(25)
          .select('sessionId userId userName userEmail plan subscriptionStatus businessName pagePath country countryCode state city timezone deviceType eventType lastSeenAt'),
        ActiveSession.countDocuments(activeFilter),
        TrackingEvent.countDocuments(eventFilter),
        TrackingEvent.find(eventFilter)
          .sort({ createdAt: -1 })
          .limit(20)
          .select('eventType pagePath sessionId userId metadata createdAt'),
        ActiveSession.aggregate([
          { $match: activeFilter },
          {
            $group: {
              _id: {
                countryCode: '$countryCode',
                country: '$country',
              },
              sessions: { $sum: 1 },
              users: { $addToSet: '$userId' },
            },
          },
          {
            $project: {
              _id: 0,
              code: '$_id.countryCode',
              label: '$_id.country',
              sessions: 1,
              users: {
                $size: {
                  $filter: {
                    input: '$users',
                    as: 'userId',
                    cond: { $ne: ['$$userId', null] },
                  },
                },
              },
            },
          },
          { $sort: { sessions: -1 } },
        ]),
        ActiveSession.aggregate([
          { $match: { ...activeFilter, state: { $nin: [null, ''] } } },
          {
            $group: {
              _id: {
                state: '$state',
                country: '$country',
              },
              sessions: { $sum: 1 },
              users: { $addToSet: '$userId' },
            },
          },
          {
            $project: {
              _id: 0,
              label: '$_id.state',
              country: '$_id.country',
              sessions: 1,
              users: {
                $size: {
                  $filter: {
                    input: '$users',
                    as: 'userId',
                    cond: { $ne: ['$$userId', null] },
                  },
                },
              },
            },
          },
          { $sort: { sessions: -1 } },
          { $limit: 20 },
        ]),
        ActiveSession.aggregate([
          { $match: activeFilter },
          {
            $group: {
              _id: '$plan',
              sessions: { $sum: 1 },
            },
          },
          {
            $project: {
              _id: 0,
              label: { $ifNull: ['$_id', 'unknown'] },
              sessions: 1,
            },
          },
          { $sort: { sessions: -1 } },
        ]),
        ActiveSession.distinct('userId', { ...activeFilter, userId: { $ne: null } }).then((ids) => ids.length),
        ActiveSession.distinct('country', { ...activeFilter, country: { $nin: [null, ''] } }),
        ActiveSession.distinct('state', { ...activeFilter, state: { $nin: [null, ''] } }),
        BusinessConnection.aggregate([
          ...businessPipeline,
          {
            $group: {
              _id: null,
              totalConnections: { $sum: 1 },
              connectedUsers: { $addToSet: '$userId' },
            },
          },
          {
            $project: {
              _id: 0,
              totalConnections: 1,
              connectedUsers: {
                $size: {
                  $filter: {
                    input: '$connectedUsers',
                    as: 'userId',
                    cond: { $ne: ['$$userId', null] },
                  },
                },
              },
            },
          },
        ]),
        BusinessConnection.aggregate([
          ...businessPipeline,
          {
            $group: {
              _id: {
                country: '$user.country',
              },
              connections: { $sum: 1 },
              users: { $addToSet: '$userId' },
            },
          },
          { $match: { '_id.country': { $nin: [null, ''] } } },
          {
            $project: {
              _id: 0,
              label: '$_id.country',
              connections: 1,
              users: {
                $size: {
                  $filter: {
                    input: '$users',
                    as: 'userId',
                    cond: { $ne: ['$$userId', null] },
                  },
                },
              },
            },
          },
          { $sort: { connections: -1 } },
          { $limit: 10 },
        ]),
        BusinessConnection.aggregate([
          ...businessPipeline,
          {
            $group: {
              _id: '$platform',
              connections: { $sum: 1 },
            },
          },
          { $project: { _id: 0, label: '$_id', connections: 1 } },
          { $sort: { connections: -1 } },
        ]),
        Review.aggregate([
          ...reviewPipeline,
          {
            $group: {
              _id: null,
              totalReviews: { $sum: 1 },
              negativeReviews: {
                $sum: {
                  $cond: [{ $lte: ['$rating', 2] }, 1, 0],
                },
              },
              awaitingApproval: {
                $sum: {
                  $cond: [{ $eq: ['$replyStatus', 'pending'] }, 1, 0],
                },
              },
            },
          },
          {
            $project: {
              _id: 0,
              totalReviews: 1,
              negativeReviews: 1,
              awaitingApproval: 1,
            },
          },
        ]),
        Review.aggregate([
          ...reviewPipeline,
          {
            $group: {
              _id: '$user.country',
              reviews: { $sum: 1 },
              negativeReviews: {
                $sum: {
                  $cond: [{ $lte: ['$rating', 2] }, 1, 0],
                },
              },
            },
          },
          { $match: { _id: { $nin: [null, ''] } } },
          { $project: { _id: 0, label: '$_id', reviews: 1, negativeReviews: 1 } },
          { $sort: { reviews: -1 } },
          { $limit: 10 },
        ]),
        Review.aggregate([
          ...reviewPipeline,
          {
            $group: {
              _id: '$platform',
              reviews: { $sum: 1 },
            },
          },
          { $project: { _id: 0, label: '$_id', reviews: 1 } },
          { $sort: { reviews: -1 } },
        ]),
        Review.aggregate([
          ...alertPipeline,
          {
            $group: {
              _id: null,
              negativeReviews: { $sum: 1 },
              criticalHotspots: {
                $addToSet: {
                  country: '$user.country',
                  state: '$user.state',
                },
              },
            },
          },
          {
            $project: {
              _id: 0,
              negativeReviews: 1,
              criticalHotspots: {
                $size: {
                  $filter: {
                    input: '$criticalHotspots',
                    as: 'spot',
                    cond: { $ne: ['$$spot.country', null] },
                  },
                },
              },
            },
          },
        ]),
        Review.aggregate([
          ...alertPipeline,
          {
            $group: {
              _id: {
                country: '$user.country',
                state: '$user.state',
              },
              negativeReviews: { $sum: 1 },
              averageRating: { $avg: '$rating' },
            },
          },
          { $match: { '_id.country': { $nin: [null, ''] } } },
          {
            $project: {
              _id: 0,
              country: '$_id.country',
              state: { $ifNull: ['$_id.state', 'Unknown region'] },
              negativeReviews: 1,
              averageRating: { $round: ['$averageRating', 1] },
              severity: {
                $cond: [
                  { $gte: ['$negativeReviews', 5] },
                  'critical',
                  {
                    $cond: [{ $gte: ['$negativeReviews', 3] }, 'elevated', 'watch'],
                  },
                ],
              },
            },
          },
          { $sort: { negativeReviews: -1 } },
          { $limit: 10 },
        ]),
        Review.aggregate([
          ...alertPipeline,
          { $sort: { createdAt: -1 } },
          { $limit: 8 },
          {
            $project: {
              _id: 1,
              platform: 1,
              rating: 1,
              reviewText: 1,
              author: 1,
              createdAt: 1,
              country: '$user.country',
              state: '$user.state',
              businessName: '$user.businessName',
            },
          },
        ]),
        Ticket.find({ createdAt: { $gte: recentEventsSince } })
          .sort({ createdAt: -1 })
          .limit(8)
          .select('ticketId subject status priority createdAt name email'),
      ]);

      const totalTrackedUsers = await TrackingEvent.distinct('userId', { userId: { $ne: null } }).then((ids) => ids.length);

      const eventsByType = await TrackingEvent.aggregate([
        { $match: eventFilter },
        { $group: { _id: '$eventType', count: { $sum: 1 } } },
        {
          $project: {
            _id: 0,
            label: '$_id',
            count: 1,
          },
        },
        { $sort: { count: -1 } },
      ]);

      const mergedFeed = [
        ...recentEvents.map((event) => ({
          id: `event_${event._id}`,
          kind: 'tracking',
          eventType: event.eventType,
          label: formatRelativeTime(event.createdAt),
          title: event.eventType,
          pagePath: event.pagePath,
          country: event.metadata?.country || 'Unknown',
          state: event.metadata?.state || null,
          city: event.metadata?.city || null,
          timezone: event.metadata?.timezone || null,
          deviceType: event.metadata?.deviceType || null,
          createdAt: event.createdAt,
        })),
        ...recentNegativeReviews.map((review) => ({
          id: `review_${review._id}`,
          kind: 'review_alert',
          eventType: 'negative_review',
          label: formatRelativeTime(review.createdAt),
          title: `${review.platform} ${review.rating}-star review`,
          pagePath: review.businessName || review.author || 'Review alert',
          country: review.country || 'Unknown',
          state: review.state || null,
          city: null,
          timezone: null,
          deviceType: null,
          createdAt: review.createdAt,
        })),
        ...recentTickets.map((ticket) => ({
          id: `ticket_${ticket._id}`,
          kind: 'ticket',
          eventType: 'support_ticket',
          label: formatRelativeTime(ticket.createdAt),
          title: `Ticket ${ticket.ticketId}`,
          pagePath: `${ticket.subject} • ${ticket.status}`,
          country: 'Support',
          state: ticket.priority,
          city: null,
          timezone: null,
          deviceType: null,
          createdAt: ticket.createdAt,
        })),
      ]
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
        .slice(0, 20);

      return res.status(200).json({
        success: true,
        godMode: {
          summary: {
            activeSessions: totalActiveSessions,
            activeUsers: activeUserCount,
            trackedUsers: totalTrackedUsers,
            activeCountries: mapCountries.length,
            activeStates: activeStates.length,
            recentEvents: totalRecentEvents,
            businessConnections: businessSummary[0]?.totalConnections || 0,
            connectedBusinesses: businessSummary[0]?.connectedUsers || 0,
            recentReviews: reviewSummary[0]?.totalReviews || 0,
            negativeReviews: reviewSummary[0]?.negativeReviews || 0,
            pendingApprovals: reviewSummary[0]?.awaitingApproval || 0,
            alertHotspots: alertHotspots.length,
          },
          mapCountries,
          stateDistribution,
          planBreakdown,
          liveSessions: activeSessions.map((session) => ({
            id: session._id,
            sessionId: session.sessionId,
            userId: session.userId,
            userName: session.userName || 'Anonymous visitor',
            userEmail: session.userEmail || null,
            businessName: session.businessName || null,
            plan: session.plan || 'free',
            subscriptionStatus: session.subscriptionStatus || 'free',
            pagePath: session.pagePath,
            country: session.country || 'Unknown',
            countryCode: session.countryCode || 'US',
            state: session.state || null,
            city: session.city || null,
            timezone: session.timezone || null,
            deviceType: session.deviceType || 'desktop',
            eventType: session.eventType || 'page_view',
            lastSeenAt: session.lastSeenAt,
            lastSeenLabel: formatRelativeTime(session.lastSeenAt),
          })),
          recentFeed: mergedFeed.map((item) => ({
            id: item.id,
            kind: item.kind,
            eventType: item.eventType,
            title: item.title,
            pagePath: item.pagePath,
            country: item.country,
            state: item.state,
            city: item.city,
            timezone: item.timezone,
            deviceType: item.deviceType,
            createdAt: item.createdAt,
            createdLabel: item.label,
          })),
          eventsByType,
          businessLayer: {
            summary: {
              totalConnections: businessSummary[0]?.totalConnections || 0,
              connectedUsers: businessSummary[0]?.connectedUsers || 0,
            },
            countries: businessCountries,
            platforms: businessPlatforms,
          },
          reviewLayer: {
            summary: {
              totalReviews: reviewSummary[0]?.totalReviews || 0,
              negativeReviews: reviewSummary[0]?.negativeReviews || 0,
              awaitingApproval: reviewSummary[0]?.awaitingApproval || 0,
            },
            countries: reviewCountries,
            platforms: reviewPlatforms,
          },
          alertLayer: {
            summary: {
              negativeReviews: alertSummary[0]?.negativeReviews || 0,
              criticalHotspots: alertSummary[0]?.criticalHotspots || 0,
            },
            hotspots: alertHotspots,
          },
          filters: {
            countries: activeCountries.filter(Boolean).sort(),
            states: activeStates.filter(Boolean).sort(),
            plans: Object.keys(getConfig().plans),
            subscriptionStatuses: ['free', 'active', 'trialing', 'past_due', 'canceled', 'unpaid', 'expired'],
          },
        },
      });
    } catch (error) {
      logger.error('Admin god mode analytics error', { error: error.message, stack: error.stack });
      return res.status(500).json({ success: false, error: 'Failed to fetch God Mode analytics' });
    }
  },

  getOpsAuditDashboard: async (_req, res) => {
    try {
      const now = new Date();
      const last24Hours = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const last7Days = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

      const [
        auditSummaryRows,
        suspiciousEvents,
        latestAccessLogs,
        aiSummaryRows,
        aiProviderRows,
        aiKeyRows,
        latestAiLogs,
      ] = await Promise.all([
        AuditLog.aggregate([
          { $match: { createdAt: { $gte: last7Days } } },
          {
            $group: {
              _id: null,
              totalEvents: { $sum: 1 },
              suspiciousEvents: {
                $sum: { $cond: ['$suspicious', 1, 0] },
              },
              failedLogins: {
                $sum: {
                  $cond: [
                    {
                      $and: [
                        { $eq: ['$eventType', 'login_failed'] },
                        { $eq: ['$status', 'failed'] },
                      ],
                    },
                    1,
                    0,
                  ],
                },
              },
              blockedEvents: {
                $sum: {
                  $cond: [{ $eq: ['$status', 'blocked'] }, 1, 0],
                },
              },
              successfulLogins: {
                $sum: {
                  $cond: [
                    {
                      $and: [
                        { $eq: ['$eventType', 'login_success'] },
                        { $eq: ['$status', 'success'] },
                      ],
                    },
                    1,
                    0,
                  ],
                },
              },
            },
          },
        ]),
        AuditLog.find({ suspicious: true })
          .sort({ createdAt: -1 })
          .limit(15)
          .select('email eventType status riskLevel reason loginMethod ipAddress createdAt metadata'),
        AuditLog.find({})
          .sort({ createdAt: -1 })
          .limit(30)
          .select('email eventType status riskLevel suspicious reason loginMethod ipAddress createdAt'),
        AiExecutionLog.aggregate([
          { $match: { createdAt: { $gte: last24Hours } } },
          {
            $group: {
              _id: null,
              totalRequests: { $sum: 1 },
              failedRequests: {
                $sum: { $cond: [{ $eq: ['$status', 'failed'] }, 1, 0] },
              },
              promptTokens: { $sum: '$promptTokens' },
              completionTokens: { $sum: '$completionTokens' },
              totalTokens: { $sum: '$totalTokens' },
            },
          },
        ]),
        AiExecutionLog.aggregate([
          { $match: { createdAt: { $gte: last24Hours } } },
          {
            $group: {
              _id: '$provider',
              requests: { $sum: 1 },
              failedRequests: {
                $sum: { $cond: [{ $eq: ['$status', 'failed'] }, 1, 0] },
              },
              promptTokens: { $sum: '$promptTokens' },
              completionTokens: { $sum: '$completionTokens' },
              totalTokens: { $sum: '$totalTokens' },
            },
          },
          { $project: { _id: 0, label: '$_id', requests: 1, failedRequests: 1, promptTokens: 1, completionTokens: 1, totalTokens: 1 } },
          { $sort: { requests: -1 } },
        ]),
        AiExecutionLog.aggregate([
          { $match: { createdAt: { $gte: last24Hours }, provider: 'google', keyIndex: { $ne: null } } },
          {
            $group: {
              _id: '$keyIndex',
              requests: { $sum: 1 },
              failedRequests: {
                $sum: { $cond: [{ $eq: ['$status', 'failed'] }, 1, 0] },
              },
              promptTokens: { $sum: '$promptTokens' },
              completionTokens: { $sum: '$completionTokens' },
              totalTokens: { $sum: '$totalTokens' },
              lastSeenAt: { $max: '$createdAt' },
              models: { $addToSet: '$model' },
            },
          },
          {
            $project: {
              _id: 0,
              keyIndex: '$_id',
              requests: 1,
              failedRequests: 1,
              promptTokens: 1,
              completionTokens: 1,
              totalTokens: 1,
              lastSeenAt: 1,
              models: 1,
            },
          },
          { $sort: { keyIndex: 1 } },
        ]),
        AiExecutionLog.find({})
          .sort({ createdAt: -1 })
          .limit(30)
          .select('taskType provider route model keyIndex status promptTokens completionTokens totalTokens durationMs error createdAt'),
      ]);

      const auditSummary = auditSummaryRows[0] || {
        totalEvents: 0,
        suspiciousEvents: 0,
        failedLogins: 0,
        blockedEvents: 0,
        successfulLogins: 0,
      };

      const aiSummary = aiSummaryRows[0] || {
        totalRequests: 0,
        failedRequests: 0,
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
      };

      return res.status(200).json({
        success: true,
        ops: {
          security: {
            summary: {
              ...auditSummary,
              window: '7d',
            },
            suspiciousLogins: suspiciousEvents.map((event) => ({
              id: event._id,
              email: event.email,
              eventType: event.eventType,
              status: event.status,
              riskLevel: event.riskLevel,
              loginMethod: event.loginMethod,
              ipAddress: event.ipAddress,
              reason: event.reason,
              createdAt: event.createdAt,
              createdLabel: formatRelativeTime(event.createdAt),
              metadata: event.metadata || {},
            })),
            accessLogs: latestAccessLogs.map((event) => ({
              id: event._id,
              email: event.email,
              eventType: event.eventType,
              status: event.status,
              riskLevel: event.riskLevel,
              suspicious: !!event.suspicious,
              loginMethod: event.loginMethod,
              ipAddress: event.ipAddress,
              reason: event.reason,
              createdAt: event.createdAt,
              createdLabel: formatRelativeTime(event.createdAt),
            })),
          },
          ai: {
            summary: {
              ...aiSummary,
              successRate: aiSummary.totalRequests
                ? Number((((aiSummary.totalRequests - aiSummary.failedRequests) / aiSummary.totalRequests) * 100).toFixed(1))
                : 0,
              window: '24h',
            },
            byProvider: aiProviderRows,
            byGoogleKey: aiKeyRows.map((row) => ({
              ...row,
              lastSeenLabel: row.lastSeenAt ? formatRelativeTime(row.lastSeenAt) : 'Never',
            })),
            logs: latestAiLogs.map((item) => ({
              id: item._id,
              taskType: item.taskType,
              provider: item.provider,
              route: item.route,
              model: item.model,
              keyIndex: item.keyIndex,
              status: item.status,
              promptTokens: item.promptTokens,
              completionTokens: item.completionTokens,
              totalTokens: item.totalTokens,
              durationMs: item.durationMs,
              error: item.error,
              createdAt: item.createdAt,
              createdLabel: formatRelativeTime(item.createdAt),
            })),
          },
        },
      });
    } catch (error) {
      logger.error('Admin ops audit dashboard error', { error: error.message, stack: error.stack });
      return res.status(500).json({ success: false, error: 'Failed to fetch operations dashboard' });
    }
  },

  updateUserPlan: async (req, res) => {
    try {
      const { id } = req.params;
      const { plan } = req.body;

      if (!Object.keys(getConfig().plans).includes(plan)) {
        return res.status(400).json({ success: false, error: 'Invalid plan selected' });
      }

      const user = await User.findById(id);
      if (!user) {
        return res.status(404).json({ success: false, error: 'User not found' });
      }

      if (user.role !== 'user') {
        return res.status(403).json({ success: false, error: 'Only platform users can be managed here' });
      }

      user.plan = plan;
      if (plan === 'free') {
        user.subscriptionStatus = 'canceled';
        user.subscriptionCurrentPeriodEnd = null;
        user.planExpiresAt = null;
        user.extraStorageMB = 0;
      } else {
        user.subscriptionStatus = 'active';
        user.subscriptionCurrentPeriodEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
        user.planExpiresAt = user.subscriptionCurrentPeriodEnd;
      }

      await user.save();

      return res.status(200).json({
        success: true,
        message: 'User plan updated successfully',
        user,
      });
    } catch (error) {
      logger.error('Update User Plan Error', { error: error.message });
      return res.status(500).json({ success: false, error: 'Failed to update user plan' });
    }
  },

  deleteUser: async (req, res) => {
    try {
      const { id } = req.params;
      const user = await User.findById(id);

      if (!user) {
        return res.status(404).json({ success: false, error: 'User not found' });
      }

      if (user.role !== 'user') {
        return res.status(403).json({ success: false, error: 'Only platform users can be deleted here' });
      }

      await User.findByIdAndDelete(id);

      return res.status(200).json({
        success: true,
        message: 'User deleted successfully'
      });
    } catch (error) {
      logger.error('Delete User Error', { error: error.message });
      return res.status(500).json({ success: false, error: 'Failed to delete user' });
    }
  }
};
