// Gemini ↔ OpenAI translation layer
// Google Gemini uses a completely different API format from OpenAI/Anthropic

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

const GEMINI_FINISH_REASON_MAP = {
  STOP:            'stop',
  MAX_TOKENS:      'length',
  SAFETY:          'stop',
  RECITATION:      'stop',
  FINISH_REASON_UNSPECIFIED: 'stop',
};

// ── URL builder ───────────────────────────────────────────────────────────────

export function buildGeminiUrl(model, stream, apiKey) {
  if (stream) {
    return `${GEMINI_BASE}/${model}:streamGenerateContent?alt=sse&key=${apiKey}`;
  }
  return `${GEMINI_BASE}/${model}:generateContent?key=${apiKey}`;
}

// ── Request translation: OpenAI → Gemini ─────────────────────────────────────

export function toGeminiRequest(body) {
  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    throw new Error('messages must be a non-empty array');
  }

  // Extract system messages
  let systemText;
  const filteredMessages = body.messages.filter(m => {
    if (m.role === 'system') {
      systemText = systemText ? `${systemText}\n${m.content}` : m.content;
      return false;
    }
    return true;
  });

  // Map messages to Gemini format
  const contents = filteredMessages.map(m => {
    const role = m.role === 'assistant' ? 'model' : 'user';

    // Handle tool result messages
    if (m.role === 'tool') {
      return {
        role: 'user',
        parts: [{ text: `Tool result for ${m.tool_call_id}: ${m.content}` }],
      };
    }

    // Handle assistant messages with tool_calls
    if (m.role === 'assistant' && m.tool_calls?.length) {
      const text = m.content || m.tool_calls.map(tc =>
        `[Tool call: ${tc.function.name}(${tc.function.arguments})]`
      ).join('\n');
      return { role: 'model', parts: [{ text }] };
    }

    // Standard text message — content can be string or array
    let text = '';
    if (typeof m.content === 'string') {
      text = m.content;
    } else if (Array.isArray(m.content)) {
      text = m.content
        .filter(b => b.type === 'text')
        .map(b => b.text)
        .join('');
    }

    return { role, parts: [{ text }] };
  });

  const geminiBody = { contents };

  if (systemText) {
    geminiBody.systemInstruction = { parts: [{ text: systemText }] };
  }

  const generationConfig = {};
  if (body.max_tokens != null)  generationConfig.maxOutputTokens = body.max_tokens;
  if (body.temperature != null) generationConfig.temperature = body.temperature;
  if (body.top_p != null)       generationConfig.topP = body.top_p;
  if (body.stop) {
    generationConfig.stopSequences = Array.isArray(body.stop) ? body.stop : [body.stop];
  }
  if (Object.keys(generationConfig).length) {
    geminiBody.generationConfig = generationConfig;
  }

  return geminiBody;
}

// ── Response translation: Gemini → OpenAI ────────────────────────────────────

export function toOpenAIResponseFromGemini(data, model) {
  const candidate = data.candidates?.[0];
  const text = candidate?.content?.parts?.map(p => p.text || '').join('') ?? '';
  const finishReason = GEMINI_FINISH_REASON_MAP[candidate?.finishReason] ?? 'stop';

  return {
    id:      `chatcmpl-gemini-${Date.now()}`,
    object:  'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{
      index:         0,
      message:       { role: 'assistant', content: text },
      finish_reason: finishReason,
    }],
    usage: {
      prompt_tokens:     data.usageMetadata?.promptTokenCount     ?? 0,
      completion_tokens: data.usageMetadata?.candidatesTokenCount ?? 0,
      total_tokens:      (data.usageMetadata?.promptTokenCount ?? 0) +
                         (data.usageMetadata?.candidatesTokenCount ?? 0),
    },
  };
}

// ── Streaming translation: Gemini SSE → OpenAI SSE ───────────────────────────
// Each Gemini SSE event is a COMPLETE response JSON, not an incremental delta.
// We extract the text from each event and emit it as an OpenAI content chunk.

const MAX_BUFFER_SIZE = 1024 * 1024; // 1MB

export async function streamGeminiToOpenAI(upstream, res, model, onComplete) {
  const msgId      = `chatcmpl-gemini-${Date.now()}`;
  let inputTokens  = 0;
  let outputTokens = 0;

  const sendChunk = (delta, finishReason = null) => {
    const chunk = {
      id:      msgId,
      object:  'chat.completion.chunk',
      created: Math.floor(Date.now() / 1000),
      model,
      choices: [{ index: 0, delta, finish_reason: finishReason }],
    };
    res.write(`data: ${JSON.stringify(chunk)}\n\n`);
  };

  res.on('close', () => upstream.body?.destroy());

  // Send initial role chunk
  sendChunk({ role: 'assistant', content: '' });

  let buffer = '';
  let finishReason = 'stop';

  try {
    for await (const chunk of upstream.body) {
      buffer += chunk.toString();

      if (buffer.length > MAX_BUFFER_SIZE) {
        console.error('[ERROR] Gemini SSE buffer exceeded max size');
        break;
      }

      const lines = buffer.split('\n');
      buffer = lines.pop();

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const raw = line.slice(6).trim();
        if (!raw || raw === '[DONE]') continue;

        let event;
        try {
          event = JSON.parse(raw);
        } catch {
          console.warn('[WARN] Could not parse Gemini SSE event, skipping');
          continue;
        }

        const candidate = event.candidates?.[0];
        if (!candidate) continue;

        // Extract text from all parts
        const text = candidate.content?.parts?.map(p => p.text || '').join('') ?? '';
        if (text) sendChunk({ content: text });

        // Track finish reason and tokens from final event
        if (candidate.finishReason) {
          finishReason = GEMINI_FINISH_REASON_MAP[candidate.finishReason] ?? 'stop';
        }

        if (event.usageMetadata) {
          inputTokens  = event.usageMetadata.promptTokenCount     ?? 0;
          outputTokens = event.usageMetadata.candidatesTokenCount ?? 0;
        }
      }
    }
  } catch (err) {
    throw err;
  }

  // Send final finish chunk and DONE
  sendChunk({}, finishReason);
  res.write('data: [DONE]\n\n');

  console.log(`  [gemini-stream] model=${model} in=${inputTokens} out=${outputTokens}`);
  if (onComplete) onComplete({ tokensIn: inputTokens, tokensOut: outputTokens });
}
