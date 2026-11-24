import { describe, expect, it, vi } from 'vitest';
import type { ExperimentInput, SafetyDraft, WasteStream } from '../src/agent/types';
import { inferHazardTags, isKnownReagent, lookupCatalogEntry, parseReagentList } from '../src/rules/reagentCatalog';
import { auditSafetyDraft } from '../src/rules/safetyRules';
import { validateParseResult, validateSafetyDraft } from '../src/agent/schemas';
import { LlmEngine, LlmRequestError } from '../src/agent/llmClient';
import { buildMarkdown } from '../src/utils/exportReport';
import { createSession } from '../src/agent/stateMachine';

describe('catalog matching regressions', () => {
  it('does not tag sulfate salts as concentrated sulfuric acid', () => {
    expect(inferHazardTags('硫酸汞')).toEqual(expect.arrayContaining(['mercury', 'heavy_metal']));
    expect(inferHazardTags('硫酸汞')).not.toContain('strong_acid');
    expect(inferHazardTags('硫酸银')).not.toContain('concentrated_sulfuric_acid');
    expect(inferHazardTags('硫酸亚铁铵')).toEqual([]);
    expect(inferHazardTags('硝酸银')).not.toContain('strong_acid');
  });

  it('still detects the acid itself and mixtures in one string', () => {
    expect(inferHazardTags('浓硫酸')).toContain('concentrated_sulfuric_acid');
    expect(inferHazardTags('硫酸（1+1）')).toContain('strong_acid');
    expect(inferHazardTags('硫酸银（溶于浓硫酸）')).toEqual(
      expect.arrayContaining(['heavy_metal', 'strong_acid']),
    );
  });

  it('matches ASCII formulas only on word boundaries', () => {
    expect(inferHazardTags('KI')).toEqual([]);
    expect(isKnownReagent('ki')).toBe(true);
    expect(inferHazardTags('Kit buffer')).toEqual([]);
    expect(isKnownReagent('Kit buffer')).toBe(false);
    expect(inferHazardTags('HClO4')).toEqual(expect.arrayContaining(['strong_oxidizer']));
    expect(lookupCatalogEntry('HClO4')?.cas).toBe('7601-90-3');
    expect(inferHazardTags('shift buffer')).not.toContain('hydrofluoric_acid');
  });

  it('looks up the first-named reagent for CAS/hazards', () => {
    expect(parseReagentList('硫酸银（溶于浓硫酸）')[0].cas).toBe('10294-26-3');
    expect(parseReagentList('硫酸汞（0.4 g）')[0].cas).toBe('7783-35-9');
  });
});

const baseStream: WasteStream = {
  id: 'w1',
  category: 'heavy_metal',
  bucketLabel: '含铬含汞酸性重金属废液',
  mainComponents: ['重铬酸钾', '浓硫酸', '硫酸汞'],
  hazardTags: ['chromium_vi', 'mercury', 'heavy_metal', 'strong_acid'],
  forbiddenItems: ['含卤有机废液'],
  containerSpec: '桶',
  storageNotes: '通风',
};

const makeDraft = (overrides: Partial<SafetyDraft> = {}): SafetyDraft => ({
  draftId: 'd', attempt: 1, riskLevel: 'high', riskRationale: ['r'], compatibilityWarnings: [],
  ppe: { requiredPpe: [{ item: 'a', specification: 'b', reason: 'c' }], ventilation: 'v', additionalControls: [] },
  sop: [{ order: 1, title: 't', actions: ['a'], safetyNotes: [] }],
  emergencyProcedures: [{ scenario: 's', immediateActions: ['a'] }],
  wasteStreams: [baseStream],
  reagentDisposition: [{ reagentName: '重铬酸钾', destination: 'waste_stream', wasteStreamId: 'w1', note: 'n' }],
  checklist: ['c'],
  ...overrides,
});

describe('safety rule regressions', () => {
  it('checks every forbidden keyword, not just the first one', () => {
    const input: ExperimentInput = { name: 'x', procedure: 'x', reagentListText: '氢氧化钠' };
    const draft = makeDraft({
      wasteStreams: [{ ...baseStream, mainComponents: ['氢氧化钠'], category: 'alkali', hazardTags: [], forbiddenItems: ['含汞或强碱废液'] }],
      reagentDisposition: [{ reagentName: '氢氧化钠', destination: 'waste_stream', wasteStreamId: 'w1', note: 'n' }],
    });
    expect(auditSafetyDraft(input, draft).issues.some((i) => i.ruleId === 'SAFE-010')).toBe(true);
  });

  it('a blank disposition name does not cover an undisposed dangerous reagent', () => {
    const input: ExperimentInput = { name: 'x', procedure: 'x', reagentListText: '氰化钾' };
    const draft = makeDraft({
      wasteStreams: [{ ...baseStream, mainComponents: ['废水'], category: 'other', hazardTags: [] }],
      reagentDisposition: [{ reagentName: '酸', destination: 'reacted_or_consumed', note: 'n' }],
    });
    expect(auditSafetyDraft(input, draft).issues.some((i) => i.ruleId === 'SAFE-009')).toBe(true);
  });
});

describe('schema robustness', () => {
  it('accepts null / blank optional fields and drops unknown hazard tags', () => {
    const parsed = validateParseResult(JSON.stringify({
      experimentSummary: 's',
      reagents: [{ name: 'X', cas: '', concentration: null, categories: ['strong_acid', 'toxic'], hazards: null }],
      conditions: [{ type: 'heating', description: 'd', temperatureC: '80' }],
      initialRisk: 'high', riskReasons: ['r'], informationComplete: true, next_action: 'GENERATE', missing_questions: null,
    }));
    expect(parsed.reagents[0]).toEqual({ name: 'X', categories: ['strong_acid'], hazards: [] });
    expect(parsed.conditions[0].temperatureC).toBe(80);
    expect(parsed.missing_questions).toEqual([]);
  });

  it('treats a blank wasteStreamId as missing', () => {
    const raw = makeDraft({ reagentDisposition: [{ reagentName: 'a', destination: 'not_used', wasteStreamId: '', note: 'n' }] });
    expect(validateSafetyDraft(JSON.stringify(raw)).reagentDisposition[0].wasteStreamId).toBeUndefined();
  });
});

describe('llm client cancellation', () => {
  it('rejects with a non-retryable error when the external signal aborts', async () => {
    const controller = new AbortController();
    const fetchImpl = vi.fn((_url: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    }));
    const engine = new LlmEngine({ baseUrl: 'https://x/v1', apiKey: 'k', model: 'm' }, { fetchImpl: fetchImpl as typeof fetch, signal: controller.signal });
    const pending = engine.audit(createSession({ name: 'n', procedure: 'p', reagentListText: 'r' }), makeDraft());
    controller.abort();
    await expect(pending).rejects.toMatchObject({ retryable: false });
    await expect(pending).rejects.toBeInstanceOf(LlmRequestError);
  });
});

describe('markdown export', () => {
  it('includes unresolved issues when manual review is required', () => {
    const session = createSession({ name: 'n', procedure: 'p', reagentListText: 'a\r\nb' });
    const md = buildMarkdown({
      ...session,
      draft: makeDraft(),
      audit: {
        retryCount: 2, requiresManualReview: true,
        history: [{ round: 1, draftAttempt: 3, checkedAt: '', local: { passed: false, issues: [] }, ai: { passed: false, issues: ['x'] }, passed: false, issues: ['[AI] 未解决'], requiresManualReview: true }],
      },
    });
    expect(md).toContain('待人工复核问题');
    expect(md).toContain('[AI] 未解决');
    expect(md).toContain('含重金属废液');
    expect(md).toContain('## 试剂去向');
    expect(md).not.toContain('\r');
  });
});
