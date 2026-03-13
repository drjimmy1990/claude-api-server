const express = require('express');
const router = express.Router();
const browserService = require('../services/browser');
const path = require('path');
const fs = require('fs');

/**
 * POST /api/auth/logout
 * Log out of claude.ai
 */
router.post('/logout', async (req, res) => {
  try {
    const page = browserService.getPage();
    await page.goto('https://claude.ai/logout', { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForTimeout(3000);
    res.json({ success: true, message: 'Logged out of claude.ai', currentUrl: page.url() });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/auth/status
 * Check if the browser is logged into claude.ai
 */
router.get('/status', async (req, res) => {
  try {
    const loggedIn = await browserService.isLoggedIn();
    const page = browserService.getPage();

    res.json({
      success: true,
      loggedIn,
      currentUrl: page ? page.url() : null,
      message: loggedIn
        ? 'Logged in to claude.ai ✅'
        : 'Not logged in. Please open the browser and log in manually.',
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err.message,
    });
  }
});

/**
 * GET /api/screenshot
 * Take a screenshot of the current browser state (for debugging)
 */
router.get('/screenshot', async (req, res) => {
  try {
    const filepath = await browserService.screenshot(req.query.name || 'manual');
    const imageBuffer = fs.readFileSync(filepath);
    res.set('Content-Type', 'image/png');
    res.send(imageBuffer);
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err.message,
    });
  }
});

/**
 * GET /api/auth/dom-debug
 * Deep DOM inspection - finds text and traces parent hierarchy
 */
router.get('/dom-debug', async (req, res) => {
  try {
    const page = browserService.getPage();
    const searchText = req.query.search || '';

    const result = await page.evaluate((searchText) => {
      const findings = [];

      if (searchText) {
        // Find ALL leaf-ish elements containing the search text
        document.querySelectorAll('p, span, div, h1, h2, h3, h4, pre, code, li').forEach(el => {
          const innerText = (el.innerText || '').trim();
          if (innerText.includes(searchText) && innerText.length < 300) {
            // Trace parent chain up to 8 levels
            const chain = [];
            let node = el;
            for (let i = 0; i < 8 && node && node !== document.body; i++) {
              chain.push({
                tag: node.tagName,
                cls: (node.className || '').toString().substring(0, 150),
                testId: node.getAttribute('data-testid'),
              });
              node = node.parentElement;
            }

            findings.push({
              text: innerText.substring(0, 200),
              chain,
            });
          }
        });
      }

      return { url: window.location.href, findings, totalFound: findings.length };
    }, searchText);

    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
