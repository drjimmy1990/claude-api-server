# Claude.ai API — Usage Guide

## Getting Started

### Prerequisites

- **Node.js 18+** installed → [download](https://nodejs.org)
- A **claude.ai account** (free or paid)

### Step 1: Install Dependencies

```powershell
cd C:\Users\LOQ\Desktop\claude-api
npm install
```

This installs Express, Playwright, and downloads a Chromium browser automatically.

### Step 2: Configure

Open `.env` and set your secret key (used to protect your API):

```env
PORT=3000
API_SECRET=claude-n8n-secret-2026
HEADLESS=false
```

> **HEADLESS=false** means the browser window will be visible. You need this for the first run to log in.

### Step 3: First Run — Login

```powershell
npm start
```

**What happens:**
1. A Chromium browser window opens and navigates to **claude.ai**
2. You'll see the claude.ai login page
3. **Log in manually** (Google, email, etc.)
4. Once you see the claude.ai chat interface, you're done — the session is saved

**Console output when ready:**
```
🚀 Claude.ai API Server Starting...
🌐 Launching browser (headless: false)...
📍 Navigating to claude.ai...
✅ Already logged into claude.ai!
🌐 API Server running on: http://localhost:3000
```

### Step 4: Production Mode (Optional)

After your first login, the session is saved in the `browser-data/` folder. You can now run headless (no visible browser window):

1. Open `.env` and change:
   ```env
   HEADLESS=true
   ```
2. Restart:
   ```powershell
   npm start
   ```

### Stopping the Server

Press `Ctrl+C` in the terminal.

### Re-login (If Session Expires)

Set `HEADLESS=false` in `.env`, restart with `npm start`, and log in again in the browser.

---

> **Base URL**: `http://localhost:3000`  
> **Auth Header**: `x-api-key: claude-n8n-secret-2026`

---

## 1. Health Check

```bash
curl http://localhost:3000/api/health
```

```powershell
Invoke-RestMethod http://localhost:3000/api/health
```

---

## 2. Check Login Status

```bash
curl -H "x-api-key: claude-n8n-secret-2026" \
  http://localhost:3000/api/auth/status
```

```powershell
Invoke-RestMethod -Uri "http://localhost:3000/api/auth/status" `
  -Headers @{"x-api-key"="claude-n8n-secret-2026"}
```

**Response:**
```json
{
  "success": true,
  "loggedIn": true,
  "currentUrl": "https://claude.ai/new",
  "message": "Logged in to claude.ai ✅"
}
```

---

## 3. Send a Message (Same Conversation)

```bash
curl -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -H "x-api-key: claude-n8n-secret-2026" \
  -d '{"message": "Explain what an API is in 2 sentences"}'
```

```powershell
Invoke-RestMethod -Uri "http://localhost:3000/api/chat" `
  -Method Post `
  -Headers @{"x-api-key"="claude-n8n-secret-2026"; "Content-Type"="application/json"} `
  -Body '{"message": "Explain what an API is in 2 sentences"}'
```

**Response:**
```json
{
  "success": true,
  "reply": "An API (Application Programming Interface) is a set of rules...",
  "artifacts": [],
  "conversationUrl": "https://claude.ai/chat/abc-123",
  "timestamp": "2026-03-12T18:43:01.635Z"
}
```

---

## 4. Start a New Conversation

```bash
curl -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -H "x-api-key: claude-n8n-secret-2026" \
  -d '{"message": "Write a Python sort function", "newConversation": true}'
```

```powershell
Invoke-RestMethod -Uri "http://localhost:3000/api/chat" `
  -Method Post `
  -Headers @{"x-api-key"="claude-n8n-secret-2026"; "Content-Type"="application/json"} `
  -Body '{"message": "Write a Python sort function", "newConversation": true}'
```

> Set `"newConversation": true` to start a **fresh chat** with no prior context.  
> Omit it (or set `false`) to **continue** the current conversation.

---

## 5. Start Empty New Conversation (No Message)

```bash
curl -X POST http://localhost:3000/api/chat/new \
  -H "Content-Type: application/json" \
  -H "x-api-key: claude-n8n-secret-2026" \
  -d '{}'
```

```powershell
Invoke-RestMethod -Uri "http://localhost:3000/api/chat/new" `
  -Method Post `
  -Headers @{"x-api-key"="claude-n8n-secret-2026"; "Content-Type"="application/json"} `
  -Body '{}'
```

---

## 6. Get Code with Artifacts

```bash
curl -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -H "x-api-key: claude-n8n-secret-2026" \
  -d '{"message": "Write a JavaScript function to reverse a string", "newConversation": true}'
```

**Response with artifacts:**
```json
{
  "success": true,
  "reply": "function reverseString(str) {\n  return str.split('').reverse().join('');\n}",
  "artifacts": [
    {
      "type": "code",
      "language": "javascript",
      "title": "code-block-1",
      "content": "function reverseString(str) {\n  return str.split('').reverse().join('');\n}"
    }
  ],
  "conversationUrl": "https://claude.ai/chat/xyz-456",
  "timestamp": "2026-03-13T01:00:00.000Z"
}
```

---

## 7. Debug Screenshot

```bash
curl -H "x-api-key: claude-n8n-secret-2026" \
  http://localhost:3000/api/auth/screenshot \
  --output screenshot.png
```

```powershell
Invoke-WebRequest -Uri "http://localhost:3000/api/auth/screenshot" `
  -Headers @{"x-api-key"="claude-n8n-secret-2026"} `
  -OutFile screenshot.png
```

---

## n8n Setup

### HTTP Request Node Config

| Field | Value |
|-------|-------|
| Method | `POST` |
| URL | `http://localhost:3000/api/chat` |
| Send Headers | ✅ Yes |
| Header 1 Name | `x-api-key` |
| Header 1 Value | `claude-n8n-secret-2026` |
| Body Type | `JSON` |
| JSON Body | `{"message": "{{ $json.prompt }}", "newConversation": true}` |

### Access Response in Next Node

| Data | Expression |
|------|-----------|
| Full reply text | `{{ $json.reply }}` |
| All artifacts | `{{ $json.artifacts }}` |
| First code block | `{{ $json.artifacts[0].content }}` |
| Chat URL | `{{ $json.conversationUrl }}` |



