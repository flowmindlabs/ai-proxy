# AI Proxy

A lightweight local proxy that routes your AI tool requests to the Anthropic API.

Instead of configuring your API key in every tool separately, you run this proxy once and point all your tools at it.

---

## How It Works

```
Your Tool (Claude Code / Cursor / any app)
        │
        ▼
  http://localhost:3030   ← this proxy
        │
        ▼
  https://api.anthropic.com
```

Your API key stays in one place — on your machine, in a `.env` file that never gets shared.

---

## Requirements

- [Node.js 18+](https://nodejs.org) — download and install if you don't have it
- An Anthropic API key — get one at [console.anthropic.com](https://console.anthropic.com)

Check you have Node.js installed:
```bash
node --version
```

---

## Setup (5 minutes)

**1. Clone the repo**
```bash
git clone https://github.com/YOUR_USERNAME/ai-proxy.git
cd ai-proxy
```

**2. Install dependencies**
```bash
npm install
```

**3. Create your config file**
```bash
cp .env.example .env
```

**4. Add your API key**

Open `.env` in any text editor and replace `your-anthropic-api-key-here` with your real key:
```
ANTHROPIC_API_KEY=sk-ant-xxxxxxxxxxxxxxxx
```

**5. Start the proxy**
```bash
npm start
```

You should see:
```
✓ Proxy running on http://localhost:3030
✓ Auth: disabled (set PROXY_API_KEY to enable)
  Health check: http://localhost:3030/health
```

---

## Connecting Your Tools

### Claude Code (CLI)

```bash
claude config set apiUrl http://localhost:3030
```

Or set it per-session:
```bash
ANTHROPIC_BASE_URL=http://localhost:3030 claude
```

### Cursor

Go to **Settings → AI → OpenAI API Base URL** and set it to:
```
http://localhost:3030
```

### Any app using the Anthropic SDK

```js
import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic({
  baseURL: 'http://localhost:3030',
  apiKey: 'any-value', // proxy handles the real key
});
```

---

## Optional: Protect with a Password

If you run this on a server or want to share access with others, add a `PROXY_API_KEY` to your `.env`:

```
PROXY_API_KEY=choose-a-strong-password-here
```

Anyone connecting must send this as their API key. Your real Anthropic key is never exposed.

---

## Optional: Run with Docker

```bash
docker build -t ai-proxy .
docker run -p 3030:3030 --env-file .env ai-proxy
```

---

## Verify It's Working

```bash
curl http://localhost:3030/health
```

Expected response:
```json
{ "status": "ok", "timestamp": "..." }
```

---

## Stopping the Proxy

Press `Ctrl + C` in the terminal where it's running.

To start it again, just run `npm start` from the project folder.

---

## Troubleshooting

**`ANTHROPIC_API_KEY is not set`**
→ Make sure you created `.env` from `.env.example` and added your key.

**`401 Unauthorized`**
→ You set a `PROXY_API_KEY`. Make sure your tool is sending it as the API key.

**`502 Bad Gateway`**
→ The proxy can't reach Anthropic. Check your internet connection.

**Port already in use**
→ Change the port in `.env`: `PORT=3031`

---

## License

MIT — free to use, modify, and share.
