const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const BROWSER_DATA_DIR = path.join(__dirname, '..', 'browser-data');
const STORAGE_STATE_PATH = path.join(BROWSER_DATA_DIR, 'storage-state.json');

let browser = null;
let context = null;
let page = null;

/**
 * Initialize the browser with persistent context
 */
async function init() {
  const wantHeadless = process.env.HEADLESS === 'true';
  
  // If Xvfb is running (DISPLAY env var set), use full browser even in "headless" mode
  // This bypasses Cloudflare bot detection (headless-shell is easily detected)
  const hasDisplay = !!process.env.DISPLAY;
  const headless = wantHeadless && !hasDisplay;

  if (wantHeadless && hasDisplay) {
    console.log('🖥️  Xvfb detected — using full browser with virtual display');
  }

  // Ensure browser-data directory exists
  if (!fs.existsSync(BROWSER_DATA_DIR)) {
    fs.mkdirSync(BROWSER_DATA_DIR, { recursive: true });
  }

  console.log(`🌐 Launching browser (headless: ${headless})...`);

  // Use persistent context to save login session
  context = await chromium.launchPersistentContext(BROWSER_DATA_DIR, {
    headless,
    viewport: { width: 1280, height: 800 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-sandbox',
      '--disable-dev-shm-usage',
    ],
  });

  // Get existing page or create new one
  const pages = context.pages();
  page = pages.length > 0 ? pages[0] : await context.newPage();

  // Navigate to claude.ai
  console.log('📍 Navigating to claude.ai...');
  await page.goto('https://claude.ai', { waitUntil: 'domcontentloaded', timeout: 30000 });

  // Wait a bit for the page to settle
  await page.waitForTimeout(3000);

  console.log('✅ Browser ready. Current URL:', page.url());

  return { context, page };
}

/**
 * Get the active page
 */
function getPage() {
  return page;
}

/**
 * Get the browser context
 */
function getContext() {
  return context;
}

/**
 * Check if we're logged into claude.ai
 */
async function isLoggedIn() {
  try {
    if (!page) return false;

    const url = page.url();

    // If we're on the login page, we're not logged in
    if (url.includes('/login') || url.includes('/signin')) {
      return false;
    }

    // Check for the chat input (the main textarea/contenteditable) — sign of being logged in
    try {
      await page.waitForSelector('[contenteditable="true"], textarea[placeholder], div.ProseMirror', {
        timeout: 5000,
      });
      return true;
    } catch {
      return false;
    }
  } catch (err) {
    console.error('Error checking login status:', err.message);
    return false;
  }
}

/**
 * Take a screenshot for debugging
 */
async function screenshot(filename = 'debug') {
  const screenshotsDir = path.join(__dirname, '..', 'screenshots');
  if (!fs.existsSync(screenshotsDir)) {
    fs.mkdirSync(screenshotsDir, { recursive: true });
  }

  const filepath = path.join(screenshotsDir, `${filename}-${Date.now()}.png`);
  await page.screenshot({ path: filepath, fullPage: false });
  console.log(`📸 Screenshot saved: ${filepath}`);
  return filepath;
}

/**
 * Close the browser
 */
async function close() {
  if (context) {
    await context.close();
    context = null;
    page = null;
    console.log('🔒 Browser closed.');
  }
}

module.exports = {
  init,
  getPage,
  getContext,
  isLoggedIn,
  screenshot,
  close,
};
