import 'dotenv/config';
import express from 'express';
import fetch from 'node-fetch';

const app = express();
const PORT = process.env.PORT || 3030;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const PROXY_API_KEY = process.env.PROXY_API_KEY;

// ── Startup validation ────────────────────────────────────────────────────────

if (!ANTHROPIC_API_KEY) {
  console.error('[ERROR] ANTHROPIC_API_KEY is not set. Add it to your .env file.');
  process.exit(1);
}

// ── Middleware ────────────────────────────────────────────────────────────────

app.use(express.json({ limit: '10mb' }));

// Auth middleware — optional but recommended
app.use((req, res, next) => {
  // Skip auth for health check
  if (req.path === '/health') return next();

  if (PROXY_API_KEY) {
    const authHeader = req.headers['authorization'] || '';
    const keyHeader = req.headers['x-api-key'] || '';
    const provided = authHeader.replace('Bearer ', '').trim() || keyHeader.trim();

    if (provided !== PROXY_API_KEY) {
      return res.status(401).json({ error: 'Unauthorized. Invalid or missing API key.' });
    }
  }

  next();
});

// Request logger
app.use((req, res, next) => {
  if (req.path === '/health') return next();
  const ts = new Date().toISOString();
  console.log(`[${ts}] ${req.method} ${req.path}`);
  next();
});

// ── Routes ────────────────────────────────────────────────────────────────────

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Proxy all /v1/* requests to Anthropic
app.all('/v1/*', async (req, res) => {
  const targetUrl = `https://api.anthropic.com${req.path}`;

  const headers = {
    'content-type': 'application/json',
    'anthropic-version': req.headers['anthropic-version'] || '2023-06-01',
    'x-api-key': ANTHROPIC_API_KEY,
  };

  // Forward any anthropic-beta header if present
  if (req.headers['anthropic-beta']) {
    headers['anthropic-beta'] = req.headers['anthropic-beta'];
  }

  try {
    const upstream = await fetch(targetUrl, {
      method: req.method,
      headers,
      body: req.method !== 'GET' && req.method !== 'HEAD'
        ? JSON.stringify(req.body)
        : undefined,
    });

    // Stream the response back
    res.status(upstream.status);
    upstream.headers.forEach((value, key) => {
      // Skip headers that cause issues when proxied
      if (!['content-encoding', 'transfer-encoding', 'connection'].includes(key)) {
        res.setHeader(key, value);
      }
    });

    upstream.body.pipe(res);
  } catch (err) {
    console.error('[ERROR] Upstream request failed:', err.message);
    res.status(502).json({ error: 'Bad gateway. Could not reach the upstream API.' });
  }
});

// Catch-all for unknown routes
app.use((req, res) => {
  res.status(404).json({ error: `Route ${req.path} not found.` });
});

// ── Start ─────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`✓ Proxy running on http://localhost:${PORT}`);
  console.log(`✓ Auth: ${PROXY_API_KEY ? 'enabled' : 'disabled (set PROXY_API_KEY to enable)'}`);
  console.log(`  Health check: http://localhost:${PORT}/health`);
});
