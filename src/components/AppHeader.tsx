import { Beaker, FlaskConical, History, Settings2, ShieldCheck } from 'lucide-react';

interface AppHeaderProps {
  mockMode: boolean;
  hasApiKey: boolean;
  onToggleMock: () => void;
  onOpenSettings: () => void;
  onOpenHistory: () => void;
  onNewReview: () => void;
  busy: boolean;
}

export function AppHeader({
  mockMode,
  hasApiKey,
  onToggleMock,
  onOpenSettings,
  onOpenHistory,
  onNewReview,
  busy,
}: AppHeaderProps) {
  return (
    <header className="sticky top-0 z-30 border-b border-slate-200/80 bg-[#f7faf8]/90 backdrop-blur-xl no-print">
      <div className="mx-auto flex max-w-[1280px] flex-wrap items-center gap-3 px-4 py-3 sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <div className="logo-mark">
            <Beaker size={22} strokeWidth={2.2} />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="truncate text-[17px] font-bold tracking-tight text-slate-900">SafeBeaker</h1>
              <span className="hidden rounded-full border border-teal-200 bg-teal-50 px-2 py-0.5 text-[10px] font-semibold text-teal-700 sm:inline">
                多步安全审查
              </span>
            </div>
            <p className="truncate text-[11px] text-slate-500">环工实验安全与危废处置助手</p>
          </div>
        </div>

        <div className="ml-auto flex items-center gap-1.5">
          <label className={`mock-toggle ${mockMode ? 'mock-toggle-on' : ''}`} title="离线时使用内置确定性演示数据">
            <FlaskConical size={14} />
            <span className="hidden sm:inline">演示模式</span>
            <input
              type="checkbox"
              checked={mockMode}
              onChange={onToggleMock}
              aria-label="切换离线演示模式"
            />
            <span className="mock-track" aria-hidden="true"><span /></span>
          </label>
          {!hasApiKey && !mockMode && (
            <span className="hidden text-[10px] font-medium text-amber-700 md:inline">需配置 Key</span>
          )}
          <button className="icon-button" onClick={onOpenHistory} title="历史记录" type="button">
            <History size={18} />
            <span className="sr-only">历史记录</span>
          </button>
          <button className="icon-button" onClick={onOpenSettings} title="模型设置" type="button">
            <Settings2 size={18} />
            <span className="sr-only">模型设置</span>
          </button>
          <button className="btn-secondary hidden sm:inline-flex" onClick={onNewReview} disabled={busy} type="button">
            <ShieldCheck size={16} />
            新建审查
          </button>
        </div>
      </div>
    </header>
  );
}
