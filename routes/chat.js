const express = require('express');
const router = express.Router();
const claudeChat = require('../services/claude-chat');
const queue = require('../services/queue');
const browserService = require('../services/browser');

/**
 * POST /api/chat
 * Send a message to Claude via the browser and get the response
 */
router.post('/', async (req, res) => {
  try {
    const { message, newConversation } = req.body;

    if (!message || typeof message !== 'string' || message.trim().length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Message is required and must be a non-empty string.',
      });
    }

    console.log(`📨 Received message (${message.length} chars): "${message.substring(0, 80)}..."`);
    console.log(`📊 Queue size: ${queue.size}, busy: ${queue.busy}`);

    // Queue the message to ensure only one is processed at a time
    const result = await queue.add(async () => {
      return await claudeChat.sendMessage(message.trim(), {
        newConversation: newConversation || false,
      });
    });

    res.json({
      success: true,
      reply: result.reply,
      artifacts: result.artifacts,
      conversationUrl: result.conversationUrl,
      timestamp: result.timestamp,
    });
  } catch (err) {
    console.error('❌ Chat error:', err.message);

    // Take a debug screenshot on error
    try {
      await browserService.screenshot('error');
    } catch { /* ignore */ }

    res.status(500).json({
      success: false,
      error: err.message,
    });
  }
});

/**
 * POST /api/chat/new
 * Start a new conversation and optionally send the first message
 */
router.post('/new', async (req, res) => {
  try {
    const { message } = req.body;

    const result = await queue.add(async () => {
      if (message && message.trim().length > 0) {
        return await claudeChat.sendMessage(message.trim(), {
          newConversation: true,
        });
      } else {
        const page = browserService.getPage();
        await claudeChat.startNewConversation(page);
        return {
          reply: null,
          artifacts: [],
          conversationUrl: page.url(),
          timestamp: new Date().toISOString(),
        };
      }
    });

    res.json({
      success: true,
      ...result,
    });
  } catch (err) {
    console.error('❌ New chat error:', err.message);
    res.status(500).json({
      success: false,
      error: err.message,
    });
  }
});

module.exports = router;
