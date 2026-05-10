// Provider registry — routing, dispatch, and fallback logic
import fetch from 'node-fetch';
import { toAnthropicRequest, toOpenAIResponse, streamAnthropicToOpenAI } from './openai-compat.js';
import { toGeminiRequest, toOpenAIResponseFromGemini, streamGeminiToOpenAI, buildGeminiUrl } from './gemini-compat.js';
import { logRequest, getDailySpend } from './usage-log.js';
import { applySmartRouting, TIER3_MODEL } from './router.js';
import { getCached, setCached, getCacheStats } from './cache.js';
import { getSemanticCached, setSemanticCached } from './semantic-cache.js';

// ── Config ────────────────────────────────────────────────────────────────────

const ANTHROPIC_API_KEY    = process.env.ANTHROPIC_API_KEY;
const OPENAI_API_KEY       = process.env.OPENAI_API_KEY;
const GEMINI_API_KEY       = process.env.GEMINI_API_KEY;
const OLLAMA_BASE_URL      = process.env.OLLAMA_BASE_URL;
const OPENROUTER_API_KEY   = process.env.OPENROUTER_API_KEY;
const OPENROUTER_SITE_URL  = process.env.OPENROUTER_SITE_URL  || 'http://localhost:3030';
const OPENROUTER_SITE_NAME = process.env.OPENROUTER_SITE_NAME || 'AI Proxy';
const OLLAMA_MODELS        = (process.env.OLLAMA_MODELS || '')
  .split(',').map(s => s.trim()).filter(Boolean);
const FALLBACK_ORDER       = (process.env.FALLBACK_ORDER || '')
  .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

// Daily budget caps — 0 means disabled
const DAILY_BUDGETS = {
  anthropic:   parseFloat(process.env.ANTHROPIC_DAILY_BUDGET_USD   || '0'),
  openai:      parseFloat(process.env.OPENAI_DAILY_BUDGET_USD      || '0'),
  gemini:      parseFloat(process.env.GEMINI_DAILY_BUDGET_USD      || '0'),
  openrouter:  parseFloat(process.env.OPENROUTER_DAILY_BUDGET_USD  || '0'),
};

// Model aliases — ALIAS_<from>=<to> env vars parsed at startup
const ALIASES = {};
for (const [key, val] of Object.entries(process.env)) {
  if (key.startsWith('ALIAS_')) {
    ALIASES[key.slice(6)] = val.trim();
  }
}
if (Object.keys(ALIASES).length) {
  console.log('[INFO] Model aliases:', ALIASES);
}

// Clamp timeout: min 5s, max 5 minutes
const REQUEST_TIMEOUT = Math.max(5000, Math.min(300000,
  parseInt(process.env.REQUEST_TIMEOUT_MS || '120000', 10)
));

const RETRYABLE_CODES = new Set([429, 500, 502, 503, 529]);

// ── SSRF protection — validate OLLAMA_BASE_URL ────────────────────────────────

const BLOCKED_HOSTNAMES = new Set([
  '169.254.169.254',
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
  return urlStr.replace(/\/$/, '');
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
  return !model.startsWith('claude-') && !model.startsWith('gpt-') &&
         !model.startsWith('gemini-') && !model.startsWith('openrouter/');
}

export function resolveProvider(model) {
  if (!model) return 'anthropic';
  if (model.startsWith('openrouter/'))  return 'openrouter';
  if (model.startsWith('gemini-'))      return 'gemini';
  if (model.startsWith('gpt-'))         return 'openai';
  if (model.startsWith('o1') || model.startsWith('o3')) return 'openai';
  if (isOllamaModel(model))             return 'ollama';
  // Unknown model + OpenRouter key = route to OpenRouter (catch-all for 200+ models)
  if (OPENROUTER_API_KEY && !model.startsWith('claude-')) return 'openrouter';
  return 'anthropic';
}

export function isProviderEnabled(name) {
  switch (name) {
    case 'anthropic':  return Boolean(ANTHROPIC_API_KEY);
    case 'openai':     return Boolean(OPENAI_API_KEY);
    case 'gemini':     return Boolean(GEMINI_API_KEY);
    case 'ollama':     return Boolean(SAFE_OLLAMA_URL);
    case 'openrouter': return Boolean(OPENROUTER_API_KEY);
    default:           return false;
  }
}

export function getEnabledProviders() {
  return ['anthropic', 'openai', 'gemini', 'ollama', 'openrouter'].filter(isProviderEnabled);
}

export function getOllamaModels() {
  return OLLAMA_MODELS;
}

export { getCacheStats };

// ── Budget cap check ──────────────────────────────────────────────────────────

function checkBudget(provider) {
  const budget = DAILY_BUDGETS[provider] || 0;
  if (budget <= 0) return null;
  const spent = getDailySpend(provider);
  if (spent >= budget) {
    return {
      status: 429,
      body: {
        error: `Daily budget exceeded for "${provider}". ` +
               `Spent $${spent.toFixed(4)} of $${budget.toFixed(2)} limit. Resets at midnight.`,
      },
    };
  }
  return null;
}

// ── Output validation helpers ─────────────────────────────────────────────────

function requiresJsonOutput(body) {
  if (body.response_format?.type === 'json_object') return true;
  const systemMsg = (body.messages || []).find(m => m.role === 'system');
  if (!systemMsg) return false;
  const text = (typeof systemMsg.content === 'string' ? systemMsg.content : '').toLowerCase();
  return text.includes('respond in json') || text.includes('output json') ||
         text.includes('return json')     || text.includes('json format');
}

function isValidJson(text) {
  if (!text || typeof text !== 'string') return false;
  try { JSON.parse(text); return true; } catch { return false; }
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
      body: JSON.stringify(geminiBody),
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

async function callOpenRouter(body, req, res, onComplete) {
  let upstream;
  try {
    upstream = await makeFetchWithTimeout('https://openrouter.ai/api/v1/chat/completions', {
      method:  'POST',
      headers: {
        'content-type':  'application/json',
        'authorization': `Bearer ${OPENROUTER_API_KEY}`,
        'HTTP-Referer':  OPENROUTER_SITE_URL,
        'X-Title':       OPENROUTER_SITE_NAME,
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    const isTimeout = err.name === 'AbortError';
    return { status: isTimeout ? 504 : 502, error: isTimeout ? 'Request timed out.' : 'Could not reach OpenRouter.' };
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
      console.error('[ERROR] OpenRouter stream error:', err.message);
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

const PROVIDER_CALLS = {
  anthropic:  callAnthropic,
  openai:     callOpenAI,
  gemini:     callGemini,
  ollama:     callOllama,
  openrouter: callOpenRouter,
};

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
  const start = Date.now();

  // 1. Alias rewrite
  const rawModel = body.model || 'claude-sonnet-4-6';
  if (ALIASES[rawModel]) {
    console.log(`  [ALIAS] ${rawModel} → ${ALIASES[rawModel]}`);
    body = { ...body, model: ALIASES[rawModel] };
  }

  // 2. Smart routing — may override body.model
  body = applySmartRouting(body);

  const model    = body.model;
  const provider = resolveProvider(model);

  if (!isProviderEnabled(provider)) {
    const keyMap = {
      anthropic:  'ANTHROPIC_API_KEY',
      openai:     'OPENAI_API_KEY',
      gemini:     'GEMINI_API_KEY',
      ollama:     'OLLAMA_BASE_URL',
      openrouter: 'OPENROUTER_API_KEY',
    };
    return res.status(400).json({
      error: `Provider "${provider}" is not configured. Add ${keyMap[provider] || provider} to your .env file.`,
    });
  }

  // 3. Budget cap check
  const budgetError = checkBudget(provider);
  if (budgetError) {
    logRequest({ model, provider, tokensIn: 0, tokensOut: 0,
                 latencyMs: 0, status: 429, stream: false, error: 'budget_exceeded' });
    return res.status(429).json(budgetError.body);
  }

  // 4. Semantic cache check (non-streaming only, before exact cache)
  if (!body.stream) {
    const semCached = await getSemanticCached(body);
    if (semCached) {
      res.setHeader('X-Cache', 'SEMANTIC-HIT');
      res.setHeader('X-Proxy-Provider', 'semantic-cache');
      res.status(200).json(semCached);
      logRequest({
        model, provider: 'semantic-cache', tokensIn: 0, tokensOut: 0,
        latencyMs: Date.now() - start, status: 200, stream: false,
        error: null, estimatedCostUsd: 0,
      });
      return;
    }
  }

  // 5. Exact cache check (non-streaming only)
  if (!body.stream) {
    const cached = getCached(body);
    if (cached) {
      res.setHeader('X-Cache', 'HIT');
      res.setHeader('X-Proxy-Provider', 'cache');
      res.status(200).json(cached);
      logRequest({
        model, provider: 'cache', tokensIn: 0, tokensOut: 0,
        latencyMs: Date.now() - start, status: 200, stream: false,
        error: null, estimatedCostUsd: 0,
      });
      return;
    }
  }

  let usedProvider = provider;
  let fallbackUsed = false;
  let fallbackFrom = null;
  let tokensIn     = 0;
  let tokensOut    = 0;
  let escalated    = false;

  const onComplete = ({ tokensIn: tin, tokensOut: tout }) => {
    tokensIn  = tin;
    tokensOut = tout;
  };

  // 5. Call primary provider
  let result = await PROVIDER_CALLS[provider](body, req, res, onComplete);

  // 6. Fallback if retryable error
  if (result.retryable || (result.status >= 500 && !result.streaming)) {
    const fallback = getFallbackProvider(provider);
    if (fallback) {
      const fallbackBudgetError = checkBudget(fallback);
      if (fallbackBudgetError) {
        console.log(`  [FALLBACK] ${fallback} budget exceeded, skipping`);
      } else {
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
  }

  // 7. Output validation — escalate to Tier 3 if JSON required but invalid
  if (
    !result.streaming &&
    result.status < 400 &&
    !body.stream &&
    requiresJsonOutput(body)
  ) {
    const responseText = result.body?.choices?.[0]?.message?.content;
    const tier3Model   = TIER3_MODEL;
    const isTier3      = model === tier3Model || usedProvider === resolveProvider(tier3Model);

    if (responseText && !isValidJson(responseText) && !isTier3) {
      console.log(`  [VALIDATE] Invalid JSON from ${usedProvider}, escalating to ${tier3Model}`);
      const escalatedBody     = { ...body, model: tier3Model };
      const escalatedProvider = resolveProvider(tier3Model);
      if (isProviderEnabled(escalatedProvider) && !checkBudget(escalatedProvider)) {
        const escalatedResult = await PROVIDER_CALLS[escalatedProvider](
          escalatedBody, req, res, onComplete
        );
        if (escalatedResult.status < 400) {
          result      = escalatedResult;
          usedProvider = escalatedProvider;
          escalated    = true;
        }
      }
    }
  }

  const latencyMs = Date.now() - start;

  // 8. Send response (non-streaming)
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
    if (escalated) res.setHeader('X-Proxy-Escalated', 'true');

    const status = result.status || 200;
    res.status(status).json(result.body);

    // Store to exact + semantic cache on success
    if (status < 400) {
      setCached(body, result.body);
      setSemanticCached(body, result.body).catch(() => {});
    }

    logRequest({
      model, provider: usedProvider, fallback: fallbackUsed, fallbackFrom,
      tokensIn, tokensOut, latencyMs, status, stream: false,
      error: status >= 400 ? JSON.stringify(result.body) : null,
      escalated,
    });

    if (status < 400) {
      console.log(`  [${usedProvider}] model=${model} in=${tokensIn} out=${tokensOut} (${latencyMs}ms)${fallbackUsed ? ' [fallback]' : ''}${escalated ? ' [escalated]' : ''}`);
    }
  } else {
    // Streaming — headers already set by provider call
    res.setHeader('X-Proxy-Provider', usedProvider);
    if (fallbackUsed) {
      res.setHeader('X-Proxy-Fallback', 'true');
      res.setHeader('X-Proxy-Fallback-From', fallbackFrom);
    }

    setTimeout(() => {
      logRequest({
        model, provider: usedProvider, fallback: fallbackUsed, fallbackFrom,
        tokensIn, tokensOut, latencyMs: Date.now() - start, status: 200, stream: true, error: null,
      });
    }, 100);
  }
}
