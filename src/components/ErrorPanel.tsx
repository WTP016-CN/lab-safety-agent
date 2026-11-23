import { CircleAlert, RefreshCw } from 'lucide-react';
import type { StepError } from '../agent/types';

export function ErrorPanel({ error, onRetry }: { error: StepError; onRetry: () => void }) {
  return <div className="error-panel" role="alert">
    <CircleAlert size={18} aria-hidden="true" />
    <div className="error-panel-body">
      <strong>{error.message}</strong>
      <p>当前上下文已保留，可以只重试本步骤。</p>
      {error.detail && <details><summary>技术详情</summary><code>{error.detail}</code></details>}
      <button className="secondary" type="button" onClick={onRetry}><RefreshCw size={16} aria-hidden="true" /> 单步重试</button>
    </div>
  </div>;
}
