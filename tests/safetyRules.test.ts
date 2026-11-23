import { describe, expect, it } from 'vitest';
import type { ExperimentInput, SafetyDraft, WasteStream } from '../src/agent/types';
import { auditSafetyDraft } from '../src/rules/safetyRules';
import { inferHazardTags, parseReagentList } from '../src/rules/reagentCatalog';

const input: ExperimentInput = {
  name: 'COD test',
  procedure: '加热回流',
  reagentListText: '重铬酸钾（10 mL）\n浓硫酸（30 mL）\n硫酸汞（0.4 g）',
};

const stream = (overrides: Partial<WasteStream> = {}): WasteStream => ({
  id: 'w1',
  category: 'heavy_metal',
  bucketLabel: '含铬含汞酸性重金属废液',
  mainComponents: ['重铬酸钾', '浓硫酸', '硫酸汞'],
  hazardTags: ['chromium_vi', 'mercury', 'heavy_metal', 'strong_acid'],
  forbiddenItems: ['含卤有机废液', '非卤有机废液'],
  containerSpec: '25 L HDPE 桶',
  storageNotes: '通风、防渗、远离还原剂',
  ...overrides,
});

const draft = (streams: WasteStream[]): SafetyDraft => ({
  draftId: 'd1',
  attempt: 1,
  riskLevel: 'high',
  riskRationale: [],
  compatibilityWarnings: [],
  ppe: {
    requiredPpe: [],
    ventilation: '通风橱',
    additionalControls: [],
  },
  sop: [{ order: 1, title: 'test', actions: ['test'], safetyNotes: [] }],
  emergencyProcedures: [],
  wasteStreams: streams,
  reagentDisposition: input.reagentListText.split('\n').map((line) => ({
    reagentName: line.split('（')[0],
    destination: 'waste_stream',
    wasteStreamId: 'w1',
    note: '进入专项桶',
  })),
  checklist: [],
});

describe('reagent catalog', () => {
  it('recognizes aliases and parses concentration/amount', () => {
    const reagents = parseReagentList('重铬酸钾（0.25 mol/L，10 mL）\nHgSO4（0.4 g）');
    expect(reagents[0].categories).toContain('chromium_vi');
    expect(reagents[0].concentration).toContain('mol/L');
    expect(reagents[1].categories).toContain('mercury');
  });

  it('derives labels rather than trusting supplied labels', () => {
    expect(inferHazardTags('unknown mixture (50%)')).toEqual([]);
  });
});

describe('deterministic safety rules', () => {
  it('passes a correctly segregated COD waste stream', () => {
    const result = auditSafetyDraft(input, draft([stream()]));
    expect(result.passed).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it('blocks mercury in a generic acid bucket', () => {
    const result = auditSafetyDraft(input, draft([stream({
      category: 'inorganic_acid',
      bucketLabel: '普通无机酸废液',
      hazardTags: ['strong_acid'],
    })]));
    expect(result.passed).toBe(false);
    expect(result.issues.some((entry) => entry.ruleId === 'SAFE-006')).toBe(true);
    expect(result.issues.some((entry) => entry.ruleId === 'SAFE-007')).toBe(true);
  });

  it('blocks acid and cyanide in the same bucket', () => {
    const cyanideInput: ExperimentInput = {
      ...input,
      reagentListText: '浓硫酸（10 mL）\n氰化钾（1 g）',
    };
    const cyanideStream = stream({
      id: 'w1',
      category: 'other',
      bucketLabel: '混合废液',
      mainComponents: ['浓硫酸', '氰化钾'],
      hazardTags: [],
    });
    const cyanideDraft = draft([cyanideStream]);
    cyanideDraft.reagentDisposition = [
      { reagentName: '浓硫酸', destination: 'waste_stream', wasteStreamId: 'w1', note: '' },
      { reagentName: '氰化钾', destination: 'waste_stream', wasteStreamId: 'w1', note: '' },
    ];
    const result = auditSafetyDraft(cyanideInput, cyanideDraft);
    expect(result.issues.some((entry) => entry.ruleId === 'SAFE-001')).toBe(true);
  });

  it('blocks halogenated and non-halogenated organics together', () => {
    const organicInput: ExperimentInput = {
      ...input,
      reagentListText: '三氯甲烷（50 mL）\n正己烷（50 mL）',
    };
    const organicStream = stream({
      category: 'non_halogenated_organic',
      bucketLabel: '有机废液',
      mainComponents: ['三氯甲烷', '正己烷'],
      hazardTags: [],
    });
    const organicDraft = draft([organicStream]);
    organicDraft.reagentDisposition = [
      { reagentName: '三氯甲烷', destination: 'waste_stream', wasteStreamId: 'w1', note: '' },
      { reagentName: '正己烷', destination: 'waste_stream', wasteStreamId: 'w1', note: '' },
    ];
    const result = auditSafetyDraft(organicInput, organicDraft);
    expect(result.issues.some((entry) => entry.ruleId === 'SAFE-005')).toBe(true);
  });

  it('flags an omitted hazardous reagent', () => {
    const missingDraft = draft([stream({
      mainComponents: ['浓硫酸'],
      category: 'inorganic_acid',
      hazardTags: ['strong_acid'],
    })]);
    missingDraft.reagentDisposition = [];
    const result = auditSafetyDraft(input, missingDraft);
    expect(result.issues.some((entry) => entry.ruleId === 'SAFE-009')).toBe(true);
  });

  it('calls out unrecognized reagents for manual review', () => {
    const unknownInput: ExperimentInput = {
      ...input,
      reagentListText: '神秘混合酸（10 mL）',
    };
    const unknownDraft = draft([stream({
      mainComponents: ['神秘混合酸'],
      category: 'other',
      hazardTags: [],
    })]);
    unknownDraft.reagentDisposition = [{
      reagentName: '神秘混合酸',
      destination: 'waste_stream',
      wasteStreamId: 'w1',
      note: '',
    }];
    const result = auditSafetyDraft(unknownInput, unknownDraft);
    expect(result.issues.some((entry) => entry.ruleId === 'SAFE-011')).toBe(true);
  });
});
