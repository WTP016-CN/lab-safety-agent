import { describe, expect, it } from 'vitest';
import {
  AgentOutputError,
  cleanJsonText,
  parseAgentJson,
  validateAiAuditResult,
  validateParseResult,
  validateSafetyDraft,
} from '../src/agent/schemas';

const parseOutput = {
  experimentSummary: '水样 COD 消解',
  reagents: [
    {
      name: '重铬酸钾',
      cas: '7778-50-9',
      concentration: '0.25 mol/L',
      amount: '10 mL',
      categories: ['strong_oxidizer', 'chromium_vi'],
      hazards: ['强氧化性', '六价铬毒性'],
    },
  ],
  conditions: [
    { type: 'reflux', description: '通风橱内回流加热', temperatureC: 100, duration: '2 小时' },
  ],
  initialRisk: 'high',
  riskReasons: ['六价铬与强酸体系', '回流加热'],
  informationComplete: true,
  next_action: 'GENERATE',
  missing_questions: [],
};

const draftOutput = {
  draftId: 'draft_1',
  attempt: 1,
  riskLevel: 'high',
  riskRationale: ['使用六价铬并加热'],
  compatibilityWarnings: [],
  ppe: {
    requiredPpe: [{ item: '护目镜', specification: '化学飞溅防护型', reason: '防止酸液飞溅' }],
    ventilation: '全程使用通风橱',
    additionalControls: ['二次围堰'],
  },
  sop: [{ order: 1, title: '准备', actions: ['检查玻璃器皿'], safetyNotes: ['佩戴 PPE'] }],
  emergencyProcedures: [
    { scenario: '酸液溅到皮肤', immediateActions: ['用大量流动清水冲洗至少 15 分钟'] },
  ],
  wasteStreams: [
    {
      id: 'waste_cr_mercury',
      category: 'heavy_metal',
      bucketLabel: '含铬含汞酸性重金属废液',
      mainComponents: ['重铬酸钾'],
      hazardTags: ['strong_acid', 'chromium_vi', 'mercury'],
      forbiddenItems: ['有机溶剂', '氰化物'],
      containerSpec: '耐腐蚀密封废液桶',
      storageNotes: '阴凉防漏，张贴危废标签',
    },
  ],
  reagentDisposition: [
    {
      reagentName: '重铬酸钾',
      destination: 'waste_stream',
      wasteStreamId: 'waste_cr_mercury',
      note: '全部残液收集',
    },
  ],
  checklist: ['确认通风橱运行正常'],
};

describe('agent JSON contract', () => {
  it('strips JSON markdown fences and surrounding prose', () => {
    expect(cleanJsonText('```json\n{"ok":true}\n```')).toBe('{"ok":true}');
    expect(parseAgentJson('结果如下：{"ok":true} 请查收')).toEqual({ ok: true });
  });

  it('rejects malformed JSON', () => {
    expect(() => parseAgentJson('{broken')).toThrow(AgentOutputError);
  });

  it('accepts a valid GENERATE parse result', () => {
    expect(validateParseResult(JSON.stringify(parseOutput)).next_action).toBe('GENERATE');
  });

  it('normalizes model null optional fields to undefined', () => {
    const result = validateParseResult(JSON.stringify({
      ...parseOutput,
      conditions: [
        { type: 'heating', description: '加热消解', temperatureC: null, duration: null },
        { type: 'digestion', description: '酸消解' },
      ],
    }));
    expect(result.conditions).toEqual([
      { type: 'heating', description: '加热消解' },
      { type: 'digestion', description: '酸消解' },
    ]);
  });

  it('rejects CLARIFY without questions', () => {
    const invalid = {
      ...parseOutput,
      informationComplete: false,
      next_action: 'CLARIFY',
      missing_questions: [],
    };
    expect(() => validateParseResult(JSON.stringify(invalid))).toThrow(AgentOutputError);
  });

  it('accepts a complete safety draft', () => {
    expect(validateSafetyDraft(JSON.stringify(draftOutput)).wasteStreams).toHaveLength(1);
  });

  it('rejects a non-contiguous SOP', () => {
    const invalid = {
      ...draftOutput,
      sop: [{ ...draftOutput.sop[0], order: 2 }],
    };
    expect(() => validateSafetyDraft(JSON.stringify(invalid))).toThrow(AgentOutputError);
  });

  it('requires issues when the AI audit fails', () => {
    expect(() => validateAiAuditResult('{"passed":false,"issues":[]}')).toThrow(AgentOutputError);
    expect(validateAiAuditResult('{"passed":true,"issues":[]}')).toEqual({
      passed: true,
      issues: [],
    });
  });
});
