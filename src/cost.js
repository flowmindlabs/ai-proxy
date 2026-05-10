// Per-model token pricing in USD. Exact match first, then longest-prefix match.
// Prices sourced from provider pricing pages (May 2026).
// Local/unknown models default to $0.

const PRICING = {
  // ── Anthropic ────────────────────────────────────────────────────────────
  'claude-opus-4-7':              { in: 15,    out: 75    },
  'claude-opus-4-6':              { in: 15,    out: 75    },
  'claude-opus-4':                { in: 15,    out: 75    },
  'claude-sonnet-4-6':            { in: 3,     out: 15    },
  'claude-sonnet-4-5':            { in: 3,     out: 15    },
  'claude-sonnet-4':              { in: 3,     out: 15    },
  'claude-haiku-4-5':             { in: 0.8,   out: 4     },
  'claude-haiku-4':               { in: 0.8,   out: 4     },
  'claude-3-5-sonnet':            { in: 3,     out: 15    },
  'claude-3-5-haiku':             { in: 0.8,   out: 4     },
  'claude-3-opus':                { in: 15,    out: 75    },
  'claude-3-sonnet':              { in: 3,     out: 15    },
  'claude-3-haiku':               { in: 0.25,  out: 1.25  },

  // ── OpenAI ───────────────────────────────────────────────────────────────
  'gpt-4.5':                      { in: 75,    out: 150   },
  'gpt-4o-mini':                  { in: 0.15,  out: 0.6   },
  'gpt-4o':                       { in: 2.5,   out: 10    },
  'gpt-4-turbo':                  { in: 10,    out: 30    },
  'gpt-4':                        { in: 30,    out: 60    },
  'gpt-3.5-turbo':                { in: 0.5,   out: 1.5   },
  'o3-mini':                      { in: 1.1,   out: 4.4   },
  'o3':                           { in: 10,    out: 40    },
  'o1-mini':                      { in: 1.1,   out: 4.4   },
  'o1':                           { in: 15,    out: 60    },

  // ── Google Gemini ─────────────────────────────────────────────────────────
  'gemini-2.5-pro':               { in: 1.25,  out: 10    },
  'gemini-2.5-flash':             { in: 0.075, out: 0.3   },
  'gemini-2.0-flash':             { in: 0.1,   out: 0.4   },
  'gemini-2.0-flash-lite':        { in: 0.075, out: 0.3   },
  'gemini-1.5-pro':               { in: 1.25,  out: 5     },
  'gemini-1.5-flash':             { in: 0.075, out: 0.3   },
  'gemini-1.5-flash-8b':         { in: 0.0375, out: 0.15  },

  // ── OpenRouter (passthrough — model string after "openrouter/" is the real model)
  // OpenRouter adds ~5% margin; approximate closed-source prices used.
  // Unknown openrouter/* models default to $0 (covered by prefix fallback below).
};

// Prefix table sorted longest-first so "gpt-4o-mini" matches before "gpt-4o"
const PREFIX_LIST = Object.keys(PRICING).sort((a, b) => b.length - a.length);

// Strip "openrouter/" prefix for price lookup — user sends "openrouter/gpt-4o"
function normalizeModel(model) {
  if (!model) return '';
  return model.startsWith('openrouter/') ? model.slice('openrouter/'.length) : model;
}

export function calculateCost(model, tokensIn, tokensOut) {
  const m = normalizeModel(model || '');

  // 1. Exact match
  let rates = PRICING[m];

  // 2. Longest prefix match
  if (!rates) {
    for (const prefix of PREFIX_LIST) {
      if (m.startsWith(prefix)) { rates = PRICING[prefix]; break; }
    }
  }

  // 3. Unknown / local → free
  if (!rates) return 0;

  const cost = ((tokensIn || 0) * rates.in + (tokensOut || 0) * rates.out) / 1_000_000;
  return parseFloat(cost.toFixed(8));
}

export { PRICING };
