// Per-model pricing (USD per million tokens)
const MODEL_PRICING = {
  'claude-opus-4-8':           { input: 5.00,  output: 25.00, cacheWrite: 6.25,  cacheRead: 0.50 },
  'claude-sonnet-4-6':         { input: 3.00,  output: 15.00, cacheWrite: 3.75,  cacheRead: 0.30 },
  'claude-haiku-4-5-20251001': { input: 1.00,  output: 5.00,  cacheWrite: 1.25,  cacheRead: 0.10 },
};
const DEFAULT_PRICING = MODEL_PRICING['claude-sonnet-4-6'];

function computeCost(inputTokens, outputTokens, cacheCreationTokens, cacheReadTokens, model) {
  const p = MODEL_PRICING[model] || DEFAULT_PRICING;
  return (
    (inputTokens / 1e6) * p.input +
    (outputTokens / 1e6) * p.output +
    (cacheCreationTokens / 1e6) * p.cacheWrite +
    (cacheReadTokens / 1e6) * p.cacheRead
  );
}

let _trace = null;

export function startTrace() {
  _trace = { startedAt: Date.now(), aiCalls: [], toolCalls: [] };
}

export function recordAiCall(name, usage, latencyMs, model = 'claude-sonnet-4-6') {
  if (!_trace) return;
  const inputTokens = usage.input_tokens ?? 0;
  const outputTokens = usage.output_tokens ?? 0;
  const cacheCreationTokens = usage.cache_creation_input_tokens ?? 0;
  const cacheReadTokens = usage.cache_read_input_tokens ?? 0;
  _trace.aiCalls.push({
    name,
    model,
    latencyMs,
    inputTokens,
    outputTokens,
    cacheCreationTokens,
    cacheReadTokens,
    estimatedCostUsd: computeCost(inputTokens, outputTokens, cacheCreationTokens, cacheReadTokens, model),
  });
}

export function recordToolCall(tool, parameters, latencyMs, status = 'ok') {
  if (!_trace) return;
  _trace.toolCalls.push({ tool, parameters, latencyMs, status });
}

export function getTrace() {
  if (!_trace) return null;

  const totals = _trace.aiCalls.reduce(
    (acc, c) => ({
      inputTokens: acc.inputTokens + c.inputTokens,
      outputTokens: acc.outputTokens + c.outputTokens,
      cacheCreationTokens: acc.cacheCreationTokens + c.cacheCreationTokens,
      cacheReadTokens: acc.cacheReadTokens + c.cacheReadTokens,
      estimatedCostUsd: acc.estimatedCostUsd + c.estimatedCostUsd,
    }),
    { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, estimatedCostUsd: 0 }
  );

  const cacheSavingsUsd = (totals.cacheReadTokens / 1e6) * (DEFAULT_PRICING.input - DEFAULT_PRICING.cacheRead);
  const billableInput = totals.inputTokens + totals.cacheReadTokens;
  const cacheHitPct = billableInput > 0
    ? Math.round((totals.cacheReadTokens / billableInput) * 100)
    : 0;

  // Determine dominant model for this investigation
  const modelCounts = {};
  _trace.aiCalls.forEach(c => {
    const m = c.model || 'claude-sonnet-4-6';
    modelCounts[m] = (modelCounts[m] || 0) + 1;
  });
  const model_used = Object.entries(modelCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || 'claude-sonnet-4-6';

  return {
    ..._trace,
    totals: {
      ...totals,
      cacheSavingsUsd,
      cacheHitPct,
      model_used,
      aiCallsCount: _trace.aiCalls.length,
      toolCallsCount: _trace.toolCalls.length,
      wallClockMs: Date.now() - _trace.startedAt,
    },
  };
}
