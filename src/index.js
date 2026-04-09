import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { rateLimit } from 'express-rate-limit';
import fetch from 'node-fetch';
import {
  toAnthropicRequest,
  toOpenAIResponse,
  streamAnthropicToOpenAI,
  buildModelsResponse,
} from './openai-compat.js';

const app                = express();
const PORT               = process.env.PORT || 3030;
const ANTHROPIC_API_KEY  = process.env.ANTHROPIC_API_KEY;
const OPENAI_API_KEY     = process.env.OPENAI_API_KEY;
const PROXY_API_KEY      = process.env.PROXY_API_KEY;
const RATE_LIMIT_RPM     = parseInt(process.env.RATE_LIMIT_PER_MIN || '60', 10);
const CORS_ORIGIN        = process.env.CORS_ORIGIN || '*';

// ── Startup validation ────────────────────────────────────────────────────────

if (!ANTHROPIC_API_KEY) {
  console.error('[ERROR] ANTHROPIC_API_KEY is not set. Add it to your .env file.');
  process.exit(1);
}

// ── Middleware ────────────────────────────────────────────────────────────────

app.use(cors({
  origin: CORS_ORIGIN,
  allowedHeaders: ['Content-Type', 'Authorization', 'x-api-key', 'anthropic-version', 'anthropic-beta'],
}));

app.use(express.json({ limit: '10mb' }));

// Auth — skip for health check
app.use((req, res, next) => {
  if (req.path === '/health') return next();

  if (PROXY_API_KEY) {
    const authHeader = req.headers['authorization'] || '';
    const keyHeader  = req.headers['x-api-key'] || '';
    const provided   = authHeader.replace('Bearer ', '').trim() || keyHeader.trim();

    if (provided !== PROXY_API_KEY) {
      return res.status(401).json({ error: 'Unauthorized. Invalid or missing API key.' });
    }
  }

  next();
});

// Rate limiting
if (RATE_LIMIT_RPM > 0) {
  app.use(rateLimit({
    windowMs:       60 * 1000,
    limit:          RATE_LIMIT_RPM,
    standardHeaders: 'draft-8',
    legacyHeaders:  false,
    message:        { error: 'Too many requests. Try again in a minute.' },
    skip:           (req) => req.path === '/health',
  }));
}

// Request logger
app.use((req, res, next) => {
  if (req.path === '/health') return next();
  const ts    = new Date().toISOString();
  const start = Date.now();
  console.log(`[${ts}] ${req.method} ${req.path}`);
  res.on('finish', () => {
    const elapsed = Date.now() - start;
    if (elapsed > 100) console.log(`  done (${elapsed}ms)`);
  });
  next();
});

// ── Routes ────────────────────────────────────────────────────────────────────

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Models list — required by Cursor, Open WebUI, Continue.dev on startup
app.get('/v1/models', (req, res) => {
  res.json(buildModelsResponse());
});

// OpenAI-compatible chat completions — translates to Anthropic internally
app.post('/v1/chat/completions', async (req, res) => {
  const start  = Date.now();
  const body   = req.body;
  const isGpt  = typeof body.model === 'string' && body.model.startsWith('gpt-');

  // Route GPT models to OpenAI if key is present
  if (isGpt && OPENAI_API_KEY) {
    return proxyToOpenAI(req, res);
  }

  // Translate OpenAI request → Anthropic
  let anthropicBody;
  try {
    anthropicBody = toAnthropicRequest(body);
  } catch (err) {
    return res.status(400).json({ error: `Request translation failed: ${err.message}` });
  }

  let upstream;
  try {
    upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method:  'POST',
      headers: {
        'content-type':      'application/json',
        'anthropic-version': '2023-06-01',
        'x-api-key':         ANTHROPIC_API_KEY,
      },
      body: JSON.stringify(anthropicBody),
    });
  } catch (err) {
    console.error('[ERROR] Upstream request failed:', err.message);
    return res.status(502).json({ error: 'Bad gateway. Could not reach the upstream API.' });
  }

  if (!upstream.ok) {
    const errorBody = await upstream.text();
    console.log(`  [openai-compat] upstream error ${upstream.status}`);
    let parsed;
    try { parsed = JSON.parse(errorBody); } catch (_) { parsed = { error: errorBody }; }
    return res.status(upstream.status).json(parsed);
  }

  // Streaming response
  if (body.stream) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    await streamAnthropicToOpenAI(upstream, res, anthropicBody.model);
    const elapsed = Date.now() - start;
    console.log(`  [openai-compat] stream done (${elapsed}ms)`);
    return;
  }

  // Non-streaming response
  const data    = await upstream.json();
  const oaiResp = toOpenAIResponse(data);
  const elapsed = Date.now() - start;
  const u       = data.usage || {};
  console.log(`  [openai-compat] model=${anthropicBody.model} in=${u.input_tokens ?? 0} out=${u.output_tokens ?? 0} (${elapsed}ms)`);
  res.json(oaiResp);
});

// Proxy GPT models to OpenAI directly (no translation needed)
async function proxyToOpenAI(req, res) {
  let upstream;
  try {
    upstream = await fetch('https://api.openai.com/v1/chat/completions', {
      method:  'POST',
      headers: {
        'content-type':  'application/json',
        'authorization': `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify(req.body),
    });
  } catch (err) {
    return res.status(502).json({ error: 'Bad gateway. Could not reach OpenAI.' });
  }

  res.status(upstream.status);
  upstream.headers.forEach((value, key) => {
    if (!['content-encoding', 'transfer-encoding', 'connection'].includes(key)) {
      res.setHeader(key, value);
    }
  });
  upstream.body.pipe(res);
}

// Native Anthropic passthrough — for Claude Code and Anthropic SDK users
app.all('/v1/*', async (req, res) => {
  const targetUrl = `https://api.anthropic.com${req.path}`;

  const headers = {
    'content-type':      'application/json',
    'anthropic-version': req.headers['anthropic-version'] || '2023-06-01',
    'x-api-key':         ANTHROPIC_API_KEY,
  };

  if (req.headers['anthropic-beta']) {
    headers['anthropic-beta'] = req.headers['anthropic-beta'];
  }

  let upstream;
  try {
    upstream = await fetch(targetUrl, {
      method:  req.method,
      headers,
      body:    req.method !== 'GET' && req.method !== 'HEAD'
        ? JSON.stringify(req.body)
        : undefined,
    });
  } catch (err) {
    console.error('[ERROR] Upstream request failed:', err.message);
    return res.status(502).json({ error: 'Bad gateway. Could not reach the upstream API.' });
  }

  res.status(upstream.status);
  upstream.headers.forEach((value, key) => {
    if (!['content-encoding', 'transfer-encoding', 'connection'].includes(key)) {
      res.setHeader(key, value);
    }
  });
  upstream.body.pipe(res);
});

// Catch-all
app.use((req, res) => {
  res.status(404).json({ error: `Route ${req.path} not found.` });
});

// ── Start ─────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`\n  AI Proxy running on http://localhost:${PORT}`);
  console.log(`  Anthropic API:    enabled`);
  console.log(`  OpenAI API:       ${OPENAI_API_KEY ? 'enabled (gpt-* models will route to OpenAI)' : 'disabled (set OPENAI_API_KEY to enable)'}`);
  console.log(`  Auth:             ${PROXY_API_KEY ? 'enabled' : 'disabled (set PROXY_API_KEY to enable)'}`);
  console.log(`  Rate limit:       ${RATE_LIMIT_RPM > 0 ? `${RATE_LIMIT_RPM} req/min per IP` : 'disabled'}`);
  console.log(`  CORS:             ${CORS_ORIGIN}`);
  console.log(`  Health check:     http://localhost:${PORT}/health\n`);
});
