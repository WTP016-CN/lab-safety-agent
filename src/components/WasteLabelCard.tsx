import {
  Atom,
  CircleAlert,
  Droplets,
  Flame,
  FlaskConical,
  Recycle,
  Skull,
  TriangleAlert,
} from 'lucide-react';
import type { HazardTag, WasteStream } from '../agent/types';

const categoryNames: Record<WasteStream['category'], string> = {
  inorganic_acid: '无机酸性废液',
  alkali: '碱性废液',
  heavy_metal: '含重金属废液',
  chromium: '含铬专项废液',
  mercury: '含汞专项废液',
  fluoride: '含氟废液',
  cyanide: '含氰废液',
  sulfide: '含硫化物废液',
  halogenated_organic: '含卤有机废液',
  non_halogenated_organic: '非卤有机废液',
  contaminated_solid: '沾染危废固体',
  other: '其他实验废液',
};

const hazardNames: Partial<Record<HazardTag, string>> = {
  strong_acid: '腐蚀',
  concentrated_sulfuric_acid: '强腐蚀',
  strong_base: '强碱',
  strong_oxidizer: '强氧化',
  organic_reducer: '还原性',
  cyanide: '剧毒 · 遇酸放气',
  sulfide: '遇酸放气',
  fluoride: '氟化物',
  hydrofluoric_acid: 'HF 剧毒',
  mercury: '汞污染',
  chromium_vi: '六价铬',
  heavy_metal: '重金属',
  halogenated_organic: '含卤有机',
  nonhalogenated_organic: '有机废液',
};

function HazardIcon({ tag }: { tag: HazardTag }) {
  if (tag === 'mercury' || tag === 'cyanide' || tag === 'hydrofluoric_acid') return <Skull size={14} />;
  if (tag === 'strong_oxidizer') return <Flame size={14} />;
  if (tag === 'chromium_vi') return <Atom size={14} />;
  if (tag === 'strong_acid' || tag === 'concentrated_sulfuric_acid') return <FlaskConical size={14} />;
  return <TriangleAlert size={14} />;
}

export function WasteLabelCard({ stream, experimentName }: { stream: WasteStream; experimentName: string }) {
  return (
    <article className="waste-label">
      <div className="flex items-start justify-between border-b-2 border-slate-800 pb-2">
        <div>
          <p className="text-[9px] font-bold uppercase tracking-[0.18em] text-slate-500">实验室危险废物</p>
          <h4 className="mt-0.5 text-sm font-black text-slate-900">{categoryNames[stream.category]}</h4>
        </div>
        <Recycle size={22} className="text-slate-700" />
      </div>
      <div className="mt-2.5 grid grid-cols-2 gap-x-3 gap-y-2 text-[10px]">
        <div className="col-span-2">
          <p className="label-field">废液桶标签</p>
          <p className="font-bold leading-4 text-slate-900">{stream.bucketLabel}</p>
        </div>
        <div className="col-span-2">
          <p className="label-field">主要成分</p>
          <p className="leading-4 text-slate-700">{stream.mainComponents.join('、')}</p>
        </div>
        <div>
          <p className="label-field">来源实验</p>
          <p className="line-clamp-2 leading-4 text-slate-700">{experimentName}</p>
        </div>
        <div>
          <p className="label-field">容器 / 储存</p>
          <p className="leading-4 text-slate-700">{stream.containerSpec}</p>
          <p className="mt-0.5 text-[9px] text-slate-500">{stream.storageNotes}</p>
        </div>
      </div>
      <div className="mt-2.5 flex flex-wrap gap-1">
        {stream.hazardTags.slice(0, 5).map((tag) => (
          <span key={tag} className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-1.5 py-0.5 text-[9px] font-semibold text-slate-700">
            <HazardIcon tag={tag} /> {hazardNames[tag] ?? tag}
          </span>
        ))}
      </div>
      <div className="mt-2.5 border-t border-dashed border-slate-300 pt-2">
        <p className="flex items-center gap-1 text-[9px] font-bold text-red-700"><CircleAlert size={11} /> 严禁混入</p>
        <p className="mt-0.5 text-[9px] leading-3.5 text-slate-700">{stream.forbiddenItems.join('；')}</p>
      </div>
      <div className="mt-2 flex items-center justify-between border-t-2 border-slate-800 pt-1.5 text-[8px] text-slate-500">
        <span className="flex items-center gap-1"><Droplets size={10} /> 满 3/4 即封盖</span>
        <span>SafeBeaker · 辅助标签</span>
      </div>
    </article>
  );
}

export { categoryNames, hazardNames };
