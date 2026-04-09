# AI Proxy

A free, open-source local proxy that routes your AI tool requests to any AI provider.
Run it once on your machine — every tool you use connects through it.

> **Bring Your Own API Key (BYOK)**
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
        ├──► Anthropic  (claude-* models)
        ├──► OpenAI     (gpt-* models)
        ├──► Google     (gemini-* models)
        └──► Ollama     (free local models — no API key needed)
```

The proxy sits in the middle, routes your requests to the right provider, and returns
the responses. Your API keys live only in your `.env` file — never shared, never
uploaded, never logged.

---

## Why Use This?

- **Free forever** — runs on your machine, zero ongoing cost
- **No token markup** — your key talks directly to the provider at their published list price
- **Works with any vendor** — Anthropic, OpenAI, Gemini, Ollama, or any OpenAI-compatible API
- **Your key stays local** — never sent to any third party, lives only in your `.env` file
- **5-minute setup** — clone, add your key, done
- **Works with every major AI tool** — Cursor, VS Code, Open WebUI, LangChain, Claude Code
- **Automatic fallback** — if one provider fails, it retries the next one automatically
- **Usage dashboard** — live web UI showing requests, tokens, and latency at `/dashboard`
- **Free local models** — add Ollama to run models with no API key at all

---

## Requirements

- [Node.js 18+](https://nodejs.org) — download and install if you don't have it
- At least one API key **or** Ollama running locally

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

Open `.env` and add at least one provider. You only need one — add whichever you have:

```
# Anthropic (Claude models) — platform.claude.com
ANTHROPIC_API_KEY=sk-ant-xxxxxxxxxxxxxxxx

# OpenAI (GPT models) — platform.openai.com
# OPENAI_API_KEY=sk-xxxxxxxxxxxxxxxx

# Google Gemini — aistudio.google.com
# GEMINI_API_KEY=AIzaxxxxxxxxxxxxxxxx

# Ollama (free local models — no key needed) — ollama.com
# OLLAMA_BASE_URL=http://localhost:11434
# OLLAMA_MODELS=llama3,mistral,codellama
```

**5. Start the proxy**
```bash
npm start
```

You should see:
```
  AI Proxy v3.0 — http://localhost:3030
  ─────────────────────────────────────
  Anthropic:  enabled (claude-* models)
  OpenAI:     disabled
  Gemini:     disabled
  Ollama:     disabled
  Fallback:   disabled
  ─────────────────────────────────────
  Auth:       disabled
  Rate limit: 60 req/min
  CORS:       *
  Timeout:    120s
  ─────────────────────────────────────
  Dashboard:  http://localhost:3030/dashboard
  Health:     http://localhost:3030/health
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
3. Click **Verify Connection** — it will show the available model list

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

Model routing is automatic — the proxy picks the right provider based on the model name.

| Model | Provider | Notes |
|---|---|---|
| `claude-opus-4-6` | Anthropic | Complex reasoning, long documents |
| `claude-sonnet-4-6` | Anthropic | Balanced — speed and quality (default) |
| `claude-haiku-4-5-20251001` | Anthropic | Fast, cheap, simple tasks |
| `gpt-4o`, `gpt-4o-mini`, etc. | OpenAI | Requires `OPENAI_API_KEY` |
| `gemini-2.5-pro`, `gemini-2.0-flash`, etc. | Google | Requires `GEMINI_API_KEY` |
| Any model name in `OLLAMA_MODELS` | Ollama | Requires `OLLAMA_BASE_URL` |

---

## Usage Dashboard

Open `http://localhost:3030/dashboard` in your browser while the proxy is running.

The dashboard shows:
- Requests today, total tokens in/out, fallback count
- Token usage per model (bar chart)
- Request count per provider
- Recent request log with latency and status

Data resets when the proxy restarts — it's in-memory only, no database.

---

## Optional: Free Local Models with Ollama

[Ollama](https://ollama.com) runs AI models on your own machine — completely free, no API key needed.

**1. Install Ollama** from [ollama.com](https://ollama.com)

**2. Pull a model:**
```bash
ollama pull llama3
```

**3. Add to `.env`:**
```
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODELS=llama3
```

Now requests for `llama3` route to your local Ollama. No internet required for inference.

Popular models: `llama3`, `mistral`, `codellama`, `phi3`, `qwen2`, `deepseek-r1`, `gemma3`

---

## Optional: Automatic Fallback

If one provider fails (rate limit, outage, quota exceeded), the proxy can automatically
retry with the next available provider.

Add to `.env`:
```
FALLBACK_ORDER=anthropic,openai,gemini,ollama
```

Only enabled providers are used. If Anthropic returns a 429 (rate limit), the proxy
retries OpenAI automatically. The `X-Proxy-Fallback: true` header tells you when a
fallback was used.

Errors that trigger fallback: `429`, `500`, `502`, `503`, `529`
Errors that do not: `400`, `401`, `403` (your request or key is the problem)

---

## Optional: Protect with a Password

If you run this on a server or want to share access with others:

```
# .env
PROXY_API_KEY=choose-a-strong-password
```

Users send this as their API key. Your real provider keys are never exposed.
The `/health` and `/dashboard` endpoints remain public.

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
curl -s -X POST http://localhost:3030/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"claude-haiku-4-5-20251001","max_tokens":20,"messages":[{"role":"user","content":"Hi"}]}'

# PowerShell
Invoke-RestMethod -Uri "http://localhost:3030/v1/chat/completions" -Method POST `
  -Headers @{"Content-Type"="application/json"} `
  -Body '{"model":"claude-haiku-4-5-20251001","max_tokens":20,"messages":[{"role":"user","content":"Hi"}]}'
```

---

## Troubleshooting

**`No provider configured`**
→ Open `.env` and add at least one API key or `OLLAMA_BASE_URL`.

**`Your credit balance is too low`**
→ Add credits at [platform.claude.com](https://platform.claude.com) under Billing.

**`401 Unauthorized`**
→ You set `PROXY_API_KEY`. Make sure your tool is sending it as the API key.

**`502 Bad Gateway`**
→ The proxy can't reach the upstream provider. Check your internet connection.

**Port already in use**
→ Change the port in `.env`: `PORT=3031`

**Cursor says "connection failed"**
→ Make sure the proxy is running (`npm start`), and the URL is `http://localhost:3030/v1` (with `/v1`).

**Ollama not working**
→ Make sure Ollama is running (`ollama serve`) and the model is pulled (`ollama pull llama3`).

---

## Security

- **Your API keys never leave your machine.** They live in `.env` and are only ever sent directly to the provider's API.
- **`.gitignore` protects you.** The `.env` file is blocked from being committed to Git by default.
- **No data stored.** The proxy forwards requests and returns responses — nothing is saved, no database, no logs sent anywhere.
- **SSRF protection.** The Ollama URL is validated to block requests to internal network addresses and cloud metadata endpoints.
- **XSS protection.** The dashboard escapes all model and provider names before rendering.
- **Timing-safe auth.** The `PROXY_API_KEY` check uses constant-time comparison to prevent timing attacks.

---

## Stopping the Proxy

Press `Ctrl + C` in the terminal where it's running.

To start again: `npm start`

---

## License

[MIT](./LICENSE) — free to use, modify, and share. No restrictions.
