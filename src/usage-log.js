// In-memory usage log — resets on restart, no database required

import { calculateCost } from './cost.js';

const MAX_RECENT = 50;
const recentRequests = [];
let requestCounter = 0;

const stats = {
  requestsByDate:      {},  // { '2026-04-09': 42 }
  totalTokensIn:       0,
  totalTokensOut:      0,
  tokensByModel:       {},  // { 'claude-sonnet-4-6': { in: 1200, out: 340 } }
  requestsByProvider:  {},  // { 'anthropic': 38, 'gemini': 4 }
  fallbackCount:       0,
  errorCount:          0,
  totalCostUsd:        0,
  costByModel:         {},  // { 'claude-sonnet-4-6': 0.00234 }
  dailyCostByProvider: {},  // { 'anthropic': { date: 'YYYY-MM-DD', costUsd: 0 } }
};

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

export function logRequest(entry) {
  const id = `req_${Date.now()}_${String(++requestCounter).padStart(4, '0')}`;

  // Compute cost
  const cost = entry.estimatedCostUsd !== undefined
    ? entry.estimatedCostUsd
    : calculateCost(entry.model, entry.tokensIn || 0, entry.tokensOut || 0);

  const record = { id, timestamp: new Date().toISOString(), ...entry, estimatedCostUsd: cost };

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

  // Cost accumulation
  stats.totalCostUsd += cost;
  if (!Object.prototype.hasOwnProperty.call(stats.costByModel, model)) {
    stats.costByModel[model] = 0;
  }
  stats.costByModel[model] = parseFloat((stats.costByModel[model] + cost).toFixed(8));

  // Daily cost per provider with lazy midnight reset
  if (!Object.prototype.hasOwnProperty.call(stats.dailyCostByProvider, provider)) {
    stats.dailyCostByProvider[provider] = { date: today, costUsd: 0 };
  }
  const daily = stats.dailyCostByProvider[provider];
  if (daily.date !== today) { daily.date = today; daily.costUsd = 0; }
  daily.costUsd = parseFloat((daily.costUsd + cost).toFixed(8));

  // Fallback and error counters
  if (entry.fallback)         stats.fallbackCount++;
  if (entry.status >= 400)    stats.errorCount++;
}

// Returns today's spend for a provider, 0 if no entry or stale date
export function getDailySpend(provider) {
  const key = String(provider || '').replace(/[^a-zA-Z0-9._:-]/g, '_');
  const entry = stats.dailyCostByProvider[key];
  if (!entry || entry.date !== todayKey()) return 0;
  return entry.costUsd;
}

export function getStats() {
  const today = todayKey();
  return {
    requestsToday:       stats.requestsByDate[today] || 0,
    totalTokensIn:       stats.totalTokensIn,
    totalTokensOut:      stats.totalTokensOut,
    tokensByModel:       stats.tokensByModel,
    requestsByProvider:  stats.requestsByProvider,
    fallbackCount:       stats.fallbackCount,
    errorCount:          stats.errorCount,
    recentRequests,
    totalCostUsd:        parseFloat(stats.totalCostUsd.toFixed(8)),
    costByModel:         stats.costByModel,
    dailyCostByProvider: stats.dailyCostByProvider,
  };
}
