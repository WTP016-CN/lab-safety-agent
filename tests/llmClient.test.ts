import { describe, expect, it, vi } from 'vitest';
import {
  LlmEngine,
  LlmRequestError,
  extractCompletionText,
  fetchModelIds,
  parseSseTranscript,
  resolveModelsUrl,
} from '../src/agent/llmClient';
import { cleanJsonText, parseAgentJson, validateSafetyDraft } from '../src/agent/schemas';
import { createSession } from '../src/agent/stateMachine';
import { loadSettings } from '../src/utils/storage';

const auditOkJson = '{"passed":true,"issues":[]}';

const sampleDraft = {
  draftId: 'd1',
  attempt: 1,
  riskLevel: 'high' as const,
  riskRationale: ['r'],
  compatibilityWarnings: [],
  ppe: { requiredPpe: [{ item: 'a', specification: 'b', reason: 'c' }], ventilation: 'v', additionalControls: [] },
  sop: [{ order: 1, title: 't', actions: ['a'], safetyNotes: [] }],
  emergencyProcedures: [{ scenario: 's', immediateActions: ['a'] }],
  wasteStreams: [{
    id: 'w1',
    category: 'heavy_metal' as const,
    bucketLabel: '含铬废液',
    mainComponents: ['重铬酸钾'],
    hazardTags: ['chromium_vi' as const],
    forbiddenItems: ['有机物'],
    containerSpec: '桶',
    storageNotes: '通风',
  }],
  reagentDisposition: [{ reagentName: '重铬酸钾', destination: 'waste_stream' as const, wasteStreamId: 'w1', note: 'n' }],
  checklist: ['c'],
};

describe('model endpoint helpers', () => {
  it('maps full chat completion endpoints to the models endpoint', () => {
    expect(resolveModelsUrl('https://api.deepseek.com/chat/completions')).toBe('https://api.deepseek.com/models');
    expect(resolveModelsUrl('https://api.deepseek.com/v1')).toBe('https://api.deepseek.com/v1/models');
  });

  it('extracts sorted unique model ids', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [{ id: 'deepseek-chat' }, { id: 'deepseek-reasoner' }, { id: 'deepseek-chat' }] })));
    const models = await fetchModelIds({ baseUrl: 'https://api.example.com/v1', apiKey: 'sk-test' }, { fetchImpl });
    expect(models).toEqual(['deepseek-chat', 'deepseek-reasoner']);
    expect(fetchImpl).toHaveBeenCalledWith('https://api.example.com/v1/models', expect.objectContaining({ headers: { Authorization: 'Bearer sk-test' } }));
  });
});

describe('real-world LLM compatibility', () => {
  it('does not send a low max_tokens upfront and retries when reasoning exhausts default tokens', async () => {
    const calls: Array<Record<string, unknown>> = [];
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      calls.push(body);
      if (calls.length === 1) {
        // Server default max_tokens ran out during reasoning_content
        return new Response(JSON.stringify({
          choices: [{
            message: { role: 'assistant', content: null, reasoning_content: '正在推导试剂危险性…' },
            finish_reason: 'length',
          }],
        }));
      }
      return new Response(JSON.stringify({
        choices: [{
          message: { role: 'assistant', content: auditOkJson, reasoning_content: '思考完毕' },
          finish_reason: 'stop',
        }],
      }));
    });

    const engine = new LlmEngine(
      { baseUrl: 'https://api.deepseek.com/chat/completions', apiKey: 'sk-test', model: 'deepseek-reasoner' },
      { fetchImpl: fetchImpl as typeof fetch },
    );
    const res = await engine.audit(createSession({ name: 'n', procedure: 'p', reagentListText: 'r' }), sampleDraft);
    expect(res).toEqual({ passed: true, issues: [] });
    expect(calls[0].max_tokens).toBeUndefined();
    expect(calls[1].max_tokens).toBe(16_384);
  });

  it('falls back to stream:true SSE when a relay returns empty non-streaming content', async () => {
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      if (!body.stream) {
        return new Response(JSON.stringify({
          choices: [{ message: { role: 'assistant', content: '' }, finish_reason: 'stop' }],
        }));
      }
      const sse = [
        'data: {"choices":[{"delta":{"reasoning_content":"先思考"}}]}',
        'data: {"choices":[{"delta":{"content":"{\\"passed\\":true,"}}]}',
        'data: {"choices":[{"delta":{"content":"\\"issues\\":[]}"}},{"finish_reason":"stop"}]}',
        'data: [DONE]',
      ].join('\n');
      return new Response(sse, { headers: { 'Content-Type': 'text/event-stream' } });
    });

    const engine = new LlmEngine(
      { baseUrl: 'https://relay.example.com/v1', apiKey: 'sk-test', model: 'deepseek-chat' },
      { fetchImpl: fetchImpl as typeof fetch },
    );
    const res = await engine.audit(createSession({ name: 'n', procedure: 'p', reagentListText: 'r' }), sampleDraft);
    expect(res).toEqual({ passed: true, issues: [] });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('surfaces HTTP-200 gateway error envelopes instead of opaque empty-content errors', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: { message: '模型 deepseek-flash 不存在' } }), { status: 200 }),
    );
    const engine = new LlmEngine(
      { baseUrl: 'https://relay.example.com/v1', apiKey: 'sk-test', model: 'deepseek-flash' },
      { fetchImpl },
    );
    await expect(
      engine.audit(createSession({ name: 'n', procedure: 'p', reagentListText: 'r' }), sampleDraft),
    ).rejects.toThrow(/deepseek-flash 不存在/);
  });

  it('attaches diagnostic detail when a response genuinely has no text', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ status: 'ok' }), { status: 200 }));
    const engine = new LlmEngine(
      { baseUrl: 'https://relay.example.com/v1', apiKey: 'sk-test', model: 'deepseek-chat' },
      { fetchImpl },
    );
    try {
      await engine.audit(createSession({ name: 'n', procedure: 'p', reagentListText: 'r' }), sampleDraft);
      expect.fail('should throw');
    } catch (err) {
      expect(err).toBeInstanceOf(LlmRequestError);
      expect((err as LlmRequestError).detail).toContain('HTTP 200');
      expect((err as LlmRequestError).detail).toContain('{"status":"ok"}');
    }
  });

  it('strips <think> blocks containing braces/fences before parsing JSON', () => {
    const raw = `<think>\n如果信息不全应返回 {"next_action": "CLARIFY"}\n\`\`\`json\n{"fake":1}\n\`\`\`\n</think>\n\`\`\`json\n{"passed":true,"issues":[]}\n\`\`\``;
    expect(cleanJsonText(raw)).toBe('{"passed":true,"issues":[]}');
    expect(parseAgentJson(raw)).toEqual({ passed: true, issues: [] });
  });

  it('extracts text across Responses, Anthropic thinking blocks, and SSE transcripts', () => {
    expect(extractCompletionText({
      content: [
        { type: 'thinking', text: 'internal thoughts' },
        { type: 'output_text', text: '{"passed":true,"issues":[]}' },
      ],
    })).toBe('{"passed":true,"issues":[]}');

    const sseParsed = parseSseTranscript('data: {"type":"response.output_text.delta","delta":"{\\"ok\\":1}"}\ndata: [DONE]');
    expect(sseParsed && extractCompletionText(sseParsed)).toBe('{"ok":1}');
  });

  it('ignores placeholder wasteStreamId when destination is not waste_stream', () => {
    const validated = validateSafetyDraft(JSON.stringify({
      ...sampleDraft,
      reagentDisposition: [
        ...sampleDraft.reagentDisposition,
        { reagentName: '双氧水', destination: 'reacted_or_consumed', wasteStreamId: '无', note: '反应完全分解' },
      ],
    }));
    expect(validated.reagentDisposition[1].wasteStreamId).toBeUndefined();
  });

  it('migrates legacy deepseek-flash default model in localStorage', () => {
    const storage = new Map<string, string>([[
      'safebeaker.model-settings.v1',
      JSON.stringify({ baseUrl: 'https://api.deepseek.com/chat/completions', apiKey: 'sk-1', model: 'deepseek-flash' }),
    ]]);
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, val: string) => { storage.set(key, val); },
    });
    try {
      expect(loadSettings().model).toBe('deepseek-chat');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
