import { Check, CircleAlert, FlaskConical, ListChecks, MessageCircleQuestion, ScanSearch, ShieldCheck } from 'lucide-react';
import type { SessionContext, WorkflowState } from '../agent/types';

const steps: { state: WorkflowState; label: string; icon: typeof ScanSearch }[] = [
  { state: 'PARSE', label: '输入解析', icon: ScanSearch },
  { state: 'CLARIFY', label: '安全追问', icon: MessageCircleQuestion },
  { state: 'GENERATE', label: 'SOP 生成', icon: FlaskConical },
  { state: 'AUDIT', label: '双重校验', icon: ShieldCheck },
  { state: 'REPORT', label: '审查报告', icon: ListChecks },
];

export function StateStepper({ session }: { session: SessionContext | null }) {
  const current = session?.workflow.state ?? 'INPUT';
  const index = current === 'INPUT' ? 0 : steps.findIndex((step) => step.state === current);
  return (
    <div className="stepper-shell" aria-label="Agent 状态流转">
      <ol className="stepper">
        {steps.map((step, stepIndex) => {
          const active = step.state === current || (step.state === 'PARSE' && current === 'INPUT');
          const complete = stepIndex < index;
          const skipped = step.state === 'CLARIFY' && index > 1 && session?.clarificationRounds.length === 0;
          const error = active && session?.workflow.status === 'error';
          const Icon = step.icon;
          return (
            <li key={step.state} className={`step ${active ? 'active' : ''} ${complete || skipped ? 'complete' : ''} ${error ? 'error' : ''}`} aria-current={active ? 'step' : undefined}>
              <span className="step-icon">
                {error ? <CircleAlert size={18} /> : complete || skipped ? <Check size={18} /> : <Icon size={18} />}
              </span>
              <span><strong>{step.label}</strong><small>
                {error ? '可单步重试' : skipped ? '信息完整，已跳过' : step.state === 'CLARIFY' && session?.clarificationRounds.length ? `追问 ×${session.clarificationRounds.length}` : step.state === 'GENERATE' && session?.audit.retryCount ? `自动重写 ${session.audit.retryCount} 次` : active ? '当前阶段' : complete ? '已完成' : '等待'}
              </small></span>
            </li>
          );
        })}
      </ol>
      {session && (
        <div className="flow-strip">
          <span className="live-dot" />
          {session.trace.slice(-2).map((event) => <span key={event.id}>{event.message}</span>)}
        </div>
      )}
    </div>
  );
}
