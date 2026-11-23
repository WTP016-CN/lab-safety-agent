import { Clock3, FileText, Trash2, X } from 'lucide-react';
import type { SavedReview } from '../utils/storage';
import { RiskBadge } from './ui';

export function HistoryDrawer({ open, history, onClose, onOpen, onDelete }: { open: boolean; history: SavedReview[]; onClose: () => void; onOpen: (review: SavedReview) => void; onDelete: (id: string) => void }) {
  if (!open) return null;
  return <div className="drawer-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}><aside className="history-drawer"><div className="drawer-header"><div><h2>历史审查</h2><p>保存在此浏览器 · 最多 30 份</p></div><button className="icon-button" onClick={onClose}><X size={20} /></button></div>{history.length === 0 ? <div className="empty-history"><FileText size={34} /><strong>暂无历史报告</strong><p>在报告页点击“保存历史”即可留存。</p></div> : <div className="history-list">{history.map((review) => <article key={review.id}><RiskBadge risk={review.riskLevel} /><h3>{review.name}</h3><span><Clock3 size={13} />{new Date(review.savedAt).toLocaleString('zh-CN')}</span><div><button className="secondary" onClick={() => onOpen(review)}>打开报告</button><button className="icon-button danger" onClick={() => onDelete(review.id)} aria-label="删除历史"><Trash2 size={16} /></button></div></article>)}</div>}</aside></div>;
}
