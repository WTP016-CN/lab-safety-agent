import { Beaker, BookOpenCheck, ChevronRight, FlaskConical, History, Plus, Settings2, ShieldCheck } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useWorkflow } from './agent/useWorkflow';
import { ClarifyStage } from './components/ClarifyStage';
import { HistoryDrawer } from './components/HistoryDrawer';
import { InputStage } from './components/InputStage';
import { ModelSettingsDialog } from './components/ModelSettingsDialog';
import { ProcessStage } from './components/ProcessStage';
import { ReportStage } from './components/ReportStage';
import { StateStepper } from './components/StateStepper';
import { deleteReview, loadHistory, loadMockMode, loadSettings, saveMockMode, saveReview, saveSettings } from './utils/storage';
import type { ModelSettings } from './agent/types';

export default function App() {
  const [settings, setSettings] = useState<ModelSettings>(loadSettings);
  const [mockMode, setMockMode] = useState(loadMockMode);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState(loadHistory);
  const [saved, setSaved] = useState(false);
  const openSettings = useCallback(() => setSettingsOpen(true), []);
  const { session, start, submitClarification, retry, reset, commit } = useWorkflow(settings, mockMode, openSettings);

  useEffect(() => { if (session?.workflow.state === 'REPORT') setSaved(history.some((item) => item.id === session.id)); }, [history, session]);

  const newReview = () => { if (!session || window.confirm('新建审查将离开当前报告，未保存的内容不会保留。是否继续？')) { reset(); setSaved(false); } };
  const openReport = (review: (typeof history)[number]) => { commit(review.session); setHistoryOpen(false); };

  return <div className="app-shell">
    <header className="app-header no-print"><div className="header-inner"><button className="brand" onClick={newReview} aria-label="SafeBeaker 首页"><span className="brand-mark"><Beaker size={23} /></span><span><strong>Safe<span>Beaker</span></strong><small>环工实验安全与危废处置助手</small></span></button><div className="header-actions"><label className="mock-toggle"><input type="checkbox" checked={mockMode} onChange={(e) => { setMockMode(e.target.checked); saveMockMode(e.target.checked); if (!e.target.checked && !settings.apiKey) setSettingsOpen(true); }} /><span className="toggle-track" /><span>离线演示</span></label><span className="header-divider" /><button className="header-button" onClick={() => setHistoryOpen(true)}><History size={17} /><span>历史</span></button><button className="header-button" onClick={() => setSettingsOpen(true)}><Settings2 size={17} /><span>模型设置</span></button>{session && <button className="new-button" onClick={newReview}><Plus size={17} /> 新建审查</button>}</div></div></header>
    <div className="mode-banner no-print"><span className={mockMode ? 'demo' : 'live'} />{mockMode ? '离线演示模式 · 无需联网，完整展示 Agent 状态流转' : `真实模型模式 · ${settings.model}`}<span className="mode-note">辅助审查，不替代 EHS 审批</span></div>
    <main className="main-content"><div className="no-print"><StateStepper session={session} /></div><div className="workspace"><div className="main-stage">
      {!session && <InputStage settings={settings} mockMode={mockMode} onStart={start} disabled={false} />}
      {session?.workflow.state === 'PARSE' && <ProcessStage session={session} onRetry={retry} />}
      {session?.workflow.state === 'CLARIFY' && <ClarifyStage session={session} onSubmit={submitClarification} onRetry={retry} />}
      {(session?.workflow.state === 'GENERATE' || session?.workflow.state === 'AUDIT') && <ProcessStage session={session} onRetry={retry} />}
      {session?.workflow.state === 'REPORT' && <ReportStage session={session} saved={saved} onSave={() => setHistory(saveReview(session))} />}
    </div>{session && session.workflow.state !== 'REPORT' && <aside className="session-rail no-print"><div className="rail-heading"><BookOpenCheck size={18} /><strong>会话上下文</strong><span>LIVE</span></div><div className="rail-section"><span>实验名称</span><strong>{session.input.name}</strong></div><div className="rail-section"><span>Agent 状态</span><div className="context-state"><span className="live-dot" />{session.workflow.state}<ChevronRight size={14} /></div></div>{session.parse && <div className="rail-section"><span>识别到 {session.parse.reagents.length} 种试剂</span><div className="reagent-chips">{session.parse.reagents.slice(0, 6).map((reagent) => <span key={reagent.name}>{reagent.name}</span>)}</div></div>}<div className="rail-section trace-timeline"><span>最近流转</span>{session.trace.slice(-5).reverse().map((event) => <div key={event.id}><i /><p>{event.message}<small>{new Date(event.at).toLocaleTimeString('zh-CN')}</small></p></div>)}</div><div className="rail-foot"><ShieldCheck size={15} /> 原始输入与追问持续保留</div></aside>}</div></main>
    <footer className="app-footer no-print"><span><FlaskConical size={14} /> SafeBeaker · 为环境科学实验而生</span><span>规则 + AI 双引擎 · 全链路可追溯</span></footer>
    <ModelSettingsDialog initial={settings} open={settingsOpen} onClose={() => setSettingsOpen(false)} onSave={(next) => { setSettings(next); saveSettings(next); }} />
    <HistoryDrawer open={historyOpen} history={history} onClose={() => setHistoryOpen(false)} onOpen={openReport} onDelete={(id) => setHistory(deleteReview(id))} />
  </div>;
}
