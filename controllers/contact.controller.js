/**
 * Contact Controller
 * Handles contact form submissions
 */

const logger = require('../utils/logger');

/**
 * Submit contact form
 */
const submitContact = async (req, res) => {
  try {
    const { name, email, company, message } = req.body;

    if (!name || !email || !message) {
      return res.status(400).json({
        success: false,
        error: 'Name, email, and message are required'
      });
    }

    // Validate email
    const emailRegex = /^\S+@\S+\.\S+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({
        success: false,
        error: 'Please provide a valid email address'
      });
    }

    // In a real app, you'd save to database and/or send email
    logger.info('Contact form submitted', { name, email, company });

    return res.status(200).json({
      success: true,
      message: 'Thank you for your message! We\'ll get back to you soon.'
    });

  } catch (error) {
    logger.error('Contact Form Error', { error: error.message });
    return res.status(500).json({
      success: false,
      error: 'Failed to submit contact form'
    });
  }
};

module.exports = {
  submitContact
};
