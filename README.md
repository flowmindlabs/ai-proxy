# AI Proxy

A free, open-source local proxy that routes your AI tool requests to any AI provider.
Run it once on your machine — every tool you use connects through it.

> **⚠️ Bring Your Own API Key (BYOK)**
> This proxy does not provide any AI credits or API access.
> Its only job is to route requests from your tools to your chosen AI provider.
> You bring your own API key — the proxy never touches your credits or bills you anything.

---

## What It Does

```
Your Tool (Claude Code / Cursor / VS Code / any app)
        │
        │  sends request to YOUR proxy
        ▼
  http://localhost:3030
        │
        └──► your AI provider (Anthropic / OpenAI / any compatible API)
```

That's it. The proxy sits in the middle, forwards your requests, and returns the responses.
Your API key lives only in your `.env` file — never shared, never uploaded, never logged.

---

## Why Use This?

- **Free forever** — runs on your machine, zero ongoing cost
- **No token markup** — your key talks directly to the provider at their published list price
- **Works with any vendor** — Anthropic, OpenAI, or any OpenAI-compatible API
- **Your key stays local** — never sent to any third party, lives only in your `.env` file
- **5-minute setup** — clone, add your key, done
- **Works with every major AI tool** — Cursor, VS Code, Open WebUI, LangChain, Claude Code
- **No data stored** — the proxy forwards requests and returns responses, nothing is saved

---

## Requirements

- [Node.js 18+](https://nodejs.org) — download and install if you don't have it
- Your own API key from any provider — bring your own, this proxy does not supply one
  - Anthropic: [platform.claude.com](https://platform.claude.com)
  - OpenAI: [platform.openai.com](https://platform.openai.com)

Check Node.js is installed:
```bash
node --version
```

---

## Setup (5 minutes)

**1. Clone the repo**
```bash
git clone https://github.com/flowmindlabs/ai-proxy.git
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

Open `.env` and replace the placeholder with your real key:
```
ANTHROPIC_API_KEY=sk-ant-xxxxxxxxxxxxxxxx
```

**5. Start the proxy**
```bash
npm start
```

You should see:
```
  AI Proxy running on http://localhost:3030
  Anthropic API:    enabled
  OpenAI API:       disabled
  Auth:             disabled
  Rate limit:       60 req/min per IP
  Health check:     http://localhost:3030/health
```

---

## Connecting Your Tools

### Claude Code (CLI)

```bash
claude config set apiUrl http://localhost:3030
```

### Cursor

1. Open **Settings** (Ctrl+Shift+J)
2. Search for **OpenAI Base URL**
3. Set it to: `http://localhost:3030/v1`
4. Set API Key to any value (e.g. `proxy`)

### VS Code — Continue.dev

Add to `~/.continue/config.yaml`:
```yaml
models:
  - name: Claude via Proxy
    provider: openai
    model: claude-sonnet-4-6
    apiBase: http://localhost:3030/v1
    apiKey: any-value
```

If you set `PROXY_API_KEY`, use that as `apiKey`.

### Open WebUI

1. Go to **Admin Panel → Settings → Connections**
2. Under OpenAI API:
   - URL: `http://localhost:3030/v1`
   - API Key: leave blank (or your `PROXY_API_KEY` if set)
3. Click **Verify Connection** — it will show the Claude model list

### LangChain (JavaScript)

```js
import { ChatOpenAI } from '@langchain/openai';

const llm = new ChatOpenAI({
  modelName: 'claude-sonnet-4-6',
  openAIApiKey: 'any-value',
  configuration: { baseURL: 'http://localhost:3030/v1' },
});
```

### LangChain (Python)

```python
from langchain_openai import ChatOpenAI

llm = ChatOpenAI(
    model="claude-sonnet-4-6",
    api_key="any-value",
    base_url="http://localhost:3030/v1",
)
```

### Any Anthropic SDK app

```js
import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic({
  baseURL: 'http://localhost:3030',
  apiKey: 'any-value',
});
```

---

## Available Models

The proxy exposes these Claude models. Use them by name in any tool:

| Model | Best for |
|---|---|
| `claude-opus-4-6` | Complex reasoning, long documents |
| `claude-sonnet-4-6` | Balanced — speed and quality (default) |
| `claude-haiku-4-5-20251001` | Fast, cheap, simple tasks |

---

## Security

- **Your API key never leaves your machine.** It lives in `.env` and is only ever sent to `api.anthropic.com` or `api.openai.com`.
- **`.gitignore` protects you.** The `.env` file is blocked from being committed to Git by default.
- **No data stored.** The proxy forwards requests and returns responses — nothing is saved, no database, no logs sent anywhere.
- **Optional password protection.** Set `PROXY_API_KEY` in `.env` to require a password for anyone connecting to your proxy — useful if you run it on a server.

---

## Optional: Protect with a Password

If you run this on a server or want to share access with others:

```
# .env
PROXY_API_KEY=choose-a-strong-password
```

Users send this as their API key. Your real Anthropic key is never exposed.

---

## Optional: Enable OpenAI Models

If you have an OpenAI API key, add it to `.env`:

```
OPENAI_API_KEY=sk-xxxxxxxxxxxxxxxx
```

Now requests using `gpt-*` model names route directly to OpenAI using your OpenAI key. Claude model requests still go to Anthropic using your Anthropic key. Each provider uses its own key — you are always in control.

---

## Optional: Run with Docker

```bash
docker build -t ai-proxy .
docker run -p 3030:3030 --env-file .env ai-proxy
```

---

## Verify It's Working

**Health check (free, no API call):**
```bash
# Git Bash / Mac / Linux
curl http://localhost:3030/health

# PowerShell
Invoke-RestMethod -Uri "http://localhost:3030/health"
```

**List models:**
```bash
curl http://localhost:3030/v1/models
```

**Send a real message:**
```bash
# Git Bash
curl -s -X POST http://localhost:3030/v1/messages \
  -H "Content-Type: application/json" \
  -d '{"model":"claude-haiku-4-5-20251001","max_tokens":20,"messages":[{"role":"user","content":"Hi"}]}'

# PowerShell
Invoke-RestMethod -Uri "http://localhost:3030/v1/messages" -Method POST -Headers @{"Content-Type"="application/json"} -Body '{"model":"claude-haiku-4-5-20251001","max_tokens":20,"messages":[{"role":"user","content":"Hi"}]}'
```

---

## Troubleshooting

**`ANTHROPIC_API_KEY is not set`**
→ Make sure you copied `.env.example` to `.env` and added your key.

**`Your credit balance is too low`**
→ Add credits at [platform.claude.com](https://platform.claude.com) under Billing.

**`401 Unauthorized`**
→ You set `PROXY_API_KEY`. Make sure your tool is sending it as the API key.

**`502 Bad Gateway`**
→ The proxy can't reach Anthropic. Check your internet connection.

**Port already in use**
→ Change the port in `.env`: `PORT=3031`

**Cursor says "connection failed"**
→ Make sure the proxy is running (`npm start`), and the URL is `http://localhost:3030/v1` (with `/v1`).

---

## Stopping the Proxy

Press `Ctrl + C` in the terminal where it's running.

To start again: `npm start`

---

## License

[MIT](./LICENSE) — free to use, modify, and share. No restrictions.
