import { describe, expect, it } from 'vitest';
import { addTrace, createSession, failStep, transition } from '../src/agent/stateMachine';

const input = { name: '测试实验', procedure: '测试步骤', reagentListText: '测试试剂' };

describe('workflow state machine', () => {
  it('creates a serializable session and records transitions', () => {
    const initial = createSession(input);
    const next = transition(initial, 'GENERATE', 'running', '信息完整，跳过追问');
    expect(initial.workflow.state).toBe('PARSE');
    expect(next.workflow.state).toBe('GENERATE');
    expect(next.trace).toHaveLength(2);
    expect(JSON.parse(JSON.stringify(next))).toEqual(next);
  });

  it('keeps clarification history when a later round is appended', () => {
    let session = createSession(input);
    session = { ...session, clarificationRounds: [{ round: 1, questions: [], answers: [{ questionId: 'acid', value: ['硝酸'] }], submittedAt: '2026-01-01T00:00:00.000Z' }] };
    session = transition(session, 'CLARIFY', 'waiting_input', '继续追问');
    session = { ...session, clarificationRounds: [...session.clarificationRounds, { round: 2, questions: [], answers: [], submittedAt: null }] };
    expect(session.clarificationRounds[0].answers[0].value).toEqual(['硝酸']);
    expect(session.clarificationRounds).toHaveLength(2);
  });

  it('keeps the failed step and makes the error retryable', () => {
    const session = createSession(input);
    const failed = failStep(addTrace(session, 'llm_call', 'GENERATE', '生成草稿'), {
      step: 'GENERATE', code: 'network', message: '网络错误', retryable: true, occurredAt: new Date().toISOString(),
    });
    expect(failed.workflow.state).toBe('PARSE');
    expect(failed.workflow.error?.code).toBe('network');
    expect(failed.trace.at(-1)?.type).toBe('step_error');
  });
});
