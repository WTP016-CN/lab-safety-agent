import { ArrowRight, History, Info, MessageCircleQuestion, ShieldAlert } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { ClarificationAnswer, SessionContext } from '../agent/types';
import { ErrorPanel } from './ErrorPanel';
import { RiskBadge } from './ui';

export function ClarifyStage({ session, onSubmit, onRetry }: { session: SessionContext; onSubmit: (answers: ClarificationAnswer[]) => void; onRetry: () => void }) {
  const round = session.clarificationRounds.at(-1)!;
  const [answers, setAnswers] = useState<ClarificationAnswer[]>([]);
  useEffect(() => { setAnswers(round.questions.map((question) => ({ questionId: question.id, value: [], supplement: '' }))); }, [round]);
  const busy = session.workflow.status === 'running';
  const complete = round.questions.every((question) => !question.required || answers.find((answer) => answer.questionId === question.id)?.value.length);

  return <div className="clarify-stage">
    <div className="stage-title"><span className="stage-symbol"><MessageCircleQuestion size={24} /></span><div><span className="eyebrow">CONTEXT CHECK · 第 {round.round} 轮追问</span><h2>先补充关键安全信息</h2><p>完整的信息是可靠审查的前提。回答后将自动重新评估。</p></div>{session.parse && <RiskBadge risk={session.parse.initialRisk} />}</div>
    <div className="notice"><Info size={18} /><span>{session.parse?.experimentSummary}</span></div>
    {session.clarificationRounds.length > 1 && <details className="history-qa"><summary><History size={16} /> 查看历史追问与回答</summary>{session.clarificationRounds.slice(0, -1).map((item) => <div key={item.round}>{item.questions.map((question) => <p key={question.id}><strong>{question.prompt}</strong><br />{item.answers.find((answer) => answer.questionId === question.id)?.value.join('、') || '未回答'} {item.answers.find((answer) => answer.questionId === question.id)?.supplement}</p>)}</div>)}</details>}
    <form className="card question-card" onSubmit={(event) => { event.preventDefault(); if (complete) onSubmit(answers); }}>
      {round.questions.map((question, index) => {
        const answer = answers.find((item) => item.questionId === question.id);
        const update = (next: Partial<ClarificationAnswer>) => setAnswers(answers.map((item) => item.questionId === question.id ? { ...item, ...next } : item));
        return <fieldset className="question" key={question.id}><legend><span>{index + 1}</span>{question.prompt}<b>*</b></legend><p className="rationale">{question.rationale}</p><div className="option-grid">{question.options.map((option) => <label className={`option ${answer?.value.includes(option.value) ? 'checked' : ''}`} key={option.value}><input type={question.control === 'single' ? 'radio' : 'checkbox'} name={`${round.round}-${question.id}`} checked={answer?.value.includes(option.value) ?? false} onChange={() => update({ value: question.control === 'single' ? [option.value] : answer?.value.includes(option.value) ? answer.value.filter((value) => value !== option.value) : [...(answer?.value ?? []), option.value] })} /><span>{option.label}</span></label>)}</div>{question.allowSupplement && <input className="supplement" value={answer?.supplement ?? ''} onChange={(e) => update({ supplement: e.target.value })} placeholder="补充说明（可选）：浓度、体积、设备型号等" />}</fieldset>;
      })}
      {session.workflow.error && <ErrorPanel error={session.workflow.error} onRetry={onRetry} />}
      <div className="form-footer"><span><ShieldAlert size={16} /> 不确定时请选择“不确定”，不要猜测实验条件</span><button className="primary" disabled={!complete || busy}>{busy ? <><span className="spinner" /> 正在重新评估…</> : <>提交并继续 <ArrowRight size={17} /></>}</button></div>
    </form>
  </div>;
}
