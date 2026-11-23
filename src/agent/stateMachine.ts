import type {
  AuditLoopState,
  SessionContext,
  StepError,
  TraceEvent,
  WorkflowState,
  WorkflowStatus,
} from './types';

const newId = () => crypto.randomUUID();
export const nowIso = () => new Date().toISOString();

export function createSession(input: SessionContext['input']): SessionContext {
  const now = nowIso();
  const audit: AuditLoopState = { history: [], retryCount: 0, requiresManualReview: false };
  return {
    schemaVersion: 1,
    id: newId(),
    createdAt: now,
    updatedAt: now,
    input,
    parse: null,
    clarificationRounds: [],
    draft: null,
    audit,
    workflow: { state: 'PARSE', status: 'running', error: null },
    trace: [
      {
        id: newId(),
        at: now,
        type: 'state_transition',
        state: 'PARSE',
        message: '已提交实验信息，开始解析试剂与操作风险',
      },
    ],
  };
}

export function transition(
  session: SessionContext,
  state: WorkflowState,
  status: WorkflowStatus,
  message: string,
  extras: Partial<Pick<TraceEvent, 'type' | 'attempt' | 'round' | 'details'>> = {},
): SessionContext {
  const at = nowIso();
  const event: TraceEvent = {
    id: newId(),
    at,
    type: extras.type ?? 'state_transition',
    state,
    message,
    ...(extras.attempt !== undefined ? { attempt: extras.attempt } : {}),
    ...(extras.round !== undefined ? { round: extras.round } : {}),
    ...(extras.details ? { details: extras.details } : {}),
  };
  return {
    ...session,
    updatedAt: at,
    workflow: { state, status, error: null },
    trace: [...session.trace, event],
  };
}

export function failStep(session: SessionContext, error: StepError): SessionContext {
  return {
    ...session,
    updatedAt: nowIso(),
    workflow: { ...session.workflow, status: 'error', error },
    trace: [
      ...session.trace,
      {
        id: newId(),
        at: error.occurredAt,
        type: 'step_error',
        state: error.step,
        message: error.message,
        details: { code: error.code },
      },
    ],
  };
}

export function addTrace(
  session: SessionContext,
  type: TraceEvent['type'],
  state: WorkflowState,
  message: string,
  extras: Partial<Pick<TraceEvent, 'attempt' | 'round' | 'details'>> = {},
): SessionContext {
  const event: TraceEvent = {
    id: newId(),
    at: nowIso(),
    type,
    state,
    message,
    ...(extras.attempt !== undefined ? { attempt: extras.attempt } : {}),
    ...(extras.round !== undefined ? { round: extras.round } : {}),
    ...(extras.details ? { details: extras.details } : {}),
  };
  return { ...session, updatedAt: event.at, trace: [...session.trace, event] };
}
