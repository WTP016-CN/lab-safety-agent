import { ArrowRight, Beaker, CheckCircle2, CircleAlert, FileText, FileUp, FlaskConical, Loader2, Mountain, RefreshCw, ShieldCheck, Waves } from 'lucide-react';
import { useRef, useState, type ChangeEvent } from 'react';
import { PRESETS } from '../data/presets';
import type { ExperimentInput, ModelSettings } from '../agent/types';
import type { PdfExtractResult } from '../utils/pdfExtract';
import { loadMockMode, loadSettings } from '../utils/storage';

const presetIcons = { flask: FlaskConical, mountain: Mountain, waves: Waves };

const EMPTY_INPUT: ExperimentInput = { name: '', procedure: '', reagentListText: '' };

type PdfStatus =
  | { state: 'loading'; message: string }
  | { state: 'success'; message: string; detail: string }
  | { state: 'error'; message: string; detail?: string };

interface InputStageProps {
  onStart: (input: ExperimentInput) => void;
  disabled: boolean;
  settings?: ModelSettings;
  mockMode?: boolean;
  input?: ExperimentInput;
  onInput?: (input: ExperimentInput) => void;
}

export function InputStage({ onStart, disabled, settings, mockMode, input, onInput }: InputStageProps) {
  const [internalInput, setInternalInput] = useState<ExperimentInput>(EMPTY_INPUT);
  const [presetId, setPresetId] = useState<string>();
  const [pdfStatus, setPdfStatus] = useState<PdfStatus | null>(null);
  const lastFileRef = useRef<File | null>(null);
  const controlled = input !== undefined && onInput !== undefined;
  const currentInput = controlled && input ? input : internalInput;
  const inputRef = useRef(currentInput);
  inputRef.current = currentInput;

  const effectiveSettings = settings ?? loadSettings();
  const effectiveMockMode = mockMode ?? storedMockMode();
  const canUsePdf = !effectiveMockMode && Boolean(effectiveSettings.apiKey.trim());
  const pdfLoading = pdfStatus?.state === 'loading';
  const valid = Boolean(currentInput.name.trim() && currentInput.procedure.trim() && currentInput.reagentListText.trim());

  const updateInput = (next: ExperimentInput) => {
    setInternalInput(next);
    onInput?.(next);
  };

  const importPdf = async (file: File) => {
    if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') {
      setPdfStatus({ state: 'error', message: '请选择 PDF 文件。' });
      return;
    }

    lastFileRef.current = file;
    setPdfStatus({ state: 'loading', message: '正在读取 PDF…' });
    try {
      const { applyPdfExtraction, extractPdfContent } = await import('../utils/pdfExtract');
      const result = await extractPdfContent(file, {
        settings: effectiveSettings,
        onProgress: (message) => setPdfStatus({ state: 'loading', message }),
      });
      const base = inputRef.current;
      updateInput(applyPdfExtraction(base, result));
      lastFileRef.current = null;
      setPdfStatus({
        state: 'success',
        message: `已识别 ${result.pageCount} 页 · ${describeResult(result)}`,
        detail: describeSuccess(base, result),
      });
    } catch (error) {
      setPdfStatus({
        state: 'error',
        message: error instanceof Error && /[\u4e00-\u9fa5]/.test(error.message)
          ? error.message
          : 'PDF 识别失败，请重试或更换文件。',
        detail: readErrorDetail(error),
      });
    }
  };

  const onFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (file) void importPdf(file);
  };

  const retryImport = () => {
    const file = lastFileRef.current;
    if (file) void importPdf(file);
  };

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
            return <button className={`preset ${presetId === preset.id ? 'selected' : ''}`} key={preset.id} onClick={() => { updateInput({ name: preset.name, procedure: preset.procedure, reagentListText: preset.reagentListText }); setPresetId(preset.id); }}>
              <span className="preset-top"><span className="preset-icon"><Icon size={20} /></span><span className="preset-number">0{index + 1}</span></span>
              <strong>{preset.label}</strong><small>{preset.path}</small>
              <span className="preset-action">填入此用例 <ArrowRight size={14} /></span>
            </button>;
          })}
        </div>
      </section>
      <form className="card experiment-form" onSubmit={(event) => { event.preventDefault(); if (valid) onStart(currentInput); }}>
        <div className="form-heading"><span className="form-icon"><Beaker size={20} /></span><div><h2>新建安全审查</h2><p>请提供真实、完整的实验信息</p></div><span className="required-note">* 为必填项</span></div>
        {canUsePdf && <div className="pdf-import">
          <div className="pdf-import-head">
            <span className="pdf-import-icon"><FileUp size={19} /></span>
            <div className="pdf-import-copy"><strong>上传实验 PDF</strong><p>自动提取文字并填入下方表单，不会覆盖已有实验名称。</p></div>
            <label className={`secondary pdf-upload-button${pdfLoading ? ' disabled' : ''}`}>
              {pdfLoading ? <Loader2 size={15} className="spin" /> : <FileUp size={15} />}
              {pdfLoading ? '识别中…' : '选择 PDF'}
              <input type="file" accept="application/pdf,.pdf" onChange={onFileChange} disabled={pdfLoading || disabled} />
            </label>
          </div>
          <p className="pdf-import-note">文本层可直接识别；扫描版会把关键页面渲染为图片，依赖所选模型支持视觉输入。PDF 与图片只在本机浏览器处理，或发送给你配置的模型，不会持久化保存，API Key 也不会写入识别结果。</p>
          {pdfStatus?.state === 'loading' && <div className="pdf-import-status loading" role="status" aria-live="polite"><Loader2 size={16} className="spin" /><div><strong>正在识别 PDF</strong><p>{pdfStatus.message}</p></div></div>}
          {pdfStatus?.state === 'success' && <div className="pdf-import-status success" role="status"><CheckCircle2 size={16} /><div><strong>{pdfStatus.message}</strong><p>{pdfStatus.detail}</p></div></div>}
          {pdfStatus?.state === 'error' && <div className="error-panel pdf-error" role="alert"><CircleAlert size={22} /><div className="error-panel-body"><strong>{pdfStatus.message}</strong><p>可以重试识别，或先手动填写表单。</p>{pdfStatus.detail && <details><summary>技术详情</summary><code>{pdfStatus.detail}</code></details>}<button type="button" className="secondary" onClick={retryImport}><RefreshCw size={16} /> 重试识别</button></div></div>}
        </div>}
        <label className="field"><span>实验名称 <b>*</b></span><input value={currentInput.name} onChange={(e) => updateInput({ ...currentInput, name: e.target.value })} placeholder="例如：重铬酸钾法测定水样 COD" /></label>
        <label className="field"><span>实验步骤 <b>*</b></span><textarea rows={5} value={currentInput.procedure} onChange={(e) => updateInput({ ...currentInput, procedure: e.target.value })} placeholder="描述操作流程，包括加热、消解、温度、时间和废液处理方式…" /></label>
        <label className="field"><span>拟用试剂清单 <b>*</b><small>每行一种，建议注明浓度、用量及 CAS</small></span><textarea rows={5} value={currentInput.reagentListText} onChange={(e) => updateInput({ ...currentInput, reagentListText: e.target.value })} placeholder={'重铬酸钾（0.25 mol/L，10.0 mL）\n浓硫酸（98%，约 30 mL）'} /></label>
        <div className="form-footer"><span><FileText size={15} /> AI 可能追问强酸浓度、加热方式及试剂规模</span><button className="primary" type="submit" disabled={!valid || disabled || pdfLoading}>开始智能审查 <ArrowRight size={18} /></button></div>
      </form>
    </div>
  );
}

function storedMockMode(): boolean {
  try {
    return loadMockMode();
  } catch {
    return true;
  }
}

function describeResult(result: PdfExtractResult): string {
  if (result.mode === 'vision') {
    const scope = result.visionPageCount < result.pageCount
      ? `扫描版视觉识别（前 ${result.visionPageCount} 页）`
      : '扫描版视觉识别';
    return scope;
  }
  if (result.mode === 'mixed') return '文本层 + 扫描页视觉识别';
  return '文本层识别';
}

function describeSuccess(input: ExperimentInput, result: PdfExtractResult): string {
  const notes: string[] = [];
  if (!input.name.trim() && result.title.trim()) notes.push('已填入识别到的实验名称');
  if (!input.name.trim() && !result.title.trim()) notes.push('未识别到实验名称，请手动补充');
  if (result.procedure.trim() && result.reagentListText.trim()) notes.push('实验步骤与试剂清单已合并，请核对后修改');
  else if (result.procedure.trim()) notes.push('已填入实验步骤；未能自动区分试剂清单，请手动整理');
  else if (result.reagentListText.trim()) notes.push('仅识别到试剂清单，请补充实验步骤');
  else notes.push('未识别到可用正文，请手动填写');
  if (result.mode === 'vision' && result.visionPageCount < result.pageCount) {
    notes.push(`扫描版共 ${result.pageCount} 页，当前识别前 ${result.visionPageCount} 页`);
  }
  return `${notes.join('；')}。`;
}

function readErrorDetail(error: unknown): string | undefined {
  if (error && typeof error === 'object' && 'detail' in error) {
    const detail = (error as { detail?: unknown }).detail;
    return typeof detail === 'string' ? detail : undefined;
  }
  return undefined;
}
