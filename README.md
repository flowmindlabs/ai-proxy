# AI Proxy

A free, open-source local proxy that connects your AI tools to Anthropic (Claude) and OpenAI APIs.
Run it once on your machine — every tool you use connects through it.

> **⚠️ You need your own API key with credits loaded.**
> Get an Anthropic key at [console.anthropic.com](https://console.anthropic.com) and add credits under Billing.
> Without credits you will get a `"Your credit balance is too low"` error.
> A $5 top-up is more than enough to get started.

---

## Why Use This Instead of Paid Proxies?

Most developers today pay for proxy services they don't need to pay for.

| | **This proxy** | LiteLLM | OpenRouter | Helicone |
|---|---|---|---|---|
| Cost | **Free** | Free (self-host) / Paid cloud | Paid per token | $20+/mo |
| Token markup | **None — list price** | None | Yes | Yes |
| Your key stays local | **Yes** | Yes | No | No |
| Setup time | **5 minutes** | 30+ min (Python, Redis) | Account signup | Account signup |
| Language | **Node.js** | Python | Cloud only | Cloud only |
| Beginner friendly | **Yes** | No | Yes | Yes |
| Data stored | **Nothing** | Depends | Yes | Yes |

**Bottom line:** Your API key talks directly to Anthropic at published list prices. No middleman, no markup, no subscription.

---

## How It Works

```
Your Tool (Claude Code / Cursor / VS Code / any app)
        │
        │  sends request to YOUR proxy
        ▼
  http://localhost:3030
        │
        ├── Anthropic format ──► https://api.anthropic.com
        └── OpenAI format ─────► translated to Anthropic internally
                                  (or forwarded to OpenAI if you set OPENAI_API_KEY)
```

Your API key lives in one `.env` file on your machine — never shared, never uploaded.

---

## Requirements

- [Node.js 18+](https://nodejs.org) — download and install if you don't have it
- An Anthropic API key with credits — [console.anthropic.com](https://console.anthropic.com)

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

The proxy exposes these Claude models. You can use them by name in any tool:

| Model | Best for |
|---|---|
| `claude-opus-4-6` | Complex reasoning, long documents |
| `claude-sonnet-4-6` | Balanced — speed and quality (default) |
| `claude-haiku-4-5-20251001` | Fast, cheap, simple tasks |

When you send a GPT model name, it's automatically mapped:

| You send | Gets routed to |
|---|---|
| `gpt-4o` | `claude-sonnet-4-6` |
| `gpt-4` | `claude-sonnet-4-6` |
| `gpt-3.5-turbo` | `claude-haiku-4-5-20251001` |
| `gpt-4-32k` | `claude-opus-4-6` |
| `o1` | `claude-opus-4-6` |

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

If you also have an OpenAI API key:

```
# .env
OPENAI_API_KEY=sk-xxxxxxxxxxxxxxxx
```

Now `gpt-*` model requests route directly to OpenAI. Claude model requests still go to Anthropic.

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
→ Add credits at [console.anthropic.com/settings/billing](https://console.anthropic.com/settings/billing).

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

MIT — free to use, modify, and share.
