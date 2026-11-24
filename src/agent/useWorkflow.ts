import { useCallback, useRef, useState } from 'react';
import type {
  AgentEngine,
  ClarificationAnswer,
  ExperimentInput,
  ModelSettings,
  ParseResult,
  SafetyDraft,
  SessionContext,
  StepError,
  WorkflowState,
} from './types';
import { addTrace, createSession, failStep, nowIso, transition } from './stateMachine';
import { createLlmEngine, LlmRequestError } from './llmClient';
import { MockAgentEngine } from './mockEngine';
import { auditSafetyDraft } from '../rules/safetyRules';

export const MAX_REWRITES = 2;

function toStepError(error: unknown, step: WorkflowState): StepError {
  if (error instanceof LlmRequestError) {
    return {
      step,
      code: error.code,
      message: error.message,
      retryable: error.retryable,
      occurredAt: nowIso(),
      ...(error.detail ? { detail: error.detail } : {}),
    };
  }
  return {
    step,
    code: 'unknown',
    message: error instanceof Error ? error.message : '当前步骤发生未知错误，请重试。',
    retryable: true,
    occurredAt: nowIso(),
    ...(error instanceof Error ? { detail: error.message } : {}),
  };
}

const resume = (session: SessionContext): SessionContext => ({
  ...session,
  workflow: { ...session.workflow, status: 'running', error: null },
});

export function useWorkflow(
  settings: ModelSettings,
  mockMode: boolean,
  onSettingsRequired: () => void,
) {
  const [session, setSession] = useState<SessionContext | null>(null);
  const sessionRef = useRef<SessionContext | null>(null);
  /** Id of the session whose async chain currently owns the workflow, or null when idle. */
  const runningRef = useRef<string | null>(null);
  const retryRef = useRef<(() => Promise<void>) | null>(null);
  /** Cancels in-flight model requests when the user abandons the current session. */
  const abortRef = useRef<AbortController | null>(null);

  const commit = useCallback((next: SessionContext) => {
    sessionRef.current = next;
    setSession(next);
    return next;
  }, []);

  const isActive = useCallback((id: string) => sessionRef.current?.id === id, []);

  /**
   * Commits only while the session is still the one on screen. Async chains of an
   * abandoned session (reset / history opened / new review started) are silently dropped
   * instead of overwriting the current UI.
   */
  const commitActive = useCallback((next: SessionContext): boolean => {
    if (!isActive(next.id)) return false;
    commit(next);
    return true;
  }, [commit, isActive]);

  const getEngine = useCallback((): AgentEngine => {
    if (mockMode) return new MockAgentEngine();
    if (!settings.apiKey.trim()) {
      onSettingsRequired();
      throw new Error('未配置 API Key。请打开「模型设置」填写 Key，或开启离线演示模式。');
    }
    return createLlmEngine(settings, { signal: abortRef.current?.signal });
  }, [mockMode, onSettingsRequired, settings]);

  const finishAudit = useCallback(async (
    current: SessionContext,
    draft: SafetyDraft,
    local: ReturnType<typeof auditSafetyDraft>,
  ) => {
    let working = current;
    try {
      const ai = await getEngine().audit(working, draft);
      if (!isActive(working.id)) return;
      const passed = local.passed && ai.passed;
      const issues = [
        ...local.issues.map((issue) => `[${issue.ruleId}] ${issue.message} ${issue.suggestion}`),
        ...ai.issues.map((issue) => `[AI] ${issue}`),
      ];
      const result = {
        round: working.audit.history.length + 1,
        draftAttempt: draft.attempt,
        checkedAt: nowIso(),
        local,
        ai,
        passed,
        issues,
        requiresManualReview: !passed && working.audit.retryCount >= MAX_REWRITES,
      };
      working = {
        ...working,
        audit: {
          history: [...working.audit.history, result],
          retryCount: working.audit.retryCount,
          requiresManualReview: result.requiresManualReview,
        },
      };
      working = addTrace(
        working,
        'ai_audit',
        'AUDIT',
        ai.passed ? '独立 AI 安全审核员复核通过' : `AI 审核提出 ${ai.issues.length} 项问题`,
        { attempt: draft.attempt },
      );

      if (passed) {
        commitActive(transition(working, 'REPORT', 'done', '本地规则与 AI 审核均通过，生成最终报告'));
        return;
      }
      if (working.audit.retryCount < MAX_REWRITES) {
        const nextAttempt = working.audit.retryCount + 1;
        working = {
          ...working,
          audit: { ...working.audit, retryCount: nextAttempt },
        };
        working = addTrace(
          working,
          'auto_rewrite',
          'GENERATE',
          `拦截到潜在安全漏洞，正在自动修正（第 ${nextAttempt} 次）`,
          { attempt: nextAttempt, details: { issues } },
        );
        if (!commitActive(working)) return;
        await new Promise((resolve) => setTimeout(resolve, 450));
        if (!isActive(working.id)) return;
        await generateAndAudit(working, issues);
        return;
      }
      working = {
        ...working,
        audit: { ...working.audit, requiresManualReview: true },
      };
      commitActive(transition(working, 'REPORT', 'done', '达到最大自动重写次数，报告已标注人工复核'));
    } catch (error) {
      if (!commitActive(failStep(working, toStepError(error, 'AUDIT')))) return;
      retryRef.current = async () => {
        const latest = sessionRef.current;
        if (!latest) return;
        const running = resume(latest);
        commit(running);
        await finishAudit(running, draft, local);
      };
    }
  // generateAndAudit is declared below; both callbacks change together because they
  // share the same dependencies, so the closure never goes stale.
  }, [commit, commitActive, getEngine, isActive]);

  const generateAndAudit = useCallback(async (base: SessionContext, corrections: string[] = []) => {
    const attempt = base.audit.retryCount + 1;
    let working = addTrace(
      transition(base, 'GENERATE', 'running', attempt > 1 ? '根据审核问题自动重写安全方案' : '生成安全 SOP 与危废分类方案'),
      'llm_call',
      'GENERATE',
      corrections.length ? `携带 ${corrections.length} 条修正指令重新生成` : '基于完整上下文生成审查草稿',
      { attempt },
    );
    if (!commitActive(working)) return;
    let draft: SafetyDraft;
    let local: ReturnType<typeof auditSafetyDraft>;
    try {
      const generated = await getEngine().generate(working, corrections);
      if (!isActive(working.id)) return;
      // The attempt counter is owned by the workflow, not by the model output.
      draft = { ...generated, attempt };
      working = { ...working, draft };
      working = transition(working, 'AUDIT', 'running', '草稿已生成，开始本地规则与 AI 双重校验', {
        type: 'llm_result',
        attempt,
      });
      commitActive(working);
      local = auditSafetyDraft(working.input, draft);
    } catch (error) {
      if (!commitActive(failStep(working, toStepError(error, 'GENERATE')))) return;
      retryRef.current = async () => {
        const latest = sessionRef.current;
        if (!latest) return;
        await generateAndAudit(resume(latest), corrections);
      };
      return;
    }

    working = addTrace(
      working,
      'rule_audit',
      'AUDIT',
      local.passed ? '本地确定性规则校验通过' : `本地规则拦截 ${local.issues.length} 项问题`,
      { attempt },
    );
    if (!commitActive(working)) return;
    await finishAudit(working, draft, local);
  }, [commitActive, finishAudit, getEngine, isActive]);

  const runParse = useCallback(async (base: SessionContext, mode: 'parse' | 'clarify') => {
    let working = mode === 'clarify'
      ? addTrace(base, 'llm_call', 'CLARIFY', '合并原始信息与全部历史问答，重新评估完整性')
      : addTrace(base, 'llm_call', 'PARSE', '提取试剂属性、操作条件并进行风险初筛');
    if (!commitActive(working)) return;
    let parsed: ParseResult;
    try {
      const engine = getEngine();
      parsed = mode === 'clarify' ? await engine.clarify(working) : await engine.parse(working.input);
    } catch (error) {
      if (!commitActive(failStep(working, toStepError(error, working.workflow.state)))) return;
      retryRef.current = async () => {
        const latest = sessionRef.current;
        if (!latest) return;
        const running = resume(latest);
        commit(running);
        await runParse(running, mode);
      };
      return;
    }
    if (!isActive(working.id)) return;

    working = addTrace({ ...working, parse: parsed }, 'llm_result', working.workflow.state, mode === 'clarify' ? '信息完整性重新评估完成' : '实验信息解析完成');
    if (parsed.next_action === 'CLARIFY') {
      working = transition(
        working,
        'CLARIFY',
        'waiting_input',
        `${mode === 'clarify' ? '仍有安全信息缺失' : '检测到安全信息盲区'}，进入第 ${working.clarificationRounds.length + 1} 轮追问`,
      );
      working = {
        ...working,
        clarificationRounds: [
          ...working.clarificationRounds,
          {
            round: working.clarificationRounds.length + 1,
            questions: parsed.missing_questions,
            answers: [],
            submittedAt: null,
          },
        ],
      };
      commitActive(working);
      return;
    }
    working = addTrace(working, 'state_transition', 'GENERATE', '关键信息完整，开始生成安全方案');
    await generateAndAudit(working);
  }, [commit, commitActive, generateAndAudit, getEngine, isActive]);

  /** Runs `task` as the owner of the workflow for session `id`. */
  const own = useCallback(async (id: string, task: () => Promise<void>) => {
    runningRef.current = id;
    try {
      await task();
    } finally {
      // Only release the lock if a newer session has not taken it over meanwhile.
      if (runningRef.current === id) runningRef.current = null;
    }
  }, []);

  const abandonCurrent = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    runningRef.current = null;
    retryRef.current = null;
  }, []);

  const start = useCallback(async (input: ExperimentInput) => {
    if (runningRef.current) return;
    if (!mockMode && !settings.apiKey.trim()) {
      onSettingsRequired();
      return;
    }
    abandonCurrent();
    abortRef.current = new AbortController();
    const initial = addTrace(createSession(input), 'user_input', 'PARSE', `开始审查「${input.name}」`);
    commit(initial);
    await own(initial.id, () => runParse(initial, 'parse'));
  }, [abandonCurrent, commit, mockMode, onSettingsRequired, own, runParse, settings.apiKey]);

  const submitClarification = useCallback(async (answers: ClarificationAnswer[]) => {
    const current = sessionRef.current;
    if (!current || current.workflow.state !== 'CLARIFY' || runningRef.current) return;
    const rounds = current.clarificationRounds.map((round, index) =>
      index === current.clarificationRounds.length - 1
        ? { ...round, answers, submittedAt: nowIso() }
        : round,
    );
    let next = transition({ ...current, clarificationRounds: rounds }, 'CLARIFY', 'running', '正在合并补充信息并重新评估');
    next = addTrace(next, 'clarification_submit', 'CLARIFY', `提交第 ${rounds.length} 轮补充回答`, { round: rounds.length });
    commit(next);
    await own(next.id, () => runParse(next, 'clarify'));
  }, [commit, own, runParse]);

  const retry = useCallback(async () => {
    const current = sessionRef.current;
    if (!current || current.workflow.status !== 'error' || runningRef.current) return;
    const task = retryRef.current;
    if (!task) return;
    await own(current.id, task);
  }, [own]);

  const reset = useCallback(() => {
    abandonCurrent();
    sessionRef.current = null;
    setSession(null);
  }, [abandonCurrent]);

  /** Opens a saved session (e.g. from history), cancelling whatever is running. */
  const load = useCallback((saved: SessionContext) => {
    abandonCurrent();
    commit(saved);
  }, [abandonCurrent, commit]);

  return {
    session,
    start,
    submitClarification,
    retry,
    reset,
    load,
    busy: session?.workflow.status === 'running',
  };
}
