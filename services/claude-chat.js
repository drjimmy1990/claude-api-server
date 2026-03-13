const browserService = require('./browser');

/**
 * Send a message to Claude on claude.ai and get the response.
 * This is the core automation logic.
 */
async function sendMessage(message, options = {}) {
  const page = browserService.getPage();
  if (!page) throw new Error('Browser not initialized');

  const loggedIn = await browserService.isLoggedIn();
  if (!loggedIn) throw new Error('Not logged into claude.ai. Please log in manually.');

  // If requested, start a new conversation first
  if (options.newConversation) {
    await startNewConversation(page);
  }
  // Dismiss any popups or banners
  await dismissPopups(page);

  // Find and click the chat input
  const inputSelector = 'div.ProseMirror[contenteditable="true"], div[contenteditable="true"].is-editor-empty, div[contenteditable="true"]';
  
  try {
    await page.waitForSelector(inputSelector, { timeout: 10000 });
  } catch {
    // Try to take a screenshot for debugging
    await browserService.screenshot('input-not-found');
    throw new Error('Could not find chat input. Claude.ai UI may have changed.');
  }

  const input = page.locator(inputSelector).first();

  // Clear any existing text and type the message
  await input.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Backspace');
  
  // Type the message (use fill for ProseMirror or type character by character)
  await input.fill(message);
  
  // Small delay to let the UI register the input
  await page.waitForTimeout(500);

  // Find and click the send button
  const sendClicked = await clickSendButton(page);
  if (!sendClicked) {
    // Fallback: try pressing Enter
    await page.keyboard.press('Enter');
  }

  // Wait for Claude to start responding
  await page.waitForTimeout(2000);

  // Wait for Claude to finish responding
  await waitForResponse(page);

  // Scrape the response
  const reply = await scrapeLatestResponse(page);
  const artifacts = await scrapeArtifacts(page);
  const conversationUrl = page.url();

  return {
    reply,
    artifacts,
    conversationUrl,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Click the send button - tries multiple selectors
 */
async function clickSendButton(page) {
  const sendSelectors = [
    'button[aria-label="Send Message"]',
    'button[aria-label="Send message"]',
    'button[data-testid="send-button"]',
    'button[type="submit"]',
    // SVG arrow icon button - the send button typically
    'fieldset button:last-of-type',
    'button:has(svg[viewBox])',
  ];

  for (const selector of sendSelectors) {
    try {
      const btn = page.locator(selector).first();
      if (await btn.isVisible({ timeout: 1000 })) {
        await btn.click();
        console.log(`✉️ Send button clicked via: ${selector}`);
        return true;
      }
    } catch {
      // Try next selector
    }
  }

  console.warn('⚠️ Could not find send button, will try Enter key');
  return false;
}

/**
 * Wait for Claude to finish generating its response.
 * Handles: extended thinking → streaming response → done.
 * 
 * The approach:
 * 1. Wait for Claude to start responding (stop button or content change)
 * 2. Keep checking the page content length until it stabilizes
 * 3. Content is "stable" when it hasn't changed for N consecutive checks
 */
async function waitForResponse(page, maxWaitMs = 300000) {
  const startTime = Date.now();
  console.log('⏳ Waiting for Claude to respond...');

  const stopSelectors = [
    'button[aria-label="Stop Response"]',
    'button[aria-label="Stop response"]',
    'button[aria-label="Stop"]',
    'button[data-testid="stop-button"]',
  ];

  // Phase 1: Wait for Claude to START responding (max 30s)
  let started = false;
  for (let i = 0; i < 30 && !started; i++) {
    // Check if stop button appeared
    for (const sel of stopSelectors) {
      try {
        if (await page.locator(sel).isVisible({ timeout: 300 })) {
          started = true;
          console.log('🔄 Claude is generating...');
          break;
        }
      } catch { /* continue */ }
    }
    if (!started) {
      await page.waitForTimeout(1000);
    }
  }

  if (!started) {
    console.warn('⚠️ Could not detect Claude starting to respond');
  }

  // Phase 2: Wait for FULL completion — content must stop changing
  // This handles both thinking and streaming phases
  let previousLength = 0;
  let stableCount = 0;
  const requiredStable = 3;    // Need 3 consecutive stable checks
  const checkInterval = 3000;  // Check every 3 seconds
  let stopButtonGone = false;

  while (Date.now() - startTime < maxWaitMs) {
    await page.waitForTimeout(checkInterval);

    // Get current page content length (all non-user text)
    const currentState = await page.evaluate(() => {
      let totalLength = 0;
      
      // Get all text from non-user message areas
      document.querySelectorAll('[class*="standard-markdown"]').forEach(el => {
        if (!el.closest('[data-testid="user-message"]')) {
          totalLength += (el.innerText || '').length;
        }
      });

      // Also check for artifact/code panels
      document.querySelectorAll('pre, code, [class*="artifact"]').forEach(el => {
        if (!el.closest('[data-testid="user-message"]')) {
          totalLength += (el.innerText || '').length;
        }
      });

      return totalLength;
    });

    // Check if stop button is still visible
    let stopVisible = false;
    for (const sel of stopSelectors) {
      try {
        if (await page.locator(sel).isVisible({ timeout: 300 })) {
          stopVisible = true;
          break;
        }
      } catch { /* continue */ }
    }

    if (stopVisible) {
      // Claude is still actively generating — reset stability counter
      stableCount = 0;
      stopButtonGone = false;
      const elapsed = Math.round((Date.now() - startTime) / 1000);
      console.log(`🔄 Still generating... (${elapsed}s, ${currentState} chars)`);
    } else {
      // Stop button gone — check if content has stabilized
      if (!stopButtonGone) {
        stopButtonGone = true;
        console.log('⏳ Stop button gone, waiting for content to stabilize...');
      }

      if (currentState === previousLength && currentState > 0) {
        stableCount++;
        if (stableCount >= requiredStable) {
          console.log(`✅ Claude finished responding. (${currentState} chars)`);
          return;
        }
      } else {
        // Content is still changing (streamed text growing)
        stableCount = 0;
      }
    }

    previousLength = currentState;
  }

  console.warn('⚠️ Timeout waiting for response (max wait exceeded)');
}

/**
 * Scrape Claude's latest response text from the DOM.
 * The approach: find all message content containers (standard-markdown grid),
 * exclude user messages and thinking/summary blocks,
 * and return the last remaining one (Claude's actual response).
 */
async function scrapeLatestResponse(page) {
  // Wait for DOM to settle
  await page.waitForTimeout(2000);

  const reply = await page.evaluate(() => {
    /**
     * Helper: check if an element is inside a "thinking" block
     * Claude.ai shows thinking in a collapsible section with specific markers
     */
    function isThinkingBlock(el) {
      // Check self and parents for thinking indicators
      let node = el;
      for (let i = 0; i < 10 && node; i++) {
        const cls = (node.className || '').toString().toLowerCase();
        const ariaLabel = (node.getAttribute('aria-label') || '').toLowerCase();
        const testId = node.getAttribute('data-testid') || '';

        if (cls.includes('thinking') || cls.includes('thought') ||
            ariaLabel.includes('thinking') || ariaLabel.includes('thought') ||
            testId.includes('thinking') || testId.includes('thought')) {
          return true;
        }

        // Check for the collapsible details/summary pattern used by thinking
        if (node.tagName === 'DETAILS' || node.tagName === 'SUMMARY') {
          return true;
        }

        // Check for the "Thinking" text in a button/header
        if ((node.tagName === 'BUTTON' || node.tagName === 'DIV') &&
            node.childElementCount <= 2) {
          const directText = Array.from(node.childNodes)
            .filter(n => n.nodeType === Node.TEXT_NODE)
            .map(n => n.textContent.trim())
            .join('');
          if (directText.toLowerCase().includes('thinking')) return true;
        }

        node = node.parentElement;
      }
      return false;
    }

    // Strategy 1: Find all standard-markdown content blocks
    let candidates = document.querySelectorAll('[class*="standard-markdown"]');

    if (candidates.length > 0) {
      // Filter: not user message, not thinking block
      const claudeMessages = Array.from(candidates).filter(el => {
        if (el.closest('[data-testid="user-message"]')) return false;
        if (isThinkingBlock(el)) return false;
        const text = (el.innerText || '').trim();
        // Skip thinking summaries (various patterns)
        if (text.length < 5) return false;
        const textLower = text.toLowerCase();
        if (textLower === 'thinking' || textLower === 'thinking...' ||
            textLower.startsWith('thinking about') ||
            textLower.startsWith('thinking...') ||
            textLower.match(/^thinking\s/)) return false;
        return true;
      });

      if (claudeMessages.length > 0) {
        // Collect text from ALL matching blocks (response may span multiple)
        const allText = claudeMessages.map(el => (el.innerText || '').trim()).join('\n\n');
        return allText;
      }
    }

    // Strategy 2: Find all grid-cols-1 content grid blocks
    candidates = document.querySelectorAll('[class*="grid-cols-1"][class*="grid"]');
    if (candidates.length > 0) {
      const claudeMessages = Array.from(candidates).filter(el => {
        if (el.closest('[data-testid="user-message"]')) return false;
        if (el.className.includes('font-user')) return false;
        if (isThinkingBlock(el)) return false;
        const text = (el.innerText || '').trim();
        return text.length > 5;
      });

      if (claudeMessages.length > 0) {
        const allText = claudeMessages.map(el => (el.innerText || '').trim()).join('\n\n');
        return allText;
      }
    }

    // Strategy 3: Ultimate fallback — all p/pre tags not in user or thinking blocks
    const allContent = document.querySelectorAll('p, pre');
    const validContent = Array.from(allContent).filter(el => {
      if (el.closest('[data-testid="user-message"]')) return false;
      if (isThinkingBlock(el)) return false;
      return (el.innerText || '').trim().length > 0;
    });

    if (validContent.length > 0) {
      const allText = validContent.map(el => (el.innerText || '').trim()).join('\n');
      return allText;
    }

    return '';
  });

  return reply.trim();
}

/**
 * Scrape any artifacts (code blocks, etc.) from Claude's latest response
 */
async function scrapeArtifacts(page) {
  const artifacts = await page.evaluate(() => {
    const results = [];

    // Look for artifact panels (Claude.ai shows artifacts in a side panel)
    const artifactSelectors = [
      '[data-testid="artifact"]',
      '[class*="artifact"]',
      '[class*="code-block"]',
    ];

    // Also scrape code blocks from the response
    const codeBlocks = document.querySelectorAll('pre code, pre');
    codeBlocks.forEach((block, index) => {
      const code = block.textContent || '';
      if (code.trim().length === 0) return;

      // Try to detect language from class
      let language = 'text';
      const classes = block.className || '';
      const langMatch = classes.match(/language-(\w+)/);
      if (langMatch) {
        language = langMatch[1];
      }

      // Try to get title from a sibling or parent label
      let title = `code-block-${index + 1}`;
      const header = block.closest('div')?.querySelector('[class*="header"], [class*="title"], [class*="filename"]');
      if (header) {
        title = header.textContent.trim() || title;
      }

      results.push({
        type: 'code',
        language,
        title,
        content: code.trim(),
      });
    });

    // Look for artifact buttons/panels
    for (const sel of artifactSelectors) {
      const els = document.querySelectorAll(sel);
      els.forEach((el) => {
        const title = el.querySelector('[class*="title"], [class*="name"]')?.textContent?.trim() || 'Artifact';
        const content = el.querySelector('pre, code, [class*="content"]')?.textContent?.trim() || el.textContent?.trim();

        if (content && !results.find(r => r.content === content)) {
          results.push({
            type: 'artifact',
            language: 'text',
            title,
            content,
          });
        }
      });
    }

    return results;
  });

  return artifacts;
}

/**
 * Start a new conversation on claude.ai
 */
async function startNewConversation(page) {
  console.log('🆕 Starting new conversation...');

  // Navigate directly to /new — most reliable method
  await page.goto('https://claude.ai/new', { waitUntil: 'domcontentloaded', timeout: 15000 });
  await page.waitForTimeout(2000);

  // Dismiss any popups, banners, or "What's new" modals
  await dismissPopups(page);

  // Wait for the chat input to be ready
  const inputSelector = 'div.ProseMirror[contenteditable="true"], div[contenteditable="true"]';
  try {
    await page.waitForSelector(inputSelector, { timeout: 10000 });
    console.log('✅ New conversation started.');
  } catch {
    console.warn('⚠️ Chat input not found after new conversation');
  }
}

/**
 * Dismiss any popups, banners, or modals that may appear
 */
async function dismissPopups(page) {
  const dismissSelectors = [
    // Close buttons on modals/popups
    'button[aria-label="Close"]',
    'button[aria-label="Dismiss"]',
    'button[aria-label="Close dialog"]',
    '[data-testid="close-button"]',
    // "Got it" / "OK" / "Continue" buttons on announcement banners
    'button:has-text("Got it")',
    'button:has-text("OK")',
    'button:has-text("Continue")',
    'button:has-text("Skip")',
    'button:has-text("Dismiss")',
    // Generic close/X buttons inside dialogs
    'dialog button',
    '[role="dialog"] button:first-child',
  ];

  for (const selector of dismissSelectors) {
    try {
      const btn = page.locator(selector).first();
      if (await btn.isVisible({ timeout: 500 })) {
        await btn.click();
        await page.waitForTimeout(500);
        console.log(`🗙 Dismissed popup via: ${selector}`);
      }
    } catch {
      // Ignore — popup may not exist
    }
  }
}

module.exports = {
  sendMessage,
  startNewConversation,
  scrapeLatestResponse,
  scrapeArtifacts,
};
