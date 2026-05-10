# AI Proxy

A free, open-source local proxy that routes your AI tool requests to any provider — with smart routing, cost tracking, caching, and automatic fallback built in.

> **Bring Your Own API Key (BYOK)**
> This proxy never provides AI credits or charges you anything.
> Its only job is to route requests from your tools to your chosen provider.
> Your keys stay in your `.env` file — never shared, never uploaded.

---

## What It Does

```
Your Tool (Claude Code / Cursor / VS Code / LangChain / any app)
        │
        │  sends request to YOUR proxy
        ▼
  http://localhost:3030
        │
        ├──► Anthropic   (claude-* models)
        ├──► OpenAI      (gpt-*, o1, o3 models)
        ├──► Google      (gemini-* models)
        ├──► Ollama      (free local models — no API key needed)
        └──► OpenRouter  (200+ models via one key)
```

The proxy sits in the middle, picks the most cost-effective model, caches repeated requests, and returns responses — all transparently to your tools.

---

## Why Use This?

| Feature | What it means |
|---|---|
| **Free forever** | Runs on your machine, zero ongoing cost |
| **5 providers** | Anthropic, OpenAI, Gemini, Ollama, OpenRouter — all in one place |
| **Smart Router** | Routes prompts to the right model tier automatically — cheap for simple, powerful for complex |
| **Exact + Semantic Cache** | Identical or similar prompts return instantly at $0 |
| **Cost Tracking** | See exactly how much each request costs in USD |
| **Daily Budget Caps** | Hard spending limits per provider — auto-reject when exceeded |
| **Model Aliases** | Send `gpt-4o`, silently use `ollama/llama4` — no client changes needed |
| **Output Validation** | If a cheap model returns invalid JSON, auto-escalate to a powerful model |
| **Automatic Fallback** | If one provider fails, retry the next one automatically |
| **Live Dashboard** | Web UI with cost, tokens, cache stats, request log at `/dashboard` |
| **No token markup** | Your key talks directly to the provider at their published price |

---

## Requirements

- [Node.js 18+](https://nodejs.org)
- At least one API key **or** Ollama running locally

```bash
node --version   # must be 18 or higher
```

---

## Setup

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

**4. Add at least one provider key**

Open `.env` and uncomment whichever provider you have:

```env
# Pick one or more:

ANTHROPIC_API_KEY=sk-ant-xxxxxxxxxxxxxxxx      # platform.claude.com
# OPENAI_API_KEY=sk-xxxxxxxxxxxxxxxx           # platform.openai.com
# GEMINI_API_KEY=AIzaxxxxxxxxxxxxxxxx          # aistudio.google.com
# OPENROUTER_API_KEY=sk-or-xxxxxxxxxxxxxxxx    # openrouter.ai (200+ models, free key)
# OLLAMA_BASE_URL=http://localhost:11434        # ollama.com (free, runs locally)
# OLLAMA_MODELS=llama3,mistral,codellama
```

> **Tip:** [OpenRouter](https://openrouter.ai) gives you a free API key with access to Llama 4, DeepSeek-R1, Mistral, GPT, and Claude — all in one key. Great starting point.

**5. Start the proxy**
```bash
npm start
```

Expected output:
```
  AI Proxy v4.0 — http://localhost:3030
  ─────────────────────────────────────
  Anthropic:    enabled (claude-* models)
  OpenAI:       disabled
  Gemini:       disabled
  Ollama:       disabled
  OpenRouter:   disabled
  Smart Router: disabled
  Cache:        enabled (max 500 entries)
  ─────────────────────────────────────
  Dashboard:    http://localhost:3030/dashboard
  Health:       http://localhost:3030/health
```

---

## Connecting Your Tools

### Claude Code

```bash
claude config set apiUrl http://localhost:3030
```

### Cursor

1. Open **Settings** → search **OpenAI Base URL**
2. Set to: `http://localhost:3030/v1`
3. Set API Key to any value (e.g. `proxy`)

### VS Code — Continue.dev

```yaml
# ~/.continue/config.yaml
models:
  - name: Claude via Proxy
    provider: openai
    model: claude-sonnet-4-6
    apiBase: http://localhost:3030/v1
    apiKey: any-value
```

### Open WebUI

1. **Admin Panel → Settings → Connections → OpenAI API**
2. URL: `http://localhost:3030/v1`
3. API Key: leave blank (or your `PROXY_API_KEY` if set)
4. Click **Verify Connection**

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

### Anthropic SDK (direct)

```js
import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic({
  baseURL: 'http://localhost:3030',
  apiKey: 'any-value',
});
```

---

## Available Models

Model routing is automatic — the proxy picks the right provider from the model name prefix.

| Prefix / Pattern | Provider | Example models |
|---|---|---|
| `claude-*` | Anthropic | `claude-opus-4-6`, `claude-sonnet-4-6`, `claude-haiku-4-5-20251001` |
| `gpt-*`, `o1`, `o3` | OpenAI | `gpt-4o`, `gpt-4o-mini`, `o3-mini` |
| `gemini-*` | Google | `gemini-2.5-pro`, `gemini-2.0-flash` |
| `openrouter/*` | OpenRouter | `openrouter/meta-llama/llama-3-8b-instruct` |
| anything in `OLLAMA_MODELS` | Ollama | `llama3`, `mistral`, `deepseek-r1` |
| unknown model + `OPENROUTER_API_KEY` set | OpenRouter | catch-all for 200+ models |

---

## Smart Routing (3-Tier System)

Enable automatic model selection based on prompt complexity:

```env
SMART_ROUTING=true
ROUTING_TIER1_MODEL=claude-haiku-4-5-20251001   # fast/cheap — summarize, translate, classify
ROUTING_TIER2_MODEL=claude-sonnet-4-6            # balanced  — coding, writing (default)
ROUTING_TIER3_MODEL=claude-opus-4-6              # powerful  — analysis, research, complex tasks
```

**How it decides:**
- **Tier 1** — short prompt (< 500 tokens) + keywords: `summarize`, `translate`, `list`, `classify`, `yes or no`
- **Tier 3** — long prompt (> 4000 tokens) OR keywords: `analyze`, `compare`, `evaluate`, `reason step by step`, `expert`
- **Tier 2** — everything else

The client's requested model is silently overridden. No code changes needed on the client side.

---

## Model Aliases

Silently rewrite any model name before routing. Clients keep their existing code; you control what actually runs:

```env
ALIAS_gpt-4o=ollama/llama4
ALIAS_gpt-4=openrouter/meta-llama/llama-3-70b-instruct
```

Now when a client sends `model: "gpt-4o"`, the proxy uses `ollama/llama4` — no client changes needed.

---

## Cost Tracking & Budget Caps

Every request logs its estimated USD cost. View in the dashboard or via `/dashboard/stats`.

**Set daily spend limits per provider** (auto-reject with HTTP 429 when exceeded):

```env
ANTHROPIC_DAILY_BUDGET_USD=5.00
OPENAI_DAILY_BUDGET_USD=2.00
GEMINI_DAILY_BUDGET_USD=1.00
OPENROUTER_DAILY_BUDGET_USD=3.00
```

Set to `0` (default) to disable. Limits reset at midnight.

---

## Prompt Caching

### Exact Cache (default: on)

Identical requests (same model + same messages) return instantly at $0 — no API call made.

```env
CACHE_ENABLED=true    # enabled by default
CACHE_MAX_SIZE=500    # max entries in memory
```

Response header `X-Cache: HIT` tells you when a cache hit occurs.

### Semantic Cache (optional)

Similar prompts — `"What is ML?"` and `"Explain machine learning"` — can return the same cached answer using local sentence embeddings. Runs entirely in-process, no server needed.

**Setup:**
```bash
npm install @xenova/transformers   # ~23MB model downloads on first start
```

```env
SEMANTIC_CACHE=true
SEMANTIC_THRESHOLD=0.92   # similarity threshold (0.0–1.0), higher = stricter
```

Response header `X-Cache: SEMANTIC-HIT` when a semantic match is found. Gracefully disabled if the package is not installed.

---

## OpenRouter — 200+ Models With One Key

[OpenRouter](https://openrouter.ai) provides access to GPT-5, Claude, Llama 4, DeepSeek-R1, Mistral, Gemma, and 200+ more models via a single API key. Free to sign up.

```env
OPENROUTER_API_KEY=sk-or-xxxxxxxxxxxxxxxx
```

**Usage:**
```json
{ "model": "openrouter/meta-llama/llama-3-8b-instruct" }
{ "model": "openrouter/deepseek/deepseek-r1" }
{ "model": "openrouter/mistralai/mistral-7b-instruct" }
```

Full model list: [openrouter.ai/models](https://openrouter.ai/models)

---

## Free Local Models with Ollama

[Ollama](https://ollama.com) runs models on your machine — no API key, no internet required for inference.

**1. Install Ollama** from [ollama.com](https://ollama.com)

**2. Pull a model:**
```bash
ollama pull llama3
```

**3. Add to `.env`:**
```env
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODELS=llama3,mistral,codellama
```

Popular models: `llama3`, `mistral`, `codellama`, `phi3`, `qwen2`, `deepseek-r1`, `gemma3`

---

## Automatic Fallback

If a provider fails (rate limit, outage, quota), the proxy retries the next available provider automatically.

```env
FALLBACK_ORDER=anthropic,openai,gemini,ollama,openrouter
```

Only enabled providers are used. The `X-Proxy-Fallback: true` response header tells you when a fallback fired.

Triggers: `429`, `500`, `502`, `503`, `529`
Does not trigger: `400`, `401`, `403` (request or key problem)

---

## Password Protection

When running on a server or sharing with others:

```env
PROXY_API_KEY=choose-a-strong-password
```

Users send this as their API key. Your real provider keys are never exposed. `/health` and `/dashboard` remain public.

---

## Dashboard

Open `http://localhost:3030/dashboard` while the proxy is running.

Shows:
- **Cost Today (USD)** — running spend since midnight
- **Requests today**, tokens in/out, fallback count
- **Usage by Model** — tokens + cost per model (bar chart)
- **Requests by Provider** — breakdown across all 5 providers
- **Cache Stats** — exact cache size and status
- **Recent Requests** — live log with cost, latency, status, cache/fallback/escalation badges

Data resets on restart — in-memory only, no database.

---

## Output Validation

When a request requires JSON output (`response_format: { type: "json_object" }` or system prompt contains "respond in JSON"), the proxy automatically validates the response. If a Tier 1 or Tier 2 model returns invalid JSON, it re-routes to the Tier 3 model and returns that result instead.

Response header `X-Proxy-Escalated: true` indicates escalation happened.

---

## Docker

```bash
docker build -t ai-proxy .
docker run -p 3030:3030 --env-file .env ai-proxy
```

---

## Verify It's Working

```bash
# Health check (no API call)
curl http://localhost:3030/health

# List models
curl http://localhost:3030/v1/models

# Send a real message (Git Bash / Mac / Linux)
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

| Error | Fix |
|---|---|
| `No provider configured` | Add at least one API key or `OLLAMA_BASE_URL` to `.env` |
| `Your credit balance is too low` | Add credits at [platform.claude.com](https://platform.claude.com) → Billing |
| `401 Unauthorized` | You set `PROXY_API_KEY` — send it as the API key in your tool |
| `Daily budget exceeded` | Spend limit hit — increase `*_DAILY_BUDGET_USD` or wait until midnight |
| `502 Bad Gateway` | Proxy can't reach the provider — check internet connection |
| Port already in use | Set `PORT=3031` in `.env` |
| Cursor "connection failed" | Proxy must be running; URL must be `http://localhost:3030/v1` (with `/v1`) |
| Ollama not working | Run `ollama serve` and `ollama pull <model>` first |

---

## Security

- **Keys never leave your machine** — live in `.env`, sent only to the provider's API
- **`.gitignore` protection** — `.env` is blocked from Git commits by default
- **No data stored** — requests forwarded and returned, nothing saved
- **SSRF protection** — Ollama URL validated to block internal network addresses and cloud metadata endpoints
- **XSS protection** — dashboard escapes all user-controlled strings before rendering
- **Timing-safe auth** — `PROXY_API_KEY` uses constant-time comparison to prevent timing attacks
- **Prototype pollution protection** — model/provider keys sanitized before writing to stats objects

---

## All Environment Variables

| Variable | Default | Description |
|---|---|---|
| `ANTHROPIC_API_KEY` | — | Anthropic API key |
| `OPENAI_API_KEY` | — | OpenAI API key |
| `GEMINI_API_KEY` | — | Google Gemini API key |
| `OLLAMA_BASE_URL` | — | Ollama server URL |
| `OLLAMA_MODELS` | — | Comma-separated list of Ollama model names |
| `OPENROUTER_API_KEY` | — | OpenRouter API key |
| `OPENROUTER_SITE_URL` | `http://localhost:3030` | Sent as HTTP-Referer to OpenRouter |
| `OPENROUTER_SITE_NAME` | `AI Proxy` | Sent as X-Title to OpenRouter |
| `FALLBACK_ORDER` | — | Provider retry order, e.g. `anthropic,openai` |
| `ALIAS_<name>` | — | Model alias, e.g. `ALIAS_gpt-4o=ollama/llama4` |
| `SMART_ROUTING` | `false` | Enable 3-tier prompt routing |
| `ROUTING_TIER1_MODEL` | `claude-haiku-4-5-20251001` | Fast model for simple prompts |
| `ROUTING_TIER2_MODEL` | `claude-sonnet-4-6` | Default balanced model |
| `ROUTING_TIER3_MODEL` | `claude-opus-4-6` | Powerful model for complex prompts |
| `ANTHROPIC_DAILY_BUDGET_USD` | `0` | Daily spend cap for Anthropic (0 = off) |
| `OPENAI_DAILY_BUDGET_USD` | `0` | Daily spend cap for OpenAI |
| `GEMINI_DAILY_BUDGET_USD` | `0` | Daily spend cap for Gemini |
| `OPENROUTER_DAILY_BUDGET_USD` | `0` | Daily spend cap for OpenRouter |
| `CACHE_ENABLED` | `true` | Enable exact prompt cache |
| `CACHE_MAX_SIZE` | `500` | Max entries in exact cache |
| `SEMANTIC_CACHE` | `false` | Enable semantic cache (needs `@xenova/transformers`) |
| `SEMANTIC_THRESHOLD` | `0.92` | Cosine similarity threshold for semantic hit |
| `SEMANTIC_CACHE_MAX_SIZE` | `200` | Max entries in semantic store |
| `PROXY_API_KEY` | — | Password protection for the proxy |
| `CORS_ORIGIN` | `*` | Allowed CORS origin |
| `PORT` | `3030` | HTTP server port |
| `REQUEST_TIMEOUT_MS` | `120000` | Request timeout (ms) |
| `RATE_LIMIT_PER_MIN` | `60` | Rate limit per IP per minute (0 = off) |

---

## Stopping the Proxy

Press `Ctrl + C`. To restart: `npm start`

---

## License

[MIT](./LICENSE) — free to use, modify, and share.
