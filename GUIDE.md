# Claude.ai API — Complete Guide

> **Base URL**: `http://localhost:3000` (or your VPS IP)  
> **Auth**: `x-api-key: YOUR_SECRET` header or `?key=YOUR_SECRET` query param

---

## Getting Started

### Prerequisites
- **Node.js 18+** → [download](https://nodejs.org)
- A **claude.ai account**

### Install
```bash
git clone https://github.com/drjimmy1990/claude-api-server.git
cd claude-api-server
npm install
```

### Configure `.env`
```env
PORT=3000
API_SECRET=your-strong-secret-here
HEADLESS=false
```

### First Run — Login
```bash
npm start
```
A browser window opens → log in to claude.ai → session saves automatically.

### Production Mode
```env
HEADLESS=true
```
Restart: `npm start` — runs without visible browser.

---

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/health` | GET | Health check (no auth) |
| `/api/auth/status` | GET | Check login status |
| `/api/auth/logout` | POST | Logout from claude.ai |
| `/api/auth/screenshot` | GET | Debug screenshot |
| `/api/chat` | POST | Send message & get reply |
| `/api/chat/new` | POST | Start empty conversation |
| `/api/remote` | GET | Remote login UI (browser) |
| `/api/remote/debug` | GET | Viewport debug info |

---

## 1. Health Check
```bash
curl http://localhost:3000/api/health
```

## 2. Check Login Status
```bash
curl -H "x-api-key: YOUR_SECRET" \
  http://localhost:3000/api/auth/status
```

## 3. Send a Message
```bash
curl -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -H "x-api-key: YOUR_SECRET" \
  -d '{"message": "Explain what an API is in 2 sentences"}'
```

**Response:**
```json
{
  "success": true,
  "reply": "An API is a set of rules...",
  "artifacts": [],
  "conversationUrl": "https://claude.ai/chat/abc-123",
  "timestamp": "2026-03-13T01:00:00.000Z"
}
```

## 4. New Conversation
```bash
curl -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -H "x-api-key: YOUR_SECRET" \
  -d '{"message": "Write a Python sort function", "newConversation": true}'
```

## 5. Logout
```bash
curl -X POST http://localhost:3000/api/auth/logout \
  -H "x-api-key: YOUR_SECRET"
```

## 6. Remote Login (for VPS)
Open in browser:
```
http://YOUR_VPS_IP:3000/api/remote?key=YOUR_SECRET
```

---

## Sending Long Prompts (e.g. Quiz Generator)

For long prompts, save the prompt to a file and send it via a script. The API supports prompts up to any length and waits up to **5 minutes** for Claude to finish.

### Using curl (Linux/Mac/VPS)

**Step 1:** Save your prompt to `prompt.txt`:
```
Your long prompt text here...
```

**Step 2:** Send it:
```bash
# Create JSON payload from text file and send
jq -Rs '{message: ., newConversation: true}' prompt.txt | \
  curl -X POST http://localhost:3000/api/chat \
    -H "Content-Type: application/json" \
    -H "x-api-key: YOUR_SECRET" \
    --max-time 300 \
    -d @- \
    -o response.json

# View the reply
cat response.json | jq -r '.reply'
```

> **`--max-time 300`** = 5 minute timeout. Essential for long responses.

### Using PowerShell (Windows)

```powershell
# Read prompt from file
$prompt = Get-Content -Path "prompt.txt" -Raw

# Escape for JSON
$escaped = $prompt.Replace('\', '\\').Replace('"', '\"').Replace("`n", '\n').Replace("`r", '')
$body = '{"message": "' + $escaped + '", "newConversation": true}'

# Send
$r = Invoke-RestMethod -Uri "http://localhost:3000/api/chat" `
  -Method Post `
  -Headers @{"x-api-key"="YOUR_SECRET"; "Content-Type"="application/json"} `
  -Body ([System.Text.Encoding]::UTF8.GetBytes($body)) `
  -TimeoutSec 300

# View reply
$r.reply
```

---

## n8n Integration

### HTTP Request Node Config

| Setting | Value |
|---------|-------|
| **Method** | `POST` |
| **URL** | `http://YOUR_VPS_IP:3000/api/chat` |
| **Authentication** | None (use header below) |
| **Send Headers** | ✅ On |
| **Header Name** | `x-api-key` |
| **Header Value** | `YOUR_SECRET` |
| **Body Type** | JSON |
| **Timeout** | `300000` (5 min — **IMPORTANT!**) |

### JSON Body (simple prompt)
```json
{
  "message": "Your prompt here",
  "newConversation": true
}
```

### JSON Body (dynamic from previous node)
```json
{
  "message": "{{ $json.prompt }}",
  "newConversation": true
}
```

### ⚠️ IMPORTANT: Set Timeout
In the HTTP Request node → **Options** → **Timeout** → `300000`

Without this, n8n will timeout after ~60s while Claude is still generating.

### Access Response in Next Node

| Data | Expression |
|------|------------|
| Full reply | `{{ $json.reply }}` |
| Artifacts | `{{ $json.artifacts }}` |
| First artifact | `{{ $json.artifacts[0].content }}` |
| Chat URL | `{{ $json.conversationUrl }}` |

### Extract JSON from Reply (Code Node)
If Claude returns JSON with some thinking text before it:
```javascript
const reply = $input.first().json.reply;
const jsonStart = reply.indexOf('{');
const jsonEnd = reply.lastIndexOf('}');
if (jsonStart !== -1 && jsonEnd !== -1) {
  return [{ json: JSON.parse(reply.substring(jsonStart, jsonEnd + 1)) }];
}
return [{ json: { raw: reply } }];
```

---

## VPS Deployment (Ubuntu)

```bash
# Install Node.js
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt install -y nodejs

# Clone & install
git clone https://github.com/drjimmy1990/claude-api-server.git /opt/claude-api
cd /opt/claude-api
npm install

# Install Chromium for Playwright
npx playwright install chromium
npx playwright install-deps chromium

# Configure
cat > .env << 'EOF'
PORT=3000
API_SECRET=your-strong-secret-here
HEADLESS=true
EOF

# Start with PM2 (keeps alive + auto-restart)
npm install -g pm2
pm2 start server.js --name claude-api
pm2 save
pm2 startup

# Login via Remote UI
# Open in your browser: http://YOUR_VPS_IP:3000/api/remote?key=your-strong-secret-here
```

### PM2 Commands
| Command | Purpose |
|---------|---------|
| `pm2 logs claude-api` | View logs |
| `pm2 restart claude-api` | Restart |
| `pm2 stop claude-api` | Stop |
| `pm2 start claude-api` | Start |
