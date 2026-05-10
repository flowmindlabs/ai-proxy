// Heuristic smart router — assigns Tier 1/2/3 based on prompt complexity.
// All off by default; enable with SMART_ROUTING=true.

const SMART_ROUTING     = process.env.SMART_ROUTING === 'true';
const TIER1_MODEL       = process.env.ROUTING_TIER1_MODEL || 'claude-haiku-4-5-20251001';
const TIER2_MODEL       = process.env.ROUTING_TIER2_MODEL || 'claude-sonnet-4-6';
const TIER3_MODEL       = process.env.ROUTING_TIER3_MODEL || 'claude-opus-4-6';

const TIER3_KEYWORDS = [
  'reason step by step', 'detailed analysis', 'pros and cons',
  'analyze', 'compare', 'evaluate', 'critique', 'synthesize', 'expert', 'complex', 'nuanced',
];

const TIER1_KEYWORDS = [
  'yes or no', 'bullet points',
  'summarize', 'translate', 'classify', 'list', 'simple', 'quick', 'short',
];

// Sorted longest-first so multi-word phrases match before single words
TIER3_KEYWORDS.sort((a, b) => b.length - a.length);
TIER1_KEYWORDS.sort((a, b) => b.length - a.length);

function extractText(body) {
  return (body.messages || [])
    .map(m => {
      if (typeof m.content === 'string') return m.content;
      if (Array.isArray(m.content)) {
        return m.content.filter(b => b.type === 'text').map(b => b.text).join(' ');
      }
      return '';
    })
    .join(' ');
}

function assignTier(body) {
  const text       = extractText(body).toLowerCase();
  const estTokens  = Math.ceil(text.length / 4);

  if (estTokens > 4000) return 3;
  for (const kw of TIER3_KEYWORDS) { if (text.includes(kw)) return 3; }
  if (estTokens < 500) {
    for (const kw of TIER1_KEYWORDS) { if (text.includes(kw)) return 1; }
  }
  return 2;
}

export function applySmartRouting(body) {
  if (!SMART_ROUTING) return body;

  const tier = assignTier(body);
  const targetModel = [null, TIER1_MODEL, TIER2_MODEL, TIER3_MODEL][tier];

  if (targetModel === body.model) return body;

  console.log(`  [ROUTER] tier=${tier} "${body.model}" → "${targetModel}"`);
  return { ...body, model: targetModel, _routerTier: tier };
}

export { TIER3_MODEL };
