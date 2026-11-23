import { useCallback, useRef, useState } from 'react';
import type {
  AgentEngine,
  ClarificationAnswer,
  ExperimentInput,
  ModelSettings,
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

export function useWorkflow(
  settings: ModelSettings,
  mockMode: boolean,
  onSettingsRequired: () => void,
) {
  const [session, setSession] = useState<SessionContext | null>(null);
  const sessionRef = useRef<SessionContext | null>(null);
  const runningRef = useRef(false);
  const retryRef = useRef<(() => Promise<void>) | null>(null);

  const commit = useCallback((next: SessionContext) => {
    sessionRef.current = next;
    setSession(next);
    return next;
  }, []);

  const getEngine = useCallback((): AgentEngine => {
    if (mockMode) return new MockAgentEngine();
    if (!settings.apiKey.trim()) {
      onSettingsRequired();
      throw new Error('未配置 API Key。请打开「模型设置」填写 Key，或开启离线演示模式。');
    }
    return createLlmEngine(settings);
  }, [mockMode, onSettingsRequired, settings]);

  const finishAudit = useCallback(async (
    current: SessionContext,
    draft: SafetyDraft,
    local: ReturnType<typeof auditSafetyDraft>,
  ) => {
    let working = current;
    try {
      const ai = await getEngine().audit(working, draft);
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
        commit(transition(working, 'REPORT', 'done', '本地规则与 AI 审核均通过，生成最终报告'));
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
        commit(working);
        await new Promise((resolve) => setTimeout(resolve, 450));
        await generateAndAudit(working, issues);
        return;
      }
      working = {
        ...working,
        audit: { ...working.audit, requiresManualReview: true },
      };
      commit(transition(working, 'REPORT', 'done', '达到最大自动重写次数，报告已标注人工复核'));
    } catch (error) {
      const errored = failStep(working, toStepError(error, 'AUDIT'));
      commit(errored);
      retryRef.current = async () => {
        const latest = sessionRef.current;
        if (!latest) return;
        const running = { ...latest, workflow: { ...latest.workflow, status: 'running' as const, error: null } };
        commit(running);
        await finishAudit(running, draft, local);
      };
    }
  }, [commit, getEngine]);

  const generateAndAudit = useCallback(async (base: SessionContext, corrections: string[] = []) => {
    const attempt = base.audit.retryCount + 1;
    let working = addTrace(
      transition(base, 'GENERATE', 'running', attempt > 1 ? '根据审核问题自动重写安全方案' : '生成安全 SOP 与危废分类方案'),
      'llm_call',
      'GENERATE',
      corrections.length ? `携带 ${corrections.length} 条修正指令重新生成` : '基于完整上下文生成审查草稿',
      { attempt },
    );
    commit(working);
    let draft: SafetyDraft;
    try {
      draft = await getEngine().generate(working, corrections);
      working = { ...working, draft };
      working = transition(working, 'AUDIT', 'running', '草稿已生成，开始本地规则与 AI 双重校验', {
        type: 'llm_result',
        attempt,
      });
      commit(working);
    } catch (error) {
      commit(failStep(working, toStepError(error, 'GENERATE')));
      retryRef.current = async () => {
        const latest = sessionRef.current;
        if (!latest) return;
        await generateAndAudit({ ...latest, workflow: { ...latest.workflow, status: 'running', error: null } }, corrections);
      };
      return;
    }

    const local = auditSafetyDraft(working.input, draft);
    working = addTrace(
      working,
      'rule_audit',
      'AUDIT',
      local.passed ? '本地确定性规则校验通过' : `本地规则拦截 ${local.issues.length} 项问题`,
      { attempt },
    );
    commit(working);
    await finishAudit(working, draft, local);
  }, [commit, finishAudit, getEngine]);

  const runParse = useCallback(async (base: SessionContext, mode: 'parse' | 'clarify') => {
    let working = mode === 'clarify'
      ? addTrace(base, 'llm_call', 'CLARIFY', '合并原始信息与全部历史问答，重新评估完整性')
      : addTrace(base, 'llm_call', 'PARSE', '提取试剂属性、操作条件并进行风险初筛');
    commit(working);
    try {
      const engine = getEngine();
      const parsed = mode === 'clarify' ? await engine.clarify(working) : await engine.parse(working.input);
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
        commit(working);
        return;
      }
      working = transition(working, 'GENERATE', 'running', '关键信息完整，开始生成安全方案');
      commit(working);
      await generateAndAudit(working);
    } catch (error) {
      const errored = failStep(working, toStepError(error, working.workflow.state));
      commit(errored);
      retryRef.current = async () => {
        const latest = sessionRef.current;
        if (!latest) return;
        const running = { ...latest, workflow: { ...latest.workflow, status: 'running' as const, error: null } };
        commit(running);
        await runParse(running, mode);
      };
    }
  }, [commit, generateAndAudit, getEngine]);

  const start = useCallback(async (input: ExperimentInput) => {
    if (runningRef.current) return;
    if (!mockMode && !settings.apiKey.trim()) {
      onSettingsRequired();
      return;
    }
    runningRef.current = true;
    retryRef.current = null;
    const initial = addTrace(createSession(input), 'user_input', 'PARSE', `开始审查「${input.name}」`);
    commit(initial);
    try {
      await runParse(initial, 'parse');
    } finally {
      runningRef.current = false;
    }
  }, [commit, mockMode, onSettingsRequired, runParse, settings.apiKey]);

  const submitClarification = useCallback(async (answers: ClarificationAnswer[]) => {
    const current = sessionRef.current;
    if (!current || current.workflow.state !== 'CLARIFY' || runningRef.current) return;
    runningRef.current = true;
    const rounds = current.clarificationRounds.map((round, index) =>
      index === current.clarificationRounds.length - 1
        ? { ...round, answers, submittedAt: nowIso() }
        : round,
    );
    let next = transition({ ...current, clarificationRounds: rounds }, 'CLARIFY', 'running', '正在合并补充信息并重新评估');
    next = addTrace(next, 'clarification_submit', 'CLARIFY', `提交第 ${rounds.length} 轮补充回答`, { round: rounds.length });
    commit(next);
    try {
      await runParse(next, 'clarify');
    } finally {
      runningRef.current = false;
    }
  }, [commit, runParse]);

  const retry = useCallback(async () => {
    if (!sessionRef.current || sessionRef.current.workflow.status !== 'error' || runningRef.current) return;
    runningRef.current = true;
    try {
      if (retryRef.current) await retryRef.current();
    } finally {
      runningRef.current = false;
    }
  }, []);

  const reset = useCallback(() => {
    runningRef.current = false;
    retryRef.current = null;
    sessionRef.current = null;
    setSession(null);
  }, []);

  return {
    session,
    start,
    submitClarification,
    retry,
    reset,
    commit,
    busy: session?.workflow.status === 'running',
  };
}
