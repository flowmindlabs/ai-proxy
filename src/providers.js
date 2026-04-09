// Provider registry — routing, dispatch, and fallback logic
import fetch from 'node-fetch';
import { toAnthropicRequest, toOpenAIResponse, streamAnthropicToOpenAI } from './openai-compat.js';
import { toGeminiRequest, toOpenAIResponseFromGemini, streamGeminiToOpenAI, buildGeminiUrl } from './gemini-compat.js';
import { logRequest } from './usage-log.js';

// ── Config ────────────────────────────────────────────────────────────────────

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const OPENAI_API_KEY    = process.env.OPENAI_API_KEY;
const GEMINI_API_KEY    = process.env.GEMINI_API_KEY;
const OLLAMA_BASE_URL   = process.env.OLLAMA_BASE_URL;
const OLLAMA_MODELS     = (process.env.OLLAMA_MODELS || '')
  .split(',').map(s => s.trim()).filter(Boolean);
const FALLBACK_ORDER    = (process.env.FALLBACK_ORDER || '')
  .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

// Clamp timeout: min 5s, max 5 minutes
const REQUEST_TIMEOUT = Math.max(5000, Math.min(300000,
  parseInt(process.env.REQUEST_TIMEOUT_MS || '120000', 10)
));

const RETRYABLE_CODES = new Set([429, 500, 502, 503, 529]);

// ── SSRF protection — validate OLLAMA_BASE_URL ────────────────────────────────
// Prevents targeting internal services, cloud metadata endpoints, or file:// URLs

const BLOCKED_HOSTNAMES = new Set([
  '169.254.169.254',  // AWS/GCP/Azure metadata
  'metadata.google.internal',
]);

function validateOllamaUrl(urlStr) {
  if (!urlStr) return null;
  let parsed;
  try {
    parsed = new URL(urlStr);
  } catch {
    console.error('[ERROR] OLLAMA_BASE_URL is not a valid URL:', urlStr);
    return null;
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    console.error('[ERROR] OLLAMA_BASE_URL must use http:// or https://, got:', parsed.protocol);
    return null;
  }
  if (BLOCKED_HOSTNAMES.has(parsed.hostname)) {
    console.error('[ERROR] OLLAMA_BASE_URL hostname is blocked:', parsed.hostname);
    return null;
  }
  return urlStr.replace(/\/$/, ''); // strip trailing slash
}

const SAFE_OLLAMA_URL = validateOllamaUrl(OLLAMA_BASE_URL);

// ── Fetch with timeout ────────────────────────────────────────────────────────

function makeFetchWithTimeout(url, options) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);
  return fetch(url, { ...options, signal: controller.signal })
    .finally(() => clearTimeout(timer));
}

// ── Model → Provider resolution ───────────────────────────────────────────────

function isOllamaModel(model) {
  if (!SAFE_OLLAMA_URL) return false;
  if (OLLAMA_MODELS.length > 0) return OLLAMA_MODELS.includes(model);
  // catch-all: anything not matching known prefixes
  return !model.startsWith('claude-') && !model.startsWith('gpt-') && !model.startsWith('gemini-');
}

export function resolveProvider(model) {
  if (!model) return 'anthropic';
  if (model.startsWith('gemini-')) return 'gemini';
  if (model.startsWith('gpt-'))    return 'openai';
  if (isOllamaModel(model))        return 'ollama';
  return 'anthropic';
}

export function isProviderEnabled(name) {
  switch (name) {
    case 'anthropic': return Boolean(ANTHROPIC_API_KEY);
    case 'openai':    return Boolean(OPENAI_API_KEY);
    case 'gemini':    return Boolean(GEMINI_API_KEY);
    case 'ollama':    return Boolean(SAFE_OLLAMA_URL);
    default:          return false;
  }
}

export function getEnabledProviders() {
  return ['anthropic', 'openai', 'gemini', 'ollama'].filter(isProviderEnabled);
}

export function getOllamaModels() {
  return OLLAMA_MODELS;
}

// ── Provider call functions ───────────────────────────────────────────────────

async function callAnthropic(body, req, res, onComplete) {
  let anthropicBody;
  try {
    anthropicBody = toAnthropicRequest(body);
  } catch (err) {
    return { status: 400, error: `Invalid request: ${err.message}` };
  }

  let upstream;
  try {
    upstream = await makeFetchWithTimeout('https://api.anthropic.com/v1/messages', {
      method:  'POST',
      headers: {
        'content-type':      'application/json',
        'anthropic-version': '2023-06-01',
        'x-api-key':         ANTHROPIC_API_KEY,
      },
      body: JSON.stringify(anthropicBody),
    });
  } catch (err) {
    const isTimeout = err.name === 'AbortError';
    return { status: isTimeout ? 504 : 502, error: isTimeout ? 'Request timed out.' : 'Could not reach Anthropic.' };
  }

  if (!upstream.ok) {
    const text = await upstream.text();
    let parsed;
    try { parsed = JSON.parse(text); } catch { parsed = { error: 'Upstream error.' }; }
    return { status: upstream.status, body: parsed, retryable: RETRYABLE_CODES.has(upstream.status) };
  }

  if (body.stream) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    try {
      await streamAnthropicToOpenAI(upstream, res, anthropicBody.model, onComplete);
    } catch (err) {
      console.error('[ERROR] Anthropic stream error:', err.message);
      if (!res.writableEnded) {
        res.write(`data: ${JSON.stringify({ error: 'Stream interrupted.' })}\n\n`);
        res.end();
      }
    }
    return { status: 200, streaming: true };
  }

  const data    = await upstream.json();
  const oaiResp = toOpenAIResponse(data);
  const u       = data.usage || {};
  if (onComplete) onComplete({ tokensIn: u.input_tokens ?? 0, tokensOut: u.output_tokens ?? 0 });
  return { status: 200, body: oaiResp };
}

async function callOpenAI(body, req, res, onComplete) {
  let upstream;
  try {
    upstream = await makeFetchWithTimeout('https://api.openai.com/v1/chat/completions', {
      method:  'POST',
      headers: {
        'content-type':  'application/json',
        'authorization': `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    const isTimeout = err.name === 'AbortError';
    return { status: isTimeout ? 504 : 502, error: isTimeout ? 'Request timed out.' : 'Could not reach OpenAI.' };
  }

  if (!upstream.ok) {
    const text = await upstream.text();
    let parsed;
    try { parsed = JSON.parse(text); } catch { parsed = { error: 'Upstream error.' }; }
    return { status: upstream.status, body: parsed, retryable: RETRYABLE_CODES.has(upstream.status) };
  }

  // OpenAI streaming — pipe directly, no translation needed
  if (body.stream) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    upstream.body.on('error', (err) => {
      console.error('[ERROR] OpenAI stream error:', err.message);
      if (!res.writableEnded) res.end();
    });
    upstream.body.pipe(res);
    return { status: 200, streaming: true };
  }

  const data = await upstream.json();
  const u    = data.usage || {};
  if (onComplete) onComplete({ tokensIn: u.prompt_tokens ?? 0, tokensOut: u.completion_tokens ?? 0 });
  return { status: 200, body: data };
}

async function callGemini(body, req, res, onComplete) {
  const model = body.model;
  let geminiBody;
  try {
    geminiBody = toGeminiRequest(body);
  } catch (err) {
    return { status: 400, error: `Invalid request: ${err.message}` };
  }

  const url = buildGeminiUrl(model, Boolean(body.stream));

  let upstream;
  try {
    upstream = await makeFetchWithTimeout(url, {
      method:  'POST',
      headers: {
        'content-type':  'application/json',
        'authorization': `Bearer ${GEMINI_API_KEY}`,
      },
      body:    JSON.stringify(geminiBody),
    });
  } catch (err) {
    const isTimeout = err.name === 'AbortError';
    return { status: isTimeout ? 504 : 502, error: isTimeout ? 'Request timed out.' : 'Could not reach Gemini.' };
  }

  if (!upstream.ok) {
    const text = await upstream.text();
    let parsed;
    try { parsed = JSON.parse(text); } catch { parsed = { error: 'Upstream error.' }; }
    return { status: upstream.status, body: parsed, retryable: RETRYABLE_CODES.has(upstream.status) };
  }

  if (body.stream) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    try {
      await streamGeminiToOpenAI(upstream, res, model, onComplete);
    } catch (err) {
      console.error('[ERROR] Gemini stream error:', err.message);
      if (!res.writableEnded) {
        res.write(`data: ${JSON.stringify({ error: 'Stream interrupted.' })}\n\n`);
        res.end();
      }
    }
    return { status: 200, streaming: true };
  }

  const data    = await upstream.json();
  const oaiResp = toOpenAIResponseFromGemini(data, model);
  const u       = data.usageMetadata || {};
  if (onComplete) onComplete({ tokensIn: u.promptTokenCount ?? 0, tokensOut: u.candidatesTokenCount ?? 0 });
  return { status: 200, body: oaiResp };
}

async function callOllama(body, req, res, onComplete) {
  const url = `${SAFE_OLLAMA_URL}/v1/chat/completions`;
  let upstream;
  try {
    upstream = await makeFetchWithTimeout(url, {
      method:  'POST',
      headers: { 'content-type': 'application/json' },
      body:    JSON.stringify(body),
    });
  } catch (err) {
    const isTimeout = err.name === 'AbortError';
    return { status: isTimeout ? 504 : 502, error: isTimeout ? 'Request timed out.' : 'Could not reach Ollama. Is it running?' };
  }

  if (!upstream.ok) {
    const text = await upstream.text();
    let parsed;
    try { parsed = JSON.parse(text); } catch { parsed = { error: 'Upstream error.' }; }
    return { status: upstream.status, body: parsed, retryable: RETRYABLE_CODES.has(upstream.status) };
  }

  if (body.stream) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    upstream.body.on('error', (err) => {
      console.error('[ERROR] Ollama stream error:', err.message);
      if (!res.writableEnded) res.end();
    });
    upstream.body.pipe(res);
    return { status: 200, streaming: true };
  }

  const data = await upstream.json();
  const u    = data.usage || {};
  if (onComplete) onComplete({ tokensIn: u.prompt_tokens ?? 0, tokensOut: u.completion_tokens ?? 0 });
  return { status: 200, body: data };
}

const PROVIDER_CALLS = { anthropic: callAnthropic, openai: callOpenAI, gemini: callGemini, ollama: callOllama };

// ── Fallback logic ────────────────────────────────────────────────────────────

function getFallbackProvider(primaryName) {
  if (!FALLBACK_ORDER.length) return null;
  const primaryIdx = FALLBACK_ORDER.indexOf(primaryName);
  if (primaryIdx === -1) return null;
  for (let i = primaryIdx + 1; i < FALLBACK_ORDER.length; i++) {
    const candidate = FALLBACK_ORDER[i];
    if (isProviderEnabled(candidate)) return candidate;
  }
  return null;
}

// ── Main dispatch ─────────────────────────────────────────────────────────────

export async function executeWithFallback(body, req, res) {
  const model    = body.model || 'claude-sonnet-4-6';
  const start    = Date.now();
  const provider = resolveProvider(model);

  if (!isProviderEnabled(provider)) {
    const keyMap = { anthropic: 'ANTHROPIC_API_KEY', openai: 'OPENAI_API_KEY', gemini: 'GEMINI_API_KEY', ollama: 'OLLAMA_BASE_URL' };
    return res.status(400).json({
      error: `Provider "${provider}" is not configured. Add ${keyMap[provider]} to your .env file.`,
    });
  }

  let usedProvider = provider;
  let fallbackUsed = false;
  let fallbackFrom = null;
  let tokensIn     = 0;
  let tokensOut    = 0;

  const onComplete = ({ tokensIn: tin, tokensOut: tout }) => {
    tokensIn  = tin;
    tokensOut = tout;
  };

  // Call primary provider
  let result = await PROVIDER_CALLS[provider](body, req, res, onComplete);

  // Fallback if retryable error
  if (result.retryable || (result.status >= 500 && !result.streaming)) {
    const fallback = getFallbackProvider(provider);
    if (fallback) {
      console.log(`  [FALLBACK] primary=${provider} status=${result.status} → trying ${fallback}`);
      result      = await PROVIDER_CALLS[fallback](body, req, res, onComplete);
      usedProvider = fallback;
      fallbackUsed = true;
      fallbackFrom = provider;
      if (result.status < 400) {
        console.log(`  [FALLBACK] ${fallback} succeeded`);
      } else {
        console.log(`  [FALLBACK] ${fallback} also failed status=${result.status}, giving up`);
      }
    }
  }

  const latencyMs = Date.now() - start;

  // Send response (for non-streaming)
  if (!result.streaming) {
    if (result.error && !result.body) {
      res.setHeader('X-Proxy-Provider', usedProvider);
      return res.status(result.status).json({ error: result.error });
    }

    res.setHeader('X-Proxy-Provider', usedProvider);
    if (fallbackUsed) {
      res.setHeader('X-Proxy-Fallback', 'true');
      res.setHeader('X-Proxy-Fallback-From', fallbackFrom);
    }

    const status = result.status || 200;
    res.status(status).json(result.body);

    // Log after response is sent
    logRequest({
      model, provider: usedProvider, fallback: fallbackUsed, fallbackFrom,
      tokensIn, tokensOut, latencyMs, status, stream: false,
      error: status >= 400 ? JSON.stringify(result.body) : null,
    });

    if (status < 400) {
      console.log(`  [${usedProvider}] model=${model} in=${tokensIn} out=${tokensOut} (${latencyMs}ms)${fallbackUsed ? ' [fallback]' : ''}`);
    }
  } else {
    // Streaming — headers already set by provider call
    res.setHeader('X-Proxy-Provider', usedProvider);
    if (fallbackUsed) {
      res.setHeader('X-Proxy-Fallback', 'true');
      res.setHeader('X-Proxy-Fallback-From', fallbackFrom);
    }

    // Log after stream completes (onComplete fires at stream end)
    // We use a small delay to let onComplete fire before logging
    setTimeout(() => {
      logRequest({
        model, provider: usedProvider, fallback: fallbackUsed, fallbackFrom,
        tokensIn, tokensOut, latencyMs: Date.now() - start, status: 200, stream: true, error: null,
      });
    }, 100);
  }
}
