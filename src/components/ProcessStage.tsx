import { Bot, Check, ClipboardCheck, Cpu, FileCheck2, LoaderCircle, RefreshCw, ShieldCheck, TriangleAlert } from 'lucide-react';
import type { SessionContext } from '../agent/types';
import { ErrorPanel } from './ErrorPanel';

export function ProcessStage({ session, onRetry }: { session: SessionContext; onRetry: () => void }) {
  const audit = session.workflow.state === 'AUDIT';
  const retrying = session.audit.retryCount > 0 && session.workflow.state === 'GENERATE';
  const previous = session.audit.history.at(-1);
  return <div className="process-stage card">
    <div className={`process-visual ${audit ? 'audit' : ''}`}><span className="orbit" /><span className="process-logo">{audit ? <ShieldCheck size={36} /> : <Cpu size={36} />}</span></div>
    <span className="eyebrow">AGENT WORKFLOW · {audit ? 'AUDIT' : 'GENERATE'}</span>
    <h2>{retrying ? `自动修正安全方案 · 第 ${session.audit.retryCount} 次` : audit ? '正在进行双重安全校验' : '正在编制安全审查方案'}</h2>
    <p>{retrying ? '已拦截潜在安全漏洞，修正指令已注入上下文' : audit ? '本地确定性规则与独立 AI 审核员正在交叉复核' : '整合实验条件与追问信息，生成 SOP 和危废分类方案'}</p>
    {retrying && previous && <div className="rewrite-notice"><TriangleAlert size={19} /><div><strong>发现 {previous.issues.length} 项待修正问题</strong>{previous.issues.slice(0, 3).map((issue) => <p key={issue}>{issue}</p>)}</div></div>}
    <div className="audit-grid">
      <div className={`audit-card ${audit ? 'active' : ''}`}><span><ClipboardCheck size={21} /></span><div><strong>本地规则引擎</strong><p>{audit ? '扫描配伍禁忌、专项收集及遗漏项' : '等待草稿生成'}</p></div>{audit ? <LoaderCircle className="spin" size={18} /> : <span className="waiting-dot" />}</div>
      <div className={`audit-card ${audit ? 'active' : ''}`}><span><Bot size={21} /></span><div><strong>独立 AI 审核员</strong><p>{audit ? '对照原始试剂清单复核方案' : '等待草稿生成'}</p></div>{audit ? <LoaderCircle className="spin" size={18} /> : <span className="waiting-dot" />}</div>
    </div>
    {!audit && <div className="generation-steps"><span><Check size={14} /> 合并会话上下文</span><span><RefreshCw size={14} /> 识别配伍与操作风险</span><span><FileCheck2 size={14} /> 划分危废收集类别</span></div>}
    {session.workflow.error && <ErrorPanel error={session.workflow.error} onRetry={onRetry} />}
    <small className="process-footnote">校验失败时将自动重写，最多 2 次；超过限制后标记人工复核</small>
  </div>;
}
