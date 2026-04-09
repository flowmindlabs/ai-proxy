import 'dotenv/config';
import crypto from 'crypto';
import express from 'express';
import cors from 'cors';
import { rateLimit } from 'express-rate-limit';
import { executeWithFallback, getEnabledProviders, getOllamaModels, isProviderEnabled } from './providers.js';
import { buildModelsResponse } from './openai-compat.js';
import { registerDashboardRoutes } from './dashboard.js';
import fetch from 'node-fetch';

const app               = express();
const PORT              = process.env.PORT || 3030;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const OPENAI_API_KEY    = process.env.OPENAI_API_KEY;
const GEMINI_API_KEY    = process.env.GEMINI_API_KEY;
const OLLAMA_BASE_URL   = process.env.OLLAMA_BASE_URL;
const PROXY_API_KEY     = process.env.PROXY_API_KEY;
const RATE_LIMIT_RPM    = parseInt(process.env.RATE_LIMIT_PER_MIN || '60', 10);
const CORS_ORIGIN       = process.env.CORS_ORIGIN || '*';
const REQUEST_TIMEOUT   = parseInt(process.env.REQUEST_TIMEOUT_MS || '120000', 10);
const FALLBACK_ORDER    = process.env.FALLBACK_ORDER || '';

// ── Startup validation ────────────────────────────────────────────────────────

if (!ANTHROPIC_API_KEY && !OPENAI_API_KEY && !GEMINI_API_KEY && !OLLAMA_BASE_URL) {
  console.error('[ERROR] No provider configured. Set at least one API key in your .env file.');
  console.error('  ANTHROPIC_API_KEY — for Claude models (platform.claude.com)');
  console.error('  OPENAI_API_KEY    — for GPT models (platform.openai.com)');
  console.error('  GEMINI_API_KEY    — for Gemini models (aistudio.google.com)');
  console.error('  OLLAMA_BASE_URL   — for free local models (ollama.com)');
  process.exit(1);
}

if (ANTHROPIC_API_KEY && !ANTHROPIC_API_KEY.startsWith('sk-ant-')) {
  console.warn('[WARN] ANTHROPIC_API_KEY does not look valid (expected sk-ant-...)');
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function timingSafeEqual(a, b) {
  try {
    const bufA = Buffer.from(a);
    const bufB = Buffer.from(b);
    if (bufA.length !== bufB.length) {
      crypto.timingSafeEqual(bufA, Buffer.alloc(bufA.length));
      return false;
    }
    return crypto.timingSafeEqual(bufA, bufB);
  } catch {
    return false;
  }
}

// ── Middleware ────────────────────────────────────────────────────────────────

app.use(cors({
  origin: CORS_ORIGIN,
  allowedHeaders: ['Content-Type', 'Authorization', 'x-api-key', 'anthropic-version', 'anthropic-beta'],
}));

app.use(express.json({ limit: '10mb' }));

// Auth — skip for health check and dashboard
const PUBLIC_PATHS = ['/health', '/dashboard'];
app.use((req, res, next) => {
  if (PUBLIC_PATHS.some(p => req.path.startsWith(p))) return next();

  if (PROXY_API_KEY) {
    const authHeader = req.headers['authorization'] || '';
    const keyHeader  = req.headers['x-api-key'] || '';
    const provided   = authHeader.replace('Bearer ', '').trim() || keyHeader.trim();

    if (!provided || !timingSafeEqual(provided, PROXY_API_KEY)) {
      return res.status(401).json({ error: 'Unauthorized.' });
    }
  }

  next();
});

// Rate limiting
if (RATE_LIMIT_RPM > 0) {
  app.use(rateLimit({
    windowMs:        60 * 1000,
    limit:           RATE_LIMIT_RPM,
    standardHeaders: 'draft-8',
    legacyHeaders:   false,
    message:         { error: 'Too many requests. Try again in a minute.' },
    skip:            (req) => PUBLIC_PATHS.some(p => req.path.startsWith(p)),
  }));
}

// Request logger
app.use((req, res, next) => {
  if (PUBLIC_PATHS.some(p => req.path.startsWith(p))) return next();
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

// Models list — includes all enabled providers
app.get('/v1/models', (req, res) => {
  const extraModels = [];

  if (GEMINI_API_KEY) {
    ['gemini-2.5-pro', 'gemini-2.0-flash', 'gemini-1.5-pro', 'gemini-1.5-flash'].forEach(id => {
      extraModels.push({ id, object: 'model', created: 1700000000, owned_by: 'google' });
    });
  }

  const ollamaModels = getOllamaModels();
  if (OLLAMA_BASE_URL && ollamaModels.length) {
    ollamaModels.forEach(id => {
      extraModels.push({ id, object: 'model', created: 1700000000, owned_by: 'ollama' });
    });
  }

  res.json(buildModelsResponse(extraModels));
});

// Dashboard
registerDashboardRoutes(app);

// OpenAI-compatible chat completions — routes to correct provider
app.post('/v1/chat/completions', async (req, res) => {
  if (!req.body || typeof req.body !== 'object') {
    return res.status(400).json({ error: 'Request body must be a JSON object.' });
  }
  await executeWithFallback(req.body, req, res);
});

// Native Anthropic passthrough — for Claude Code and Anthropic SDK users
app.all('/v1/*', async (req, res) => {
  if (!ANTHROPIC_API_KEY) {
    return res.status(400).json({ error: 'ANTHROPIC_API_KEY is not configured.' });
  }

  const targetUrl = `https://api.anthropic.com${req.originalUrl}`;
  const headers = {
    'content-type':      'application/json',
    'anthropic-version': req.headers['anthropic-version'] || '2023-06-01',
    'x-api-key':         ANTHROPIC_API_KEY,
  };

  if (req.headers['anthropic-beta']) {
    headers['anthropic-beta'] = req.headers['anthropic-beta'];
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

  let upstream;
  try {
    upstream = await fetch(targetUrl, {
      method:  req.method,
      headers,
      body:    req.method !== 'GET' && req.method !== 'HEAD'
        ? JSON.stringify(req.body)
        : undefined,
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    const isTimeout = err.name === 'AbortError';
    return res.status(isTimeout ? 504 : 502).json({
      error: isTimeout ? 'Request timed out.' : 'Could not reach the upstream API.',
    });
  }

  clearTimeout(timer);
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

const enabled = getEnabledProviders();
const ollamaModels = getOllamaModels();

app.listen(PORT, () => {
  console.log(`\n  AI Proxy v3.0 — http://localhost:${PORT}`);
  console.log(`  ─────────────────────────────────────`);
  console.log(`  Anthropic:  ${ANTHROPIC_API_KEY ? 'enabled (claude-* models)' : 'disabled'}`);
  console.log(`  OpenAI:     ${OPENAI_API_KEY    ? 'enabled (gpt-* models)'    : 'disabled'}`);
  console.log(`  Gemini:     ${GEMINI_API_KEY    ? 'enabled (gemini-* models)' : 'disabled'}`);
  console.log(`  Ollama:     ${OLLAMA_BASE_URL   ? `enabled (${ollamaModels.join(', ') || 'catch-all'})` : 'disabled'}`);
  console.log(`  Fallback:   ${FALLBACK_ORDER    ? FALLBACK_ORDER              : 'disabled'}`);
  console.log(`  ─────────────────────────────────────`);
  console.log(`  Auth:       ${PROXY_API_KEY     ? 'enabled'                   : 'disabled'}`);
  console.log(`  Rate limit: ${RATE_LIMIT_RPM > 0 ? `${RATE_LIMIT_RPM} req/min` : 'disabled'}`);
  console.log(`  CORS:       ${CORS_ORIGIN}`);
  console.log(`  Timeout:    ${REQUEST_TIMEOUT / 1000}s`);
  console.log(`  ─────────────────────────────────────`);
  console.log(`  Dashboard:  http://localhost:${PORT}/dashboard`);
  console.log(`  Health:     http://localhost:${PORT}/health\n`);
});
