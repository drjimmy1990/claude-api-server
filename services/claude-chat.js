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
 * Scrape any artifacts (code blocks, etc.) from Claude's latest response.
 * Artifacts in Claude.ai appear as clickable cards in the chat.
 * Clicking them opens a side panel with the full content.
 * We click each one, read the content, then close the panel.
 */
async function scrapeArtifacts(page) {
  const results = [];

  // First: check if an artifact panel is already open
  const panelContent = await readArtifactPanel(page);
  if (panelContent) {
    results.push(panelContent);
    // Close the panel
    await closeArtifactPanel(page);
  }

  // Find artifact cards/buttons in the chat (clickable cards with download/copy)
  const artifactCards = await page.$$('button[class*="artifact"], [data-testid*="artifact"], div[class*="artifact-card"]');

  // Also try to find artifact-like elements by structure (the card with title + "Code · JSON" etc)
  if (artifactCards.length === 0) {
    // Try broader search for artifact download buttons
    const downloadBtns = await page.$$('button:has-text("Download")');
    for (const btn of downloadBtns) {
      // Check if this is inside an artifact card
      const parent = await btn.evaluateHandle(el => {
        let node = el.parentElement;
        for (let i = 0; i < 5 && node; i++) {
          if (node.querySelector('button') && node.textContent.includes('Download')) {
            return node;
          }
          node = node.parentElement;
        }
        return null;
      });

      if (parent) {
        try {
          await parent.asElement()?.click();
          await page.waitForTimeout(1500);
          const content = await readArtifactPanel(page);
          if (content) results.push(content);
          await closeArtifactPanel(page);
        } catch { /* continue */ }
      }
    }
  }

  // Click each artifact card to open it and read content
  for (const card of artifactCards) {
    try {
      await card.click();
      await page.waitForTimeout(1500);
      const content = await readArtifactPanel(page);
      if (content && !results.find(r => r.content === content.content)) {
        results.push(content);
      }
      await closeArtifactPanel(page);
    } catch { /* continue */ }
  }

  // Fallback: scrape inline code blocks from the chat response
  if (results.length === 0) {
    const inlineCode = await page.evaluate(() => {
      const blocks = [];
      document.querySelectorAll('pre code, pre').forEach((block, i) => {
        const code = block.textContent || '';
        if (code.trim().length === 0) return;
        let lang = 'text';
        const langMatch = (block.className || '').match(/language-(\w+)/);
        if (langMatch) lang = langMatch[1];
        blocks.push({ type: 'code', language: lang, title: `code-block-${i + 1}`, content: code.trim() });
      });
      return blocks;
    });
    results.push(...inlineCode);
  }

  return results;
}

/**
 * Read content from an open artifact side panel.
 * Claude.ai renders each line of artifact content as a separate
 * <code class="font-mono text-xs break-all"> element inside the right panel.
 */
async function readArtifactPanel(page) {
  try {
    const content = await page.evaluate(() => {
      // Strategy 1: Find all code.font-mono elements (line-by-line content)
      // These are the individual lines in the artifact code viewer
      const codeLines = document.querySelectorAll('code.font-mono');
      if (codeLines.length > 0) {
        // Filter to only lines on the right side (artifact panel, not chat)
        const rightLines = Array.from(codeLines).filter(el => {
          const rect = el.getBoundingClientRect();
          return rect.left > window.innerWidth * 0.35;
        });
        if (rightLines.length > 3) {
          const text = rightLines.map(el => el.textContent || '').join('\n').trim();
          if (text.length > 10) return { content: text, source: 'font-mono-lines', lineCount: rightLines.length };
        }
        // If not enough right-side lines, try all
        if (codeLines.length > 3) {
          const text = Array.from(codeLines).map(el => el.textContent || '').join('\n').trim();
          if (text.length > 10) return { content: text, source: 'all-font-mono', lineCount: codeLines.length };
        }
      }

      // Strategy 2: CodeMirror content
      const cmContent = document.querySelector('.cm-content');
      if (cmContent) {
        const text = cmContent.textContent?.trim();
        if (text && text.length > 10) return { content: text, source: 'cm-content' };
      }

      // Strategy 3: The right panel div with the full content
      const rightPanel = document.querySelector('[class*="max-md:absolute"][class*="top-0"][class*="right-0"]');
      if (rightPanel) {
        // Get all pre/code inside it
        const preEl = rightPanel.querySelector('pre');
        if (preEl) {
          const text = preEl.textContent?.trim();
          if (text && text.length > 10) return { content: text, source: 'right-panel-pre' };
        }
        // Or get all text from code elements inside
        const codes = rightPanel.querySelectorAll('code');
        if (codes.length > 3) {
          const text = Array.from(codes).map(c => c.textContent || '').join('\n').trim();
          if (text.length > 10) return { content: text, source: 'right-panel-codes' };
        }
      }

      return null;
    });

    if (!content) return null;

    // Get title and language from the artifact panel header
    const meta = await page.evaluate(() => {
      let title = 'Artifact';
      let language = 'text';

      // The artifact card in chat has the title
      const artifactCard = document.querySelector('.artifact-block-cell');
      if (artifactCard) {
        // Get text before "Code · JSON" or "Download"
        const cardText = (artifactCard.textContent || '').trim();
        const cleanTitle = cardText
          .replace(/Code\s*·\s*\w+/i, '')
          .replace(/Download/i, '')
          .replace(/Copy/i, '')
          .trim();
        if (cleanTitle) title = cleanTitle;

        // Detect language from card text
        const lower = cardText.toLowerCase();
        if (lower.includes('· json')) language = 'json';
        else if (lower.includes('· python')) language = 'python';
        else if (lower.includes('· javascript')) language = 'javascript';
        else if (lower.includes('· html')) language = 'html';
        else if (lower.includes('· css')) language = 'css';
        else if (lower.includes('· typescript')) language = 'typescript';
      }

      // Also check the panel header on the right
      // It shows "Title · JSON" with Copy button
      const allText = document.querySelectorAll('div');
      for (const div of allText) {
        const rect = div.getBoundingClientRect();
        // Panel header is at the top-right area
        if (rect.left > window.innerWidth * 0.4 && rect.top < 60 && rect.height < 40) {
          const text = (div.textContent || '').trim();
          if (text.includes('·') && text.length < 100) {
            const parts = text.split('·');
            const t = parts[0].replace(/Copy/gi, '').trim();
            if (t && t.length > 2) title = t;

            const langPart = (parts[1] || '').toLowerCase().trim();
            if (langPart.includes('json')) language = 'json';
            else if (langPart.includes('python')) language = 'python';
            else if (langPart.includes('javascript')) language = 'javascript';
            break;
          }
        }
      }

      return { title, language };
    });

    console.log(`📋 Artifact read: "${meta.title}" (${meta.language}, ${content.content.length} chars via ${content.source})`);

    return {
      type: 'artifact',
      language: meta.language,
      title: meta.title,
      content: content.content,
    };
  } catch (err) {
    console.error('❌ Error reading artifact panel:', err.message);
    return null;
  }
}

/**
 * Close an open artifact side panel
 */
async function closeArtifactPanel(page) {
  try {
    // Try clicking the X/close button on the artifact panel
    const closeSelectors = [
      '[data-testid="close-artifact"]',
      'button[aria-label="Close"]',
      'button[aria-label="Close artifact"]',
    ];
    for (const sel of closeSelectors) {
      try {
        const btn = page.locator(sel).first();
        if (await btn.isVisible({ timeout: 500 })) {
          await btn.click();
          await page.waitForTimeout(500);
          return;
        }
      } catch { /* continue */ }
    }
    // Fallback: press Escape
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
  } catch { /* ignore */ }
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
