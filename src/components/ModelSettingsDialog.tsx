import { ExternalLink, Eye, EyeOff, KeyRound, Loader2, RefreshCw, Settings2, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react';
import { fetchModelIds } from '../agent/llmClient';
import type { ModelSettings } from '../agent/types';
import { DEFAULT_SETTINGS } from '../utils/storage';

const providers = [
  { name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/chat/completions', model: 'deepseek-flash' },
  { name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  { name: '硅基流动', baseUrl: 'https://api.siliconflow.cn/v1', model: 'deepseek-flash' },
];

type ModelStatus = { state: 'idle' | 'loading' | 'success' | 'error'; message?: string };

export function ModelSettingsDialog({ initial, open, onClose, onSave }: { initial: ModelSettings; open: boolean; onClose: () => void; onSave: (settings: ModelSettings) => void }) {
  const [settings, setSettings] = useState(initial);
  const [showKey, setShowKey] = useState(false);
  const [models, setModels] = useState<string[]>([]);
  const [modelStatus, setModelStatus] = useState<ModelStatus>({ state: 'idle' });
  const loadIdRef = useRef(0);

  // Discard unsaved edits: every time the dialog opens it starts from the saved settings.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (open) { setSettings(initial); setShowKey(false); } }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  const loadModels = useCallback((baseUrl: string, apiKey: string) => {
    const loadId = ++loadIdRef.current;
    setModels([]);
    setModelStatus({ state: 'loading', message: '正在拉取模型列表…' });
    fetchModelIds({ baseUrl, apiKey })
      .then((ids) => {
        if (loadId !== loadIdRef.current) return;
        setModels(ids);
        setModelStatus({ state: 'success', message: `已获取 ${ids.length} 个可用模型` });
      })
      .catch((error: unknown) => {
        if (loadId !== loadIdRef.current) return;
        setModelStatus({ state: 'error', message: error instanceof Error ? error.message : '拉取模型列表失败' });
      });
  }, []);

  useEffect(() => {
    if (!open || !settings.apiKey.trim() || !settings.baseUrl.trim()) return;
    const timer = setTimeout(() => loadModels(settings.baseUrl, settings.apiKey), 500);
    return () => clearTimeout(timer);
  }, [open, settings.apiKey, settings.baseUrl, loadModels]);

  const refreshModels = () => loadModels(settings.baseUrl, settings.apiKey);

  const selectModel = (event: ChangeEvent<HTMLInputElement>) => {
    setSettings({ ...settings, model: event.target.value });
  };

  if (!open) return null;
  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <section className="modal card" role="dialog" aria-modal="true" aria-labelledby="settings-title">
        <div className="modal-header">
          <span className="form-icon"><Settings2 size={20} /></span>
          <div><h2 id="settings-title">模型设置</h2><p>连接任意 OpenAI-Compatible API</p></div>
          <button className="icon-button" onClick={onClose} aria-label="关闭"><X size={20} /></button>
        </div>
        <div className="provider-tabs">
          {providers.map((provider) => (
            <button className={settings.baseUrl === provider.baseUrl ? 'selected' : ''} key={provider.name} onClick={() => setSettings({ ...settings, baseUrl: provider.baseUrl, model: provider.model })}>{provider.name}</button>
          ))}
        </div>
        <label className="field">
          <span>Base URL</span>
          <input value={settings.baseUrl} onChange={(e) => setSettings({ ...settings, baseUrl: e.target.value })} placeholder="https://api.deepseek.com/chat/completions" />
          <small>可填写 API 根地址，自动拼接 /chat/completions；也可直接填写完整端点</small>
        </label>
        <label className="field">
          <span>Model Name<button type="button" className="models-refresh" onClick={refreshModels} disabled={modelStatus.state === 'loading' || !settings.apiKey.trim() || !settings.baseUrl.trim()}>{modelStatus.state === 'loading' ? <Loader2 size={13} className="spin" /> : <RefreshCw size={13} />}拉取模型</button></span>
          <input value={settings.model} onChange={selectModel} placeholder="deepseek-flash" list="safebeaker-models" />
          <datalist id="safebeaker-models">{models.map((model) => <option key={model} value={model} />)}</datalist>
          {modelStatus.message && <small className={`models-status ${modelStatus.state}`}>{modelStatus.message}</small>}
        </label>
        <label className="field">
          <span>API Key</span>
          <div className="key-input"><KeyRound size={17} /><input type={showKey ? 'text' : 'password'} value={settings.apiKey} onChange={(e) => setSettings({ ...settings, apiKey: e.target.value })} placeholder="sk-…" autoComplete="off" /><button onClick={() => setShowKey(!showKey)} aria-label={showKey ? '隐藏密钥' : '显示密钥'}>{showKey ? <EyeOff size={17} /> : <Eye size={17} />}</button></div>
          <small>仅保存在当前浏览器的 localStorage，不会写入报告或日志</small>
        </label>
        <div className="settings-note">纯前端调用需要模型服务商允许浏览器跨域访问；请勿在公共设备保存个人密钥。</div>
        <div className="modal-footer">
          <button className="text-button" onClick={() => setSettings(DEFAULT_SETTINGS)}><ExternalLink size={14} /> 恢复默认</button>
          <button className="primary" onClick={() => { onSave(settings); onClose(); }}>保存设置</button>
        </div>
      </section>
    </div>
  );
}
