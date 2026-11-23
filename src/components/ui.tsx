import { CircleAlert, ShieldAlert, ShieldCheck } from 'lucide-react';
import type { RiskLevel } from '../agent/types';

export function RiskBadge({ risk }: { risk: RiskLevel }) {
  const label = { low: '低危', medium: '中危', high: '高危' }[risk];
  const Icon = risk === 'low' ? ShieldCheck : risk === 'medium' ? ShieldAlert : CircleAlert;
  return <span className={`risk-badge ${risk}`}><Icon size={15} /> {label}</span>;
}
