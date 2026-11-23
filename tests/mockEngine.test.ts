import { describe, expect, it } from 'vitest';
import { MockAgentEngine } from '../src/agent/mockEngine';
import { createSession, transition } from '../src/agent/stateMachine';
import type { ExperimentInput, SessionContext } from '../src/agent/types';
import { PRESETS } from '../src/data/presets';
import { auditSafetyDraft } from '../src/rules/safetyRules';

function inputOf(id: 'cod' | 'soil' | 'ammonia'): ExperimentInput {
  const preset = PRESETS.find((item) => item.id === id)!;
  return {
    name: preset.name,
    procedure: preset.procedure,
    reagentListText: preset.reagentListText,
  };
}

function generateContext(input: ExperimentInput, retryCount = 0): SessionContext {
  let session = transition(createSession(input), 'GENERATE', 'running', '开始生成');
  session = {
    ...session,
    audit: { ...session.audit, retryCount },
  };
  return session;
}

describe('offline mock workflow', () => {
  it('skips clarification for complete COD and fixes the intentionally unsafe first draft', async () => {
    const engine = new MockAgentEngine();
    const input = inputOf('cod');
    const parsed = await engine.parse(input);
    expect(parsed.next_action).toBe('GENERATE');
    expect(parsed.missing_questions).toHaveLength(0);

    const firstContext = generateContext(input);
    const unsafeDraft = await engine.generate(firstContext);
    expect(unsafeDraft.wasteStreams[0].category).toBe('inorganic_acid');
    expect(auditSafetyDraft(input, unsafeDraft).passed).toBe(false);
    expect((await engine.audit(firstContext, unsafeDraft)).passed).toBe(false);

    const correctedDraft = await engine.generate(generateContext(input, 1));
    expect(correctedDraft.wasteStreams[0].category).toBe('heavy_metal');
    expect(correctedDraft.wasteStreams[0].bucketLabel).toContain('含铬、含汞');
    expect(auditSafetyDraft(input, correctedDraft).passed).toBe(true);
    expect((await engine.audit(firstContext, correctedDraft)).passed).toBe(true);
  });

  it('asks the incomplete soil case, accepts contextual answers, and generates segregated waste', async () => {
    const engine = new MockAgentEngine();
    const input = inputOf('soil');
    const parsed = await engine.parse(input);
    expect(parsed.next_action).toBe('CLARIFY');
    expect(parsed.missing_questions.map((question) => question.id)).toEqual(
      expect.arrayContaining(['soil_acid', 'soil_hf', 'soil_digestion', 'soil_scale']),
    );

    let session = transition(createSession(input), 'CLARIFY', 'waiting_input', '等待补充信息');
    session = {
      ...session,
      parse: parsed,
      clarificationRounds: [{
        round: 1,
        questions: parsed.missing_questions,
        answers: [
          { questionId: 'soil_acid', value: ['hno3_hcl_hf'] },
          { questionId: 'soil_hf', value: ['yes'] },
          { questionId: 'soil_digestion', value: ['microwave_sealed'] },
          { questionId: 'soil_scale', value: ['medium'] },
        ],
        submittedAt: new Date().toISOString(),
      }],
    };
    const reevaluated = await engine.clarify(session);
    expect(reevaluated.next_action).toBe('GENERATE');
    expect(reevaluated.informationComplete).toBe(true);

    const draft = await engine.generate({ ...session, parse: reevaluated });
    expect(draft.wasteStreams.some((stream) => stream.category === 'fluoride')).toBe(true);
    expect(draft.wasteStreams.some((stream) => stream.category === 'heavy_metal')).toBe(true);
    expect((await engine.audit(session, draft)).passed).toBe(true);
  });

  it('passes the Nessler mercury/base case without a rewrite', async () => {
    const engine = new MockAgentEngine();
    const input = inputOf('ammonia');
    const parsed = await engine.parse(input);
    expect(parsed.next_action).toBe('GENERATE');
    const context = generateContext(input);
    const draft = await engine.generate(context);
    expect(draft.wasteStreams[0].category).toBe('mercury');
    expect(auditSafetyDraft(input, draft).passed).toBe(true);
    expect((await engine.audit(context, draft)).passed).toBe(true);
  });
});
