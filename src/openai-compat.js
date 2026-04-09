// OpenAI ↔ Anthropic translation layer
// Handles request/response format conversion so OpenAI-compatible tools work with Anthropic models

const MAX_BUFFER_SIZE = 1024 * 1024; // 1MB — discard if SSE buffer grows beyond this

// ── Model mapping ─────────────────────────────────────────────────────────────
// Maps common OpenAI model names to their closest Claude equivalents.
// If the model already starts with "claude-" it passes through unchanged.

const MODEL_MAP = {
  'gpt-4o':              'claude-sonnet-4-6',
  'gpt-4o-mini':         'claude-haiku-4-5-20251001',
  'gpt-4':               'claude-sonnet-4-6',
  'gpt-4-turbo':         'claude-sonnet-4-6',
  'gpt-4-turbo-preview': 'claude-sonnet-4-6',
  'gpt-4-32k':           'claude-opus-4-6',
  'gpt-3.5-turbo':       'claude-haiku-4-5-20251001',
  'gpt-3.5-turbo-16k':   'claude-haiku-4-5-20251001',
  'o1':                  'claude-opus-4-6',
  'o1-mini':             'claude-sonnet-4-6',
  'o3-mini':             'claude-sonnet-4-6',
};

function resolveModel(model) {
  if (!model) return 'claude-sonnet-4-6';
  if (model.startsWith('claude-')) return model;
  const mapped = MODEL_MAP[model];
  if (!mapped) console.warn(`[WARN] Unknown model "${model}", defaulting to claude-sonnet-4-6`);
  return mapped || 'claude-sonnet-4-6';
}

// ── Request translation: OpenAI → Anthropic ──────────────────────────────────

function remapToolChoice(toolChoice) {
  if (!toolChoice) return undefined;
  if (toolChoice === 'auto')     return { type: 'auto' };
  if (toolChoice === 'none')     return { type: 'none' };
  if (toolChoice === 'required') return { type: 'any' };
  if (toolChoice.type === 'function') {
    return { type: 'tool', name: toolChoice.function.name };
  }
  return { type: 'auto' };
}

function remapMessage(msg) {
  // Tool result messages — wrap in user turn with tool_result block
  if (msg.role === 'tool') {
    if (!msg.tool_call_id) throw new Error('Tool message missing required field: tool_call_id');
    return {
      role: 'user',
      content: [{
        type:        'tool_result',
        tool_use_id: msg.tool_call_id,
        content:     msg.content ?? '',
      }],
    };
  }

  // Assistant messages with tool_calls
  if (msg.role === 'assistant' && msg.tool_calls?.length) {
    const content = [];
    if (msg.content) content.push({ type: 'text', text: msg.content });
    for (const tc of msg.tool_calls) {
      if (!tc.id || !tc.function?.name) {
        throw new Error('Tool call missing required fields: id or function.name');
      }
      let input = {};
      try {
        input = JSON.parse(tc.function.arguments || '{}');
      } catch {
        console.warn(`[WARN] Could not parse tool_call arguments for "${tc.function.name}", using empty object`);
      }
      content.push({
        type:  'tool_use',
        id:    tc.id,
        name:  tc.function.name,
        input,
      });
    }
    return { role: 'assistant', content };
  }

  // Standard message — pass through as-is
  return { role: msg.role, content: msg.content ?? '' };
}

export function toAnthropicRequest(body) {
  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    throw new Error('messages must be a non-empty array');
  }

  // Validate tools structure if provided
  if (body.tools?.length) {
    for (const t of body.tools) {
      if (!t.function?.name) throw new Error('Each tool must have a function.name');
    }
  }

  // Extract system messages (may be multiple — join them)
  let system;
  const filteredMessages = body.messages.filter(m => {
    if (m.role === 'system') {
      system = system ? `${system}\n${m.content}` : m.content;
      return false;
    }
    return true;
  });

  const anthropicBody = {
    model:      resolveModel(body.model),
    max_tokens: body.max_tokens ?? 8192,
    messages:   filteredMessages.map(remapMessage),
  };

  if (system)                   anthropicBody.system = system;
  if (body.temperature != null) anthropicBody.temperature = body.temperature;
  if (body.top_p != null)       anthropicBody.top_p = body.top_p;
  if (body.stream)              anthropicBody.stream = true;
  if (body.stop) {
    anthropicBody.stop_sequences = Array.isArray(body.stop) ? body.stop : [body.stop];
  }

  if (body.tools?.length) {
    anthropicBody.tools = body.tools.map(t => ({
      name:         t.function.name,
      description:  t.function.description ?? '',
      input_schema: t.function.parameters ?? { type: 'object', properties: {} },
    }));
  }

  if (body.tool_choice) {
    anthropicBody.tool_choice = remapToolChoice(body.tool_choice);
  }

  return anthropicBody;
}

// ── Response translation: Anthropic → OpenAI ─────────────────────────────────

const STOP_REASON_MAP = {
  end_turn:       'stop',
  tool_use:       'tool_calls',
  max_tokens:     'length',
  stop_sequence:  'stop',
};

export function toOpenAIResponse(data) {
  const content   = Array.isArray(data.content) ? data.content : [];
  const textBlocks = content.filter(b => b.type === 'text');
  const toolBlocks = content.filter(b => b.type === 'tool_use');

  const message = { role: 'assistant', content: null };

  if (textBlocks.length) {
    message.content = textBlocks.map(b => b.text).join('');
  }

  if (toolBlocks.length) {
    message.tool_calls = toolBlocks
      .filter(b => b.id && b.name)
      .map((b, i) => ({
        index:    i,
        id:       b.id,
        type:     'function',
        function: {
          name:      b.name,
          arguments: JSON.stringify(b.input ?? {}),
        },
      }));
  }

  return {
    id:      data.id ? `chatcmpl-${data.id}` : `chatcmpl-${Date.now()}`,
    object:  'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model:   data.model ?? 'claude-sonnet-4-6',
    choices: [{
      index:         0,
      message,
      finish_reason: STOP_REASON_MAP[data.stop_reason] ?? 'stop',
    }],
    usage: {
      prompt_tokens:     data.usage?.input_tokens ?? 0,
      completion_tokens: data.usage?.output_tokens ?? 0,
      total_tokens:      (data.usage?.input_tokens ?? 0) + (data.usage?.output_tokens ?? 0),
    },
  };
}

// ── Streaming translation: Anthropic SSE → OpenAI SSE ────────────────────────

export async function streamAnthropicToOpenAI(upstream, res, model, onComplete) {
  let messageId      = `chatcmpl-${Date.now()}`;
  let currentToolIdx = -1;
  let stopReason     = 'stop';
  let inputTokens    = 0;
  let outputTokens   = 0;

  const sendChunk = (delta, finishReason = null) => {
    const chunk = {
      id:      messageId,
      object:  'chat.completion.chunk',
      created: Math.floor(Date.now() / 1000),
      model,
      choices: [{ index: 0, delta, finish_reason: finishReason }],
    };
    res.write(`data: ${JSON.stringify(chunk)}\n\n`);
  };

  // Handle client disconnect — destroy upstream to avoid orphaned connections
  res.on('close', () => upstream.body?.destroy());

  let buffer = '';

  try {
    for await (const chunk of upstream.body) {
      buffer += chunk.toString();

      // Guard against runaway buffer
      if (buffer.length > MAX_BUFFER_SIZE) {
        console.error('[ERROR] SSE buffer exceeded max size, dropping connection');
        break;
      }

      const lines = buffer.split('\n');
      buffer = lines.pop(); // keep incomplete last line

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const raw = line.slice(6).trim();
        if (!raw) continue;

        let event;
        try {
          event = JSON.parse(raw);
        } catch {
          console.warn('[WARN] Could not parse SSE event, skipping:', raw.slice(0, 100));
          continue;
        }

        switch (event.type) {
          case 'message_start': {
            messageId    = event.message?.id ? `chatcmpl-${event.message.id}` : messageId;
            inputTokens  = event.message?.usage?.input_tokens ?? 0;
            outputTokens = event.message?.usage?.output_tokens ?? 0;
            sendChunk({ role: 'assistant', content: '' });
            break;
          }

          case 'content_block_start': {
            if (event.content_block?.type === 'tool_use') {
              currentToolIdx++;
              sendChunk({
                tool_calls: [{
                  index:    currentToolIdx,
                  id:       event.content_block.id,
                  type:     'function',
                  function: { name: event.content_block.name, arguments: '' },
                }],
              });
            }
            break;
          }

          case 'content_block_delta': {
            const delta = event.delta;
            if (delta?.type === 'text_delta') {
              sendChunk({ content: delta.text });
            } else if (delta?.type === 'input_json_delta') {
              sendChunk({
                tool_calls: [{
                  index:    currentToolIdx,
                  function: { arguments: delta.partial_json },
                }],
              });
            }
            break;
          }

          case 'message_delta': {
            outputTokens += event.usage?.output_tokens ?? 0;
            stopReason    = STOP_REASON_MAP[event.delta?.stop_reason] ?? 'stop';
            break;
          }

          case 'message_stop': {
            sendChunk({}, stopReason);
            res.write('data: [DONE]\n\n');
            console.log(`  [stream] model=${model} in=${inputTokens} out=${outputTokens}`);
            if (onComplete) onComplete({ tokensIn: inputTokens, tokensOut: outputTokens });
            break;
          }
        }
      }
    }
  } catch (err) {
    // Re-throw so index.js can handle it and send SSE error event
    throw err;
  }
}

// ── Models list ───────────────────────────────────────────────────────────────

export function buildModelsResponse(extraModels = []) {
  const claudeModels = [
    'claude-opus-4-6',
    'claude-sonnet-4-6',
    'claude-haiku-4-5-20251001',
    'claude-sonnet-4-5',
    'claude-3-5-sonnet-20241022',
    'claude-3-5-haiku-20241022',
  ].map(id => ({ id, object: 'model', created: 1700000000, owned_by: 'anthropic' }));

  return {
    object: 'list',
    data: [
      ...claudeModels,
      ...extraModels,
    ],
  };
}
