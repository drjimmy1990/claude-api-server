const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const claudeChat = require('../services/claude-chat');
const queue = require('../services/queue');
const browserService = require('../services/browser');

/**
 * In-memory job store for async requests
 * Jobs are kept for 30 minutes after completion, then auto-cleaned
 */
const jobs = new Map();
const JOB_TTL = 30 * 60 * 1000; // 30 minutes

function cleanupOldJobs() {
  const now = Date.now();
  for (const [id, job] of jobs) {
    if (job.completedAt && (now - job.completedAt) > JOB_TTL) {
      jobs.delete(id);
    }
  }
}
// Cleanup every 5 minutes
setInterval(cleanupOldJobs, 5 * 60 * 1000);

/**
 * POST /api/chat
 * Send a message to Claude via the browser and get the response.
 *
 * Body: { message, newConversation?, async? }
 *
 * - Default (async=false): waits for Claude to finish, returns full response
 * - async=true: returns immediately with { jobId }, process in background.
 *   Poll GET /api/chat/result/:jobId for the result.
 */
router.post('/', async (req, res) => {
  try {
    const { message, newConversation, async: isAsync } = req.body;

    if (!message || typeof message !== 'string' || message.trim().length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Message is required and must be a non-empty string.',
      });
    }

    console.log(`📨 Received message (${message.length} chars): "${message.substring(0, 80)}..."`);
    console.log(`📊 Queue size: ${queue.size}, busy: ${queue.busy}`);

    // === ASYNC MODE ===
    if (isAsync) {
      const jobId = crypto.randomUUID();
      jobs.set(jobId, {
        status: 'pending',
        createdAt: Date.now(),
        completedAt: null,
        result: null,
        error: null,
      });

      console.log(`🔄 Async job created: ${jobId}`);
      res.json({ success: true, jobId, status: 'pending' });

      // Process in background (no await — fire and forget)
      queue.add(async () => {
        return await claudeChat.sendMessage(message.trim(), {
          newConversation: newConversation || false,
        });
      }).then((result) => {
        const job = jobs.get(jobId);
        if (job) {
          job.status = 'completed';
          job.completedAt = Date.now();
          job.result = {
            success: true,
            reply: result.reply,
            artifacts: result.artifacts,
            conversationUrl: result.conversationUrl,
            timestamp: result.timestamp,
          };
          console.log(`✅ Async job completed: ${jobId}`);
        }
      }).catch((err) => {
        const job = jobs.get(jobId);
        if (job) {
          job.status = 'failed';
          job.completedAt = Date.now();
          job.error = err.message;
          console.error(`❌ Async job failed: ${jobId} — ${err.message}`);
        }
      });

      return; // Response already sent
    }

    // === SYNC MODE (default) ===
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
 * GET /api/chat/result/:jobId
 * Poll for async job result.
 *
 * Returns:
 *   - { status: "pending" }     — still processing
 *   - { status: "completed", ... }  — done, includes full response
 *   - { status: "failed", error }   — failed
 *   - 404 if jobId not found
 */
router.get('/result/:jobId', (req, res) => {
  const { jobId } = req.params;
  const job = jobs.get(jobId);

  if (!job) {
    return res.status(404).json({
      success: false,
      error: 'Job not found. It may have expired (jobs are kept for 30 minutes).',
    });
  }

  if (job.status === 'pending') {
    const elapsed = Math.round((Date.now() - job.createdAt) / 1000);
    return res.json({ success: true, status: 'pending', elapsed });
  }

  if (job.status === 'failed') {
    return res.json({ success: false, status: 'failed', error: job.error });
  }

  // completed
  return res.json(job.result);
});

/**
 * GET /api/chat/jobs
 * List all active jobs (for debugging)
 */
router.get('/jobs', (req, res) => {
  const jobList = [];
  for (const [id, job] of jobs) {
    jobList.push({
      jobId: id,
      status: job.status,
      createdAt: new Date(job.createdAt).toISOString(),
      elapsed: Math.round((Date.now() - job.createdAt) / 1000) + 's',
    });
  }
  res.json({ jobs: jobList });
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
