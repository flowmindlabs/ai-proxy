// In-memory usage log — resets on restart, no database required

const MAX_RECENT = 50;
const recentRequests = [];
let requestCounter = 0;

const stats = {
  requestsByDate:     {},  // { '2026-04-09': 42 }
  totalTokensIn:      0,
  totalTokensOut:     0,
  tokensByModel:      {},  // { 'claude-sonnet-4-6': { in: 1200, out: 340 } }
  requestsByProvider: {},  // { 'anthropic': 38, 'gemini': 4 }
  fallbackCount:      0,
  errorCount:         0,
};

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

export function logRequest(entry) {
  const id = `req_${Date.now()}_${String(++requestCounter).padStart(4, '0')}`;
  const record = { id, timestamp: new Date().toISOString(), ...entry };

  // Ring buffer — keep only last MAX_RECENT entries
  recentRequests.unshift(record);
  if (recentRequests.length > MAX_RECENT) recentRequests.pop();

  // Date counter
  const today = todayKey();
  stats.requestsByDate[today] = (stats.requestsByDate[today] || 0) + 1;

  // Token counters
  const tokensIn  = entry.tokensIn  || 0;
  const tokensOut = entry.tokensOut || 0;
  stats.totalTokensIn  += tokensIn;
  stats.totalTokensOut += tokensOut;

  // Per-model tokens — sanitize key to prevent prototype pollution
  const model = String(entry.model || 'unknown').replace(/[^a-zA-Z0-9._:-]/g, '_');
  if (!Object.prototype.hasOwnProperty.call(stats.tokensByModel, model)) {
    stats.tokensByModel[model] = { in: 0, out: 0 };
  }
  stats.tokensByModel[model].in  += tokensIn;
  stats.tokensByModel[model].out += tokensOut;

  // Per-provider request count — sanitize key
  const provider = String(entry.provider || 'unknown').replace(/[^a-zA-Z0-9._:-]/g, '_');
  stats.requestsByProvider[provider] = (stats.requestsByProvider[provider] || 0) + 1;

  // Fallback and error counters
  if (entry.fallback)         stats.fallbackCount++;
  if (entry.status >= 400)    stats.errorCount++;
}

export function getStats() {
  const today = todayKey();
  return {
    requestsToday:      stats.requestsByDate[today] || 0,
    totalTokensIn:      stats.totalTokensIn,
    totalTokensOut:     stats.totalTokensOut,
    tokensByModel:      stats.tokensByModel,
    requestsByProvider: stats.requestsByProvider,
    fallbackCount:      stats.fallbackCount,
    errorCount:         stats.errorCount,
    recentRequests,
  };
}
