const express = require('express');
const router = express.Router();
const browserService = require('../services/browser');

/**
 * GET /api/remote
 * Serve the remote login web UI
 */
router.get('/', (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Claude API — Remote Login</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: #0f0f0f;
      color: #e0e0e0;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 16px;
    }
    h1 {
      font-size: 18px;
      font-weight: 600;
      margin-bottom: 8px;
      color: #d4a574;
    }
    .status {
      font-size: 13px;
      margin-bottom: 12px;
      padding: 6px 14px;
      border-radius: 20px;
      font-weight: 500;
    }
    .status.online { background: #1a3a1a; color: #4ade80; border: 1px solid #2d5a2d; }
    .status.offline { background: #3a1a1a; color: #f87171; border: 1px solid #5a2d2d; }
    .status.checking { background: #1a1a3a; color: #818cf8; border: 1px solid #2d2d5a; }

    .screen-wrap {
      position: relative;
      border: 2px solid #333;
      border-radius: 8px;
      overflow: hidden;
      cursor: crosshair;
      max-width: 100%;
      background: #1a1a1a;
    }
    .screen-wrap img {
      display: block;
      max-width: 100%;
      height: auto;
    }
    .click-marker {
      position: absolute;
      width: 20px;
      height: 20px;
      border: 2px solid #d4a574;
      border-radius: 50%;
      transform: translate(-50%, -50%);
      pointer-events: none;
      animation: ping 0.6s ease-out forwards;
    }
    @keyframes ping {
      0% { opacity: 1; transform: translate(-50%, -50%) scale(0.5); }
      100% { opacity: 0; transform: translate(-50%, -50%) scale(2); }
    }

    .controls {
      display: flex;
      gap: 8px;
      margin-top: 12px;
      width: 100%;
      max-width: 900px;
      flex-wrap: wrap;
    }
    input[type="text"] {
      flex: 1;
      min-width: 200px;
      padding: 10px 14px;
      background: #1a1a1a;
      border: 1px solid #333;
      border-radius: 6px;
      color: #e0e0e0;
      font-size: 14px;
      outline: none;
    }
    input[type="text"]:focus { border-color: #d4a574; }
    button {
      padding: 10px 18px;
      border: 1px solid #333;
      border-radius: 6px;
      background: #1a1a1a;
      color: #e0e0e0;
      font-size: 13px;
      cursor: pointer;
      font-weight: 500;
      transition: all 0.15s;
      white-space: nowrap;
    }
    button:hover { background: #2a2a2a; border-color: #d4a574; }
    button.primary { background: #d4a574; color: #0f0f0f; border-color: #d4a574; font-weight: 600; }
    button.primary:hover { background: #e0b88a; }

    .log {
      margin-top: 12px;
      width: 100%;
      max-width: 900px;
      font-size: 12px;
      color: #888;
      max-height: 80px;
      overflow-y: auto;
      font-family: 'Consolas', monospace;
      padding: 8px;
      background: #1a1a1a;
      border-radius: 6px;
      border: 1px solid #222;
    }
    .log div { padding: 1px 0; }
    .log .ok { color: #4ade80; }
    .log .err { color: #f87171; }
    .help {
      margin-top: 10px;
      font-size: 12px;
      color: #666;
      text-align: center;
      max-width: 900px;
    }
  </style>
</head>
<body>
  <h1>🔐 Claude API — Remote Login</h1>
  <div class="status checking" id="statusBadge">Checking...</div>

  <div class="screen-wrap" id="screenWrap">
    <img id="screen" alt="Loading screenshot..." />
  </div>

  <div class="controls">
    <input type="text" id="typeInput" placeholder="Type text here, then press Enter or click Type" />
    <button class="primary" onclick="sendType()">⌨ Type</button>
    <button onclick="sendEnter()">↵ Enter</button>
    <button onclick="sendTab()">⇥ Tab</button>
    <button onclick="navigate()">🌐 Go to URL</button>
    <button onclick="refreshScreen()">🔄 Refresh</button>
  </div>

  <div class="log" id="log"></div>
  <div class="help">
    Click anywhere on the screenshot to click that spot. Type in the text box and press Enter to type text.
  </div>

  <script>
    const API_KEY = new URLSearchParams(window.location.search).get('key') || '';
    const headers = { 'x-api-key': API_KEY, 'Content-Type': 'application/json' };
    const logEl = document.getElementById('log');
    const screenImg = document.getElementById('screen');
    const screenWrap = document.getElementById('screenWrap');
    const statusBadge = document.getElementById('statusBadge');
    const typeInput = document.getElementById('typeInput');

    function log(msg, type = '') {
      const d = document.createElement('div');
      d.className = type;
      d.textContent = new Date().toLocaleTimeString() + ' — ' + msg;
      logEl.prepend(d);
    }

    let viewportW = 1280, viewportH = 800;

    async function refreshScreen() {
      try {
        const r = await fetch('/api/remote/screenshot', { headers });
        if (!r.ok) throw new Error('Screenshot failed');
        // Read viewport size from response headers
        const vw = r.headers.get('x-viewport-width');
        const vh = r.headers.get('x-viewport-height');
        if (vw) viewportW = parseInt(vw);
        if (vh) viewportH = parseInt(vh);
        const blob = await r.blob();
        screenImg.src = URL.createObjectURL(blob);
        // When image loads, double-check with DPI ratio
        screenImg.onload = () => {
          const dpr = screenImg.naturalWidth / viewportW;
          if (dpr > 1.5) {
            log('DPR detected: ' + dpr.toFixed(1) + ', viewport: ' + viewportW + 'x' + viewportH, 'ok');
          }
        };
        log('Screenshot refreshed (viewport: ' + viewportW + 'x' + viewportH + ')', 'ok');
      } catch(e) { log('Error: ' + e.message, 'err'); }
    }

    async function checkStatus() {
      try {
        const r = await fetch('/api/auth/status', { headers });
        const d = await r.json();
        statusBadge.textContent = d.loggedIn ? '✅ Logged In' : '❌ Not Logged In';
        statusBadge.className = 'status ' + (d.loggedIn ? 'online' : 'offline');
      } catch(e) {
        statusBadge.textContent = '⚠ Error';
        statusBadge.className = 'status offline';
      }
    }

    // Click on screenshot — bind to the IMAGE directly
    screenImg.addEventListener('click', async (e) => {
      e.stopPropagation();
      const rect = e.target.getBoundingClientRect();
      const clickX = e.clientX - rect.left;
      const clickY = e.clientY - rect.top;
      const x = Math.round(clickX / rect.width * viewportW);
      const y = Math.round(clickY / rect.height * viewportH);

      // Show click marker on wrapper
      const marker = document.createElement('div');
      marker.className = 'click-marker';
      marker.style.left = (clickX) + 'px';
      marker.style.top = (clickY) + 'px';
      screenWrap.appendChild(marker);
      setTimeout(() => marker.remove(), 600);

      log('Click at (' + x + ', ' + y + ') viewport [img: ' + Math.round(clickX) + ',' + Math.round(clickY) + ' of ' + Math.round(rect.width) + 'x' + Math.round(rect.height) + ']');
      try {
        const r = await fetch('/api/remote/click', {
          method: 'POST', headers,
          body: JSON.stringify({ x, y })
        });
        const d = await r.json();
        log(d.success ? 'Click OK' : 'Click failed', d.success ? 'ok' : 'err');
        setTimeout(refreshScreen, 800);
      } catch(e) { log('Error: ' + e.message, 'err'); }
    });

    async function sendType() {
      const text = typeInput.value;
      if (!text) return;
      log('Typing: "' + text + '"...');
      try {
        const r = await fetch('/api/remote/type', {
          method: 'POST', headers,
          body: JSON.stringify({ text })
        });
        const d = await r.json();
        log(d.success ? 'Typed OK' : 'Type failed', d.success ? 'ok' : 'err');
        typeInput.value = '';
        setTimeout(refreshScreen, 500);
      } catch(e) { log('Error: ' + e.message, 'err'); }
    }

    async function sendEnter() {
      log('Pressing Enter...');
      try {
        const r = await fetch('/api/remote/key', {
          method: 'POST', headers,
          body: JSON.stringify({ key: 'Enter' })
        });
        const d = await r.json();
        log(d.success ? 'Enter OK' : 'Enter failed', d.success ? 'ok' : 'err');
        setTimeout(refreshScreen, 800);
      } catch(e) { log('Error: ' + e.message, 'err'); }
    }

    async function sendTab() {
      log('Pressing Tab...');
      try {
        const r = await fetch('/api/remote/key', {
          method: 'POST', headers,
          body: JSON.stringify({ key: 'Tab' })
        });
        const d = await r.json();
        log(d.success ? 'Tab OK' : 'Tab failed', d.success ? 'ok' : 'err');
        setTimeout(refreshScreen, 500);
      } catch(e) { log('Error: ' + e.message, 'err'); }
    }

    async function navigate() {
      const url = prompt('Enter URL to navigate to:', 'https://claude.ai');
      if (!url) return;
      log('Navigating to ' + url + '...');
      try {
        const r = await fetch('/api/remote/navigate', {
          method: 'POST', headers,
          body: JSON.stringify({ url })
        });
        const d = await r.json();
        log(d.success ? 'Navigation OK' : 'Nav failed', d.success ? 'ok' : 'err');
        setTimeout(refreshScreen, 2000);
      } catch(e) { log('Error: ' + e.message, 'err'); }
    }

    // Enter key in text input triggers type
    typeInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); sendType(); }
    });

    // Initial load
    refreshScreen();
    checkStatus();
    setInterval(checkStatus, 15000);
  </script>
</body>
</html>`);
});

/**
 * GET /api/remote/screenshot
 * Returns a live PNG screenshot of the browser
 */
router.get('/screenshot', async (req, res) => {
  try {
    const page = browserService.getPage();
    const viewport = page.viewportSize() || { width: 1280, height: 800 };
    const buffer = await page.screenshot({ type: 'png', fullPage: false });
    res.set('Content-Type', 'image/png');
    res.set('x-viewport-width', String(viewport.width));
    res.set('x-viewport-height', String(viewport.height));
    res.set('Access-Control-Expose-Headers', 'x-viewport-width, x-viewport-height');
    res.send(buffer);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/remote/click
 * Click at specific x,y coordinates
 */
router.post('/click', async (req, res) => {
  try {
    const { x, y } = req.body;
    const page = browserService.getPage();
    await page.mouse.click(x, y);
    res.json({ success: true, action: 'click', x, y });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/remote/type
 * Type text into the currently focused element
 */
router.post('/type', async (req, res) => {
  try {
    const { text } = req.body;
    const page = browserService.getPage();
    await page.keyboard.type(text, { delay: 50 });
    res.json({ success: true, action: 'type', length: text.length });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/remote/key
 * Press a specific key (Enter, Tab, Escape, etc.)
 */
router.post('/key', async (req, res) => {
  try {
    const { key } = req.body;
    const page = browserService.getPage();
    await page.keyboard.press(key);
    res.json({ success: true, action: 'key', key });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/remote/navigate
 * Navigate to a specific URL
 */
router.post('/navigate', async (req, res) => {
  try {
    const { url } = req.body;
    const page = browserService.getPage();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForTimeout(2000);
    res.json({ success: true, action: 'navigate', url: page.url() });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
