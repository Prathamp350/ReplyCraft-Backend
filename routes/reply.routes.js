const express = require("express");
const router = express.Router();
const replyController = require("../controllers/reply.controller");
const { authenticate } = require("../middleware/auth.middleware");
const { customRateLimiter } = require("../middleware/rateLimit.middleware");

// Apply auth middleware to all routes
router.use(authenticate);

// POST /api/reply/generate - Generate professional reply
router.post(
  "/generate-reply",
  customRateLimiter,
  replyController.generateReply,
);

module.exports = router;
