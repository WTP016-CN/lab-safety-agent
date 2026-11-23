import { Activity, CircleDot, FlaskConical, ShieldAlert, Timer } from 'lucide-react';
import type { SessionContext } from '../agent/types';

const riskText = { low: '低危', medium: '中危', high: '高危' } as const;

function timeOnly(value: string) {
  return new Date(value).toLocaleTimeString('zh-CN', { hour12: false });
}

export function SessionRail({ session }: { session: SessionContext }) {
  const risk = session.draft?.riskLevel ?? session.parse?.initialRisk;
  return (
    <aside className="space-y-4 no-print">
      <section className="panel p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="section-kicker">会话摘要</h2>
          <CircleDot size={14} className={session.workflow.status === 'running' ? 'animate-pulse text-teal-600' : 'text-slate-400'} />
        </div>
        <p className="line-clamp-2 text-[13px] font-semibold leading-5 text-slate-800">
          {session.input.name || '待填写实验名称'}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {risk && <span className={`risk-pill risk-${risk}`}>初判 · {riskText[risk]}</span>}
          <span className="soft-pill"><Timer size={11} />{timeOnly(session.updatedAt)}</span>
        </div>
      </section>

      <section className="panel p-4">
        <div className="mb-3 flex items-center gap-2">
          <FlaskConical size={14} className="text-teal-700" />
          <h2 className="section-kicker">已识别试剂</h2>
          <span className="ml-auto text-xs font-semibold text-slate-400">{session.parse?.reagents.length ?? 0}</span>
        </div>
        {session.parse?.reagents.length ? (
          <ul className="space-y-2">
            {session.parse.reagents.slice(0, 7).map((reagent) => (
              <li key={reagent.name} className="rounded-lg border border-slate-100 bg-slate-50/80 px-2.5 py-2">
                <div className="flex items-start gap-2">
                  <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-teal-500" />
                  <div className="min-w-0">
                    <p className="text-xs font-medium leading-4 text-slate-700">{reagent.name}</p>
                    {(reagent.concentration || reagent.cas) && (
                      <p className="mt-0.5 truncate text-[10px] text-slate-400">
                        {[reagent.concentration, reagent.cas && `CAS ${reagent.cas}`].filter(Boolean).join(' · ')}
                      </p>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs leading-5 text-slate-400">提交实验信息后，将在这里显示结构化试剂属性。</p>
        )}
      </section>

      <section className="panel p-4">
        <div className="mb-3 flex items-center gap-2">
          <Activity size={14} className="text-teal-700" />
          <h2 className="section-kicker">流转日志</h2>
        </div>
        <ol className="trace-list">
          {session.trace.slice(-7).reverse().map((event) => (
            <li key={event.id}>
              <span className="trace-time">{timeOnly(event.at)}</span>
              <span className="trace-copy">{event.message}</span>
            </li>
          ))}
        </ol>
      </section>

      {session.audit.requiresManualReview && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-[11px] leading-5 text-amber-800">
          <div className="mb-1 flex items-center gap-1.5 font-semibold">
            <ShieldAlert size={14} /> 人工复核待办
          </div>
          自动审核已达到重写上限，请在开展实验前交由指导教师或 EHS 人员确认。
        </div>
      )}
    </aside>
  );
}
