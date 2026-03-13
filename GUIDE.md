# Claude.ai API — Complete Guide

> **Base URL**: `http://localhost:3000` (or your VPS IP)  
> **Auth**: `x-api-key: YOUR_SECRET` header or `?key=YOUR_SECRET` query param  
> **Docs**: `http://localhost:3000/api/docs` (interactive Swagger UI)

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
| `/api/docs` | GET | Swagger API docs (no auth) |
| `/api/auth/status` | GET | Check login status |
| `/api/auth/screenshot` | GET | Debug screenshot |
| `/api/auth/logout` | POST | Logout from claude.ai |
| `/api/chat` | POST | Send message (sync or async) |
| `/api/chat/result/:jobId` | GET | Poll async job result |
| `/api/chat/jobs` | GET | List active async jobs |
| `/api/chat/new` | POST | Start empty conversation |
| `/api/remote` | GET | Remote login UI (browser) |

---

## Sync Mode (default)

Send a message and wait for the full response:

```bash
curl -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -H "x-api-key: YOUR_SECRET" \
  -d '{"message": "Explain APIs in 2 sentences", "newConversation": true}'
```

**Response:**
```json
{
  "success": true,
  "reply": "An API is a set of rules...",
  "artifacts": [],
  "conversationUrl": "https://claude.ai/chat/abc-123",
  "timestamp": "2026-03-13T06:00:00.000Z"
}
```

## Async Mode (for long prompts / proxy timeouts)

Send `async: true` to get a jobId immediately, then poll for results:

### Step 1: Send message
```bash
curl -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -H "x-api-key: YOUR_SECRET" \
  -d '{"message": "Write a long essay", "newConversation": true, "async": true}'
```

**Response (instant):**
```json
{
  "success": true,
  "jobId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "status": "pending"
}
```

### Step 2: Poll for result
```bash
curl -H "x-api-key: YOUR_SECRET" \
  http://localhost:3000/api/chat/result/a1b2c3d4-e5f6-7890-abcd-ef1234567890
```

**Response (pending):**
```json
{ "success": true, "status": "pending", "elapsed": 15 }
```

**Response (completed):**
```json
{
  "success": true,
  "reply": "Here is the full essay...",
  "artifacts": [...],
  "conversationUrl": "https://claude.ai/chat/abc-123"
}
```

> Jobs expire after 30 minutes.

---

## Artifacts

When Claude generates code/JSON as an artifact, it appears in the `artifacts` array:

```json
{
  "artifacts": [
    {
      "type": "artifact",
      "language": "json",
      "title": "Quiz old stone age",
      "content": "{\"lesson_title\": \"...\", \"questions\": [...]}"
    }
  ]
}
```

Access in n8n: `{{ $json.artifacts[0].content }}`

---

## n8n Integration

### Sync Mode (simple, works if no proxy timeout)

Add an **HTTP Request** node:

| Setting | Value |
|---------|-------|
| Method | POST |
| URL | `http://localhost:3000/api/chat` |
| Header | `x-api-key` = `YOUR_SECRET` |
| Body Type | JSON |
| Timeout | `300000` |

Body parameters:
- `message` = `{{ $json.prompt }}`
- `newConversation` = `true`

### Async Mode (works through any proxy)

**Node 1 — HTTP Request (send)**
- POST `http://localhost:3000/api/chat`
- Body: `message`, `newConversation: true`, `async: true`
- Returns: `{ jobId: "..." }`

**Node 2 — Wait**
- Wait 30 seconds

**Node 3 — HTTP Request (poll)**
- GET `http://localhost:3000/api/chat/result/{{ $('Node 1').json.jobId }}`

**Node 4 — IF**
- `{{ $json.status }}` equals `pending` → loop back to Node 2
- Otherwise → continue to parse result

### Parse artifact JSON (Code node)
```javascript
const item = $input.first().json;
const content = item.artifacts?.[0]?.content || '';
try {
  return [{ json: JSON.parse(content) }];
} catch {
  return [{ json: { raw: content } }];
}
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

# Start with PM2
npm install -g pm2
pm2 start server.js --name claude-api
pm2 save && pm2 startup

# Login via Remote UI
# Open: http://YOUR_VPS_IP:3000/api/remote?key=your-secret
```

### PM2 Commands
| Command | Purpose |
|---------|---------|
| `pm2 logs claude-api` | View logs |
| `pm2 restart claude-api` | Restart |
| `pm2 stop claude-api` | Stop |
