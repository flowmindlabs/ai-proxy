// Semantic cache using in-process sentence embeddings.
// Requires: npm install @xenova/transformers
// Gracefully disabled if package is not installed or SEMANTIC_CACHE !== 'true'.

const SEMANTIC_CACHE     = process.env.SEMANTIC_CACHE === 'true';
const THRESHOLD          = parseFloat(process.env.SEMANTIC_THRESHOLD      || '0.92');
const MAX_SIZE           = parseInt(process.env.SEMANTIC_CACHE_MAX_SIZE   || '200', 10);

// FIFO store: [{ embedding: Float32Array|number[], response, model, timestamp }]
const store = [];

let pipelineInstance = null;
let loadAttempted    = false;
let available        = false;

async function loadModel() {
  if (loadAttempted) return pipelineInstance;
  loadAttempted = true;
  try {
    const { pipeline } = await import('@xenova/transformers');
    pipelineInstance   = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
    available          = true;
    console.log('  [SEMANTIC CACHE] Model loaded (Xenova/all-MiniLM-L6-v2 ~23MB)');
  } catch (err) {
    console.warn(`  [SEMANTIC CACHE] @xenova/transformers not available: ${err.message}`);
    console.warn('  [SEMANTIC CACHE] Run: npm install @xenova/transformers');
  }
  return pipelineInstance;
}

async function embed(text) {
  const pipe = await loadModel();
  if (!pipe) return null;
  try {
    const output = await pipe(text, { pooling: 'mean', normalize: true });
    return Array.from(output.data);
  } catch (err) {
    console.error('[SEMANTIC CACHE] Embed error:', err.message);
    return null;
  }
}

// Vectors are L2-normalized → dot product = cosine similarity
function dotProduct(a, b) {
  let sum = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) sum += a[i] * b[i];
  return sum;
}

function extractPromptText(body) {
  const msgs = (body.messages || []).filter(m => m.role === 'user');
  const last = msgs[msgs.length - 1];
  if (!last) return '';
  if (typeof last.content === 'string') return last.content;
  if (Array.isArray(last.content)) {
    return last.content.filter(b => b.type === 'text').map(b => b.text).join(' ');
  }
  return '';
}

export async function getSemanticCached(body) {
  if (!SEMANTIC_CACHE || body.stream) return null;

  const text    = extractPromptText(body);
  if (!text) return null;

  const queryVec = await embed(text);
  if (!queryVec) return null;

  let bestSim   = 0;
  let bestEntry = null;

  for (const entry of store) {
    if (entry.model !== body.model) continue;
    const sim = dotProduct(queryVec, entry.embedding);
    if (sim > bestSim) { bestSim = sim; bestEntry = entry; }
  }

  if (bestSim >= THRESHOLD && bestEntry) {
    console.log(`  [SEMANTIC CACHE] HIT sim=${bestSim.toFixed(4)}`);
    return bestEntry.response;
  }
  return null;
}

export async function setSemanticCached(body, response) {
  if (!SEMANTIC_CACHE || body.stream) return;

  const text = extractPromptText(body);
  if (!text) return;

  const embedding = await embed(text);
  if (!embedding) return;

  if (store.length >= MAX_SIZE) store.shift();
  store.push({ embedding, response, model: body.model, timestamp: Date.now() });
}

export function getSemanticCacheStats() {
  return { enabled: SEMANTIC_CACHE, available, size: store.length, maxSize: MAX_SIZE, threshold: THRESHOLD };
}
