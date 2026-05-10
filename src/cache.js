// Exact prompt cache — LRU Map, no external deps.
// Key = SHA-256(model + messages JSON). Never caches streaming responses.

import crypto from 'crypto';

const CACHE_ENABLED  = process.env.CACHE_ENABLED !== 'false';
const CACHE_MAX_SIZE = parseInt(process.env.CACHE_MAX_SIZE || '500', 10);

const lruCache = new Map();  // key → { response, timestamp, model }

function lruGet(key) {
  if (!lruCache.has(key)) return null;
  const entry = lruCache.get(key);
  // Move to end (most recently used)
  lruCache.delete(key);
  lruCache.set(key, entry);
  return entry;
}

function lruSet(key, value) {
  if (lruCache.has(key)) lruCache.delete(key);
  lruCache.set(key, value);
  if (lruCache.size > CACHE_MAX_SIZE) {
    // Evict oldest (first inserted)
    lruCache.delete(lruCache.keys().next().value);
  }
}

function cacheKey(body) {
  const normalized = JSON.stringify({ model: body.model, messages: body.messages });
  return crypto.createHash('sha256').update(normalized).digest('hex');
}

export function getCached(body) {
  if (!CACHE_ENABLED || body.stream) return null;
  const key = cacheKey(body);
  const entry = lruGet(key);
  return entry ? entry.response : null;
}

export function setCached(body, response) {
  if (!CACHE_ENABLED || body.stream) return;
  const key = cacheKey(body);
  lruSet(key, { response, timestamp: Date.now(), model: body.model });
}

export function getCacheStats() {
  return { size: lruCache.size, maxSize: CACHE_MAX_SIZE, enabled: CACHE_ENABLED };
}
