import { ArrowRight, Beaker, FileText, FlaskConical, Mountain, ShieldCheck, Waves } from 'lucide-react';
import { useState } from 'react';
import { PRESETS } from '../data/presets';
import type { ExperimentInput } from '../agent/types';

const presetIcons = { flask: FlaskConical, mountain: Mountain, waves: Waves };

export function InputStage({ onStart, disabled }: { onStart: (input: ExperimentInput) => void; disabled: boolean }) {
  const [input, setInput] = useState<ExperimentInput>({ name: '', procedure: '', reagentListText: '' });
  const [presetId, setPresetId] = useState<string>();
  const valid = input.name.trim() && input.procedure.trim() && input.reagentListText.trim();

  return (
    <div className="input-stage">
      <section className="hero">
        <span className="eyebrow"><ShieldCheck size={14} /> AI AGENT · 双重安全校验</span>
        <h1>让每一步实验，<br /><span>都有清晰的安全依据。</span></h1>
        <p>从试剂解析到危废入桶，由多步 Agent 识别风险、主动追问，并通过本地规则与独立 AI 交叉校验。</p>
      </section>
      <section className="presets" aria-label="内置实验用例">
        <div className="section-heading"><span>快速体验</span><small>选择一个经典环工实验，一键填入</small></div>
        <div className="preset-grid">
          {PRESETS.map((preset, index) => {
            const Icon = presetIcons[preset.icon as keyof typeof presetIcons];
            return <button className={`preset ${presetId === preset.id ? 'selected' : ''}`} key={preset.id} onClick={() => { setInput({ name: preset.name, procedure: preset.procedure, reagentListText: preset.reagentListText }); setPresetId(preset.id); }}>
              <span className="preset-top"><span className="preset-icon"><Icon size={20} /></span><span className="preset-number">0{index + 1}</span></span>
              <strong>{preset.label}</strong><small>{preset.path}</small>
              <span className="preset-action">填入此用例 <ArrowRight size={14} /></span>
            </button>;
          })}
        </div>
      </section>
      <form className="card experiment-form" onSubmit={(event) => { event.preventDefault(); if (valid) onStart(input); }}>
        <div className="form-heading"><span className="form-icon"><Beaker size={20} /></span><div><h2>新建安全审查</h2><p>请提供真实、完整的实验信息</p></div><span className="required-note">* 为必填项</span></div>
        <label className="field"><span>实验名称 <b>*</b></span><input value={input.name} onChange={(e) => setInput({ ...input, name: e.target.value })} placeholder="例如：重铬酸钾法测定水样 COD" /></label>
        <label className="field"><span>实验步骤 <b>*</b></span><textarea rows={5} value={input.procedure} onChange={(e) => setInput({ ...input, procedure: e.target.value })} placeholder="描述操作流程，包括加热、消解、温度、时间和废液处理方式…" /></label>
        <label className="field"><span>拟用试剂清单 <b>*</b><small>每行一种，建议注明浓度、用量及 CAS</small></span><textarea rows={5} value={input.reagentListText} onChange={(e) => setInput({ ...input, reagentListText: e.target.value })} placeholder={'重铬酸钾（0.25 mol/L，10.0 mL）\n浓硫酸（98%，约 30 mL）'} /></label>
        <div className="form-footer"><span><FileText size={15} /> AI 可能追问强酸浓度、加热方式及试剂规模</span><button className="primary" type="submit" disabled={!valid || disabled}>开始智能审查 <ArrowRight size={18} /></button></div>
      </form>
    </div>
  );
}
