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
      background: #0f0f0f; color: #e0e0e0;
      min-height: 100vh; display: flex; flex-direction: column;
      align-items: center; padding: 16px;
    }
    h1 { font-size: 18px; font-weight: 600; margin-bottom: 8px; color: #d4a574; }
    .status { font-size: 13px; margin-bottom: 12px; padding: 6px 14px; border-radius: 20px; font-weight: 500; }
    .status.online { background: #1a3a1a; color: #4ade80; border: 1px solid #2d5a2d; }
    .status.offline { background: #3a1a1a; color: #f87171; border: 1px solid #5a2d2d; }
    .status.checking { background: #1a1a3a; color: #818cf8; border: 1px solid #2d2d5a; }
    canvas {
      border: 2px solid #333; border-radius: 8px; cursor: crosshair;
      width: 100%; max-width: 960px;
      aspect-ratio: 1280 / 800;
      background: #1a1a1a;
    }
    .controls {
      display: flex; gap: 8px; margin-top: 12px;
      width: 100%; max-width: 960px; flex-wrap: wrap;
    }
    input[type="text"] {
      flex: 1; min-width: 200px; padding: 10px 14px;
      background: #1a1a1a; border: 1px solid #333; border-radius: 6px;
      color: #e0e0e0; font-size: 14px; outline: none;
    }
    input[type="text"]:focus { border-color: #d4a574; }
    button {
      padding: 10px 18px; border: 1px solid #333; border-radius: 6px;
      background: #1a1a1a; color: #e0e0e0; font-size: 13px;
      cursor: pointer; font-weight: 500; transition: all 0.15s; white-space: nowrap;
    }
    button:hover { background: #2a2a2a; border-color: #d4a574; }
    button.primary { background: #d4a574; color: #0f0f0f; border-color: #d4a574; font-weight: 600; }
    button.primary:hover { background: #e0b88a; }
    .log {
      margin-top: 12px; width: 100%; max-width: 960px; font-size: 12px;
      color: #888; max-height: 80px; overflow-y: auto;
      font-family: 'Consolas', monospace; padding: 8px;
      background: #1a1a1a; border-radius: 6px; border: 1px solid #222;
    }
    .log div { padding: 1px 0; }
    .log .ok { color: #4ade80; }
    .log .err { color: #f87171; }
    .help { margin-top: 10px; font-size: 12px; color: #666; text-align: center; max-width: 960px; }
  </style>
</head>
<body>
  <h1>🔐 Claude API — Remote Login</h1>
  <div class="status checking" id="statusBadge">Checking...</div>
  <canvas id="screen" width="1280" height="800"></canvas>
  <div class="controls">
    <input type="text" id="typeInput" placeholder="Type text here, then press Enter or click Type" />
    <button class="primary" onclick="sendType()">⌨ Type</button>
    <button onclick="sendEnter()">↵ Enter</button>
    <button onclick="sendTab()">⇥ Tab</button>
    <button onclick="navigate()">🌐 Go to URL</button>
    <button onclick="refreshScreen()">🔄 Refresh</button>
  </div>
  <div class="log" id="log"></div>
  <div class="help">Click on the screenshot to click that spot. Type in the box and press Enter to type.</div>

  <script>
    const API_KEY = new URLSearchParams(window.location.search).get('key') || '';
    const headers = { 'x-api-key': API_KEY, 'Content-Type': 'application/json' };
    const logEl = document.getElementById('log');
    const canvas = document.getElementById('screen');
    const ctx = canvas.getContext('2d');
    const statusBadge = document.getElementById('statusBadge');
    const typeInput = document.getElementById('typeInput');
    // Canvas size is set dynamically from real viewport
    let VW = 1280, VH = 800;

    function log(msg, type = '') {
      const d = document.createElement('div');
      d.className = type;
      d.textContent = new Date().toLocaleTimeString() + ' — ' + msg;
      logEl.prepend(d);
    }

    async function refreshScreen() {
      try {
        const r = await fetch('/api/remote/screenshot', { headers });
        if (!r.ok) throw new Error('Screenshot failed');
        // Read real viewport from response headers
        const rw = r.headers.get('x-real-width');
        const rh = r.headers.get('x-real-height');
        if (rw && rh) {
          VW = parseInt(rw);
          VH = parseInt(rh);
          canvas.width = VW;
          canvas.height = VH;
          canvas.style.aspectRatio = VW + ' / ' + VH;
        }
        const blob = await r.blob();
        const img = new Image();
        img.onload = () => {
          ctx.drawImage(img, 0, 0, VW, VH);
          URL.revokeObjectURL(img.src);
          log('Screenshot (' + VW + 'x' + VH + ')', 'ok');
        };
        img.src = URL.createObjectURL(blob);
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

    // CLICK — canvas coords = viewport coords (both 1280x800)
    canvas.addEventListener('click', async (e) => {
      const rect = canvas.getBoundingClientRect();
      // Scale from CSS display size back to canvas coordinate system (1280x800)
      const x = Math.round((e.clientX - rect.left) / rect.width * VW);
      const y = Math.round((e.clientY - rect.top) / rect.height * VH);

      log('Click → viewport (' + x + ', ' + y + ')');
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
        const r = await fetch('/api/remote/type', { method: 'POST', headers, body: JSON.stringify({ text }) });
        const d = await r.json();
        log(d.success ? 'Typed OK' : 'Type failed', d.success ? 'ok' : 'err');
        typeInput.value = '';
        setTimeout(refreshScreen, 500);
      } catch(e) { log('Error: ' + e.message, 'err'); }
    }
    async function sendEnter() {
      log('Pressing Enter...');
      try {
        const r = await fetch('/api/remote/key', { method: 'POST', headers, body: JSON.stringify({ key: 'Enter' }) });
        const d = await r.json();
        log(d.success ? 'Enter OK' : 'Enter failed', d.success ? 'ok' : 'err');
        setTimeout(refreshScreen, 800);
      } catch(e) { log('Error: ' + e.message, 'err'); }
    }
    async function sendTab() {
      log('Pressing Tab...');
      try {
        const r = await fetch('/api/remote/key', { method: 'POST', headers, body: JSON.stringify({ key: 'Tab' }) });
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
        const r = await fetch('/api/remote/navigate', { method: 'POST', headers, body: JSON.stringify({ url }) });
        const d = await r.json();
        log(d.success ? 'Navigation OK' : 'Nav failed', d.success ? 'ok' : 'err');
        setTimeout(refreshScreen, 2000);
      } catch(e) { log('Error: ' + e.message, 'err'); }
    }
    typeInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); sendType(); }
    });
    refreshScreen();
    checkStatus();
    setInterval(checkStatus, 15000);
  </script>
</body>
</html>`);
});

// --- API Endpoints ---

router.get('/screenshot', async (req, res) => {
  try {
    const page = browserService.getPage();
    // Get REAL viewport from inside the browser
    const realViewport = await page.evaluate(() => ({
      w: window.innerWidth,
      h: window.innerHeight,
    }));
    const buffer = await page.screenshot({ type: 'png', fullPage: false });
    res.set('Content-Type', 'image/png');
    res.set('x-real-width', String(realViewport.w));
    res.set('x-real-height', String(realViewport.h));
    res.set('Access-Control-Expose-Headers', 'x-real-width, x-real-height');
    res.send(buffer);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/remote/debug
 * Returns real viewport info from inside the Playwright browser
 */
router.get('/debug', async (req, res) => {
  try {
    const page = browserService.getPage();
    const playwrightViewport = page.viewportSize();
    const pageInfo = await page.evaluate(() => ({
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      outerWidth: window.outerWidth,
      outerHeight: window.outerHeight,
      devicePixelRatio: window.devicePixelRatio,
      screenWidth: screen.width,
      screenHeight: screen.height,
    }));
    res.json({
      playwright: playwrightViewport,
      browser: pageInfo,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/remote/inspect
 * Inspect the DOM for artifact panel elements
 */
router.get('/inspect', async (req, res) => {
  try {
    const page = browserService.getPage();
    const inspection = await page.evaluate(() => {
      const results = {};
      
      // Check for common artifact/code-related elements
      const selectors = [
        '.cm-content', '.cm-line', '.cm-editor',
        '[class*="artifact"]', '[class*="code-block"]',
        '[class*="panel"]', '[class*="sidebar"]',
        '[class*="CodeMirror"]', '[class*="code-editor"]',
        'pre', 'code',
        '[role="code"]', '[role="textbox"]',
        'button:has-text("Copy")',
      ];
      
      for (const sel of selectors) {
        try {
          const els = document.querySelectorAll(sel);
          if (els.length > 0) {
            results[sel] = els.length + ' found — ' + Array.from(els).slice(0, 2).map(el => {
              const tag = el.tagName;
              const cls = (el.className || '').toString().substring(0, 100);
              const text = (el.textContent || '').substring(0, 80).replace(/\n/g, '\\n');
              const rect = el.getBoundingClientRect();
              return `<${tag} class="${cls}"> pos:(${Math.round(rect.left)},${Math.round(rect.top)}) size:${Math.round(rect.width)}x${Math.round(rect.height)} text:"${text}"`;
            }).join(' | ');
          }
        } catch {}
      }
      
      // Find ALL elements on the right side (> 50% of screen width) with text
      const allEls = document.querySelectorAll('*');
      const rightSide = [];
      for (const el of allEls) {
        const rect = el.getBoundingClientRect();
        if (rect.left > window.innerWidth * 0.4 && rect.width > 100 && rect.height > 100) {
          const text = (el.textContent || '').substring(0, 60).replace(/\n/g, '\\n');
          if (text.length > 20 && el.childElementCount < 5) {
            rightSide.push(`<${el.tagName} class="${(el.className||'').toString().substring(0,80)}"> size:${Math.round(rect.width)}x${Math.round(rect.height)} text:"${text}"`);
          }
        }
        if (rightSide.length >= 5) break;
      }
      results['RIGHT_SIDE'] = rightSide;
      
      return results;
    });
    res.json(inspection);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/remote/click  { x, y }
 * x, y are viewport coordinates (0-1280, 0-800) — sent directly from canvas
 */
router.post('/click', async (req, res) => {
  try {
    const { x, y } = req.body;
    const page = browserService.getPage();

    // Debug marker
    await page.evaluate(({x, y}) => {
      document.querySelectorAll('.remote-click-marker').forEach(el => el.remove());
      const dot = document.createElement('div');
      dot.className = 'remote-click-marker';
      dot.style.cssText = `position:fixed;left:${x}px;top:${y}px;width:14px;height:14px;background:red;border:2px solid white;border-radius:50%;z-index:999999;transform:translate(-50%,-50%);pointer-events:none;box-shadow:0 0 6px rgba(255,0,0,0.8);`;
      document.body.appendChild(dot);
      setTimeout(() => dot.remove(), 5000);
    }, { x, y });

    await page.mouse.click(x, y);
    console.log(`🖱️ Remote click: viewport(${x}, ${y})`);
    res.json({ success: true, action: 'click', x, y });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

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
