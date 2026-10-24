/**
 * Token Furnace — deliberately spends model tokens.
 *
 * Registers one tool that starts, reports and stops a background loop of real
 * model calls made through `ctx.llm.stream()`. Nothing is spent until the tool
 * is called, the loop self-limits on a token target, a wall-clock deadline and
 * a failure budget, and every reported number comes from the provider's own
 * `usage` chunk rather than an estimate.
 *
 * The padded system prompt carries a fresh nonce on every call so a provider's
 * prefix cache cannot turn the spend into cheap cache reads.
 */

export const inject = ['tools', 'llm', 'agentDefaultModel'];

const DEFAULTS = {
  targetTokens: 1000000,
  concurrency: 2,
  systemChars: 200000,
  maxTokens: 16,
  maxSeconds: 120,
};

const LIMITS = {
  concurrency: 8,
  systemChars: 4000000,
  maxTokens: 4096,
  maxSeconds: 3600,
};

const FILLER_UNIT =
  'token furnace filler line: the quick brown fox jumps over the lazy dog 0123456789 abcdefghijklmnopqrstuvwxyz\n';

function clampInt(value, fallback, min, max) {
  const n = typeof value === 'number' ? Math.floor(value) : Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n, min), max);
}

function filler(chars, nonce) {
  const times = Math.ceil(chars / FILLER_UNIT.length);
  const body = FILLER_UNIT.repeat(times);
  // The nonce changes the very first bytes, so every call is a cache miss.
  return `${nonce}\n${body.slice(0, Math.max(0, chars - nonce.length - 1))}`;
}

export function apply(ctx) {
  const state = {
    running: false,
    controller: null,
    startedAt: 0,
    finishedAt: 0,
    deadline: 0,
    targetTokens: DEFAULTS.targetTokens,
    concurrency: DEFAULTS.concurrency,
    systemChars: DEFAULTS.systemChars,
    maxTokens: DEFAULTS.maxTokens,
    calls: 0,
    failedCalls: 0,
    inputTokens: 0,
    outputTokens: 0,
    cachedInputTokens: 0,
    lastError: '',
    stopReason: '',
  };

  const total = () => state.inputTokens + state.outputTokens;

  function elapsedSeconds() {
    if (!state.startedAt) return 0;
    const end = state.running ? Date.now() : state.finishedAt || Date.now();
    return Math.round((end - state.startedAt) / 100) / 10;
  }

  function snapshot(note) {
    const value = {
      running: state.running,
      calls: state.calls,
      failedCalls: state.failedCalls,
      inputTokens: state.inputTokens,
      outputTokens: state.outputTokens,
      cachedInputTokens: state.cachedInputTokens,
      totalTokens: total(),
      targetTokens: state.targetTokens,
      concurrency: state.concurrency,
      systemChars: state.systemChars,
      elapsedSeconds: elapsedSeconds(),
      stopReason: state.stopReason,
      lastError: state.lastError,
    };
    if (note) value.note = note;
    return value;
  }

  function stop(reason) {
    if (state.running) {
      state.running = false;
      state.finishedAt = Date.now();
      state.stopReason = state.stopReason || reason || 'stopped';
    }
    if (state.controller) {
      try {
        state.controller.abort();
      } catch {
        /* already aborted */
      }
    }
  }

  async function burnOnce(signal) {
    const selection = ctx.agentDefaultModel.currentSelection();
    const provider = selection && selection.provider;
    const model = selection && selection.model;
    if (!provider || !model) throw new Error('no default model selection to spend on');

    const nonce = `furnace-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    const stream = ctx.llm.stream({
      provider,
      model,
      system: filler(state.systemChars, nonce),
      maxTokens: state.maxTokens,
      messages: [{ role: 'user', content: [{ type: 'text', text: 'Reply with OK.' }] }],
      signal,
    });

    for await (const chunk of stream) {
      if (!chunk) continue;
      if (chunk.type === 'usage' && chunk.usage) {
        state.inputTokens += chunk.usage.inputTokens || 0;
        state.outputTokens += chunk.usage.outputTokens || 0;
        state.cachedInputTokens += chunk.usage.cacheReadTokens || 0;
      } else if (chunk.type === 'finish' && chunk.reason && chunk.reason.kind === 'error') {
        const failure = chunk.reason.failure;
        throw new Error((failure && failure.message) || 'model call failed');
      }
    }
    state.calls += 1;
  }

  async function drive() {
    const worker = async () => {
      while (state.running && Date.now() < state.deadline && total() < state.targetTokens) {
        try {
          await burnOnce(state.controller.signal);
        } catch (error) {
          if (!state.running) return;
          state.failedCalls += 1;
          state.lastError = String((error && error.message) || error).slice(0, 300);
          if (state.failedCalls >= 5) {
            state.stopReason = `aborted after ${state.failedCalls} failed calls`;
            stop(state.stopReason);
            return;
          }
        }
      }
    };
    await Promise.all(Array.from({ length: state.concurrency }, () => worker()));
    if (state.running) {
      state.stopReason = total() >= state.targetTokens ? 'token target reached' : 'deadline reached';
      stop(state.stopReason);
    }
  }

  function start(args) {
    if (state.running) return snapshot('already running');
    state.targetTokens = clampInt(args.targetTokens, DEFAULTS.targetTokens, 1, 100000000);
    state.concurrency = clampInt(args.concurrency, DEFAULTS.concurrency, 1, LIMITS.concurrency);
    state.systemChars = clampInt(args.systemChars, DEFAULTS.systemChars, 1000, LIMITS.systemChars);
    state.maxTokens = clampInt(args.maxTokens, DEFAULTS.maxTokens, 1, LIMITS.maxTokens);
    const maxSeconds = clampInt(args.maxSeconds, DEFAULTS.maxSeconds, 1, LIMITS.maxSeconds);

    state.running = true;
    state.controller = new AbortController();
    state.startedAt = Date.now();
    state.finishedAt = 0;
    state.deadline = state.startedAt + maxSeconds * 1000;
    state.calls = 0;
    state.failedCalls = 0;
    state.inputTokens = 0;
    state.outputTokens = 0;
    state.cachedInputTokens = 0;
    state.lastError = '';
    state.stopReason = '';

    drive().catch((error) => {
      state.lastError = String((error && error.message) || error).slice(0, 300);
      stop('driver crashed');
    });
    return snapshot('started');
  }

  const definition = {
    name: 'token_furnace',
    description:
      'Starts, reports or stops a background loop of real model calls whose only purpose is to spend tokens. ' +
      'Each call sends a padded system prompt (systemChars) with a fresh nonce so provider prefix caches miss, ' +
      'and asks for at most maxTokens output tokens. Counts come from the provider usage chunk. ' +
      'action=start begins spending, action=status reports the running totals, action=stop ends it.',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['start', 'status', 'stop'],
          description: 'start begins spending, status only reports, stop aborts the loop.',
        },
        targetTokens: {
          type: 'integer',
          minimum: 1,
          description: `Stop after this many input+output tokens. Default ${DEFAULTS.targetTokens}.`,
        },
        concurrency: {
          type: 'integer',
          minimum: 1,
          maximum: LIMITS.concurrency,
          description: `Parallel model calls. Default ${DEFAULTS.concurrency}.`,
        },
        systemChars: {
          type: 'integer',
          minimum: 1000,
          maximum: LIMITS.systemChars,
          description: `Characters of padding in each call's system prompt (about 4 chars per token). Default ${DEFAULTS.systemChars}.`,
        },
        maxTokens: {
          type: 'integer',
          minimum: 1,
          maximum: LIMITS.maxTokens,
          description: `Output token ceiling per call. Default ${DEFAULTS.maxTokens}.`,
        },
        maxSeconds: {
          type: 'integer',
          minimum: 1,
          maximum: LIMITS.maxSeconds,
          description: `Wall-clock ceiling for the whole loop. Default ${DEFAULTS.maxSeconds}.`,
        },
      },
      required: ['action'],
      additionalProperties: false,
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          running: { type: 'boolean' },
          calls: { type: 'integer' },
          failedCalls: { type: 'integer' },
          inputTokens: { type: 'integer' },
          outputTokens: { type: 'integer' },
          cachedInputTokens: { type: 'integer' },
          totalTokens: { type: 'integer' },
          targetTokens: { type: 'integer' },
          concurrency: { type: 'integer' },
          systemChars: { type: 'integer' },
          elapsedSeconds: { type: 'number' },
          stopReason: { type: 'string' },
          lastError: { type: 'string' },
          note: { type: 'string' },
        },
        required: ['running', 'calls', 'totalTokens'],
        additionalProperties: false,
      },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 1) }],
    },
    timeoutMs: 30000,
    isConcurrencySafe: () => false,
    async execute(args) {
      const input = args || {};
      const action = typeof input.action === 'string' ? input.action : 'status';
      if (action === 'start') return start(input);
      if (action === 'stop') {
        stop('stopped by request');
        return snapshot('stopped');
      }
      return snapshot();
    },
  };

  ctx.effect(() => {
    const disposeTool = ctx.tools.register(definition);
    return () => {
      stop('plugin unloaded');
      disposeTool();
    };
  });
}
