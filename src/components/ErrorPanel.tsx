import { CircleAlert, RefreshCw } from 'lucide-react';
import type { StepError } from '../agent/types';

export function ErrorPanel({ error, onRetry }: { error: StepError; onRetry: () => void }) {
  return <div className="error-panel" role="alert"><CircleAlert size={22} /><div><strong>{error.message}</strong><p>当前上下文已保留，可以只重试本步骤。</p>{error.detail && <details><summary>技术详情</summary><code>{error.detail}</code></details>}</div><button className="secondary" onClick={onRetry}><RefreshCw size={16} /> 单步重试</button></div>;
}
