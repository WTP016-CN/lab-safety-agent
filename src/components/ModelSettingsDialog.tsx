import { ExternalLink, Eye, EyeOff, KeyRound, Loader2, RefreshCw, Settings2, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react';
import { fetchModelIds, isValidChatCompletionsUrl } from '../agent/llmClient';
import type { ModelSettings } from '../agent/types';
import { DEFAULT_SETTINGS } from '../utils/storage';

type ProviderMode = 'deepseek' | 'custom';
type ModelStatus = { state: 'idle' | 'loading' | 'success' | 'error'; message?: string };

const DEEPSEEK_URL = DEFAULT_SETTINGS.baseUrl;
const isDeepSeekUrl = (url: string) =>
  url.trim().replace(/\/+$/, '').toLowerCase() === DEEPSEEK_URL;

export function ModelSettingsDialog({ initial, open, onClose, onSave }: { initial: ModelSettings; open: boolean; onClose: () => void; onSave: (settings: ModelSettings) => void }) {
  const initialMode: ProviderMode = isDeepSeekUrl(initial.baseUrl) ? 'deepseek' : 'custom';
  const [mode, setMode] = useState<ProviderMode>(initialMode);
  const [settings, setSettings] = useState(initial);
  const [showKey, setShowKey] = useState(false);
  const [models, setModels] = useState<string[]>([]);
  const [modelStatus, setModelStatus] = useState<ModelStatus>({ state: 'idle' });
  const loadIdRef = useRef(0);
  const deepseekDraftRef = useRef<ModelSettings>(
    initialMode === 'deepseek' ? initial : DEFAULT_SETTINGS,
  );
  const customDraftRef = useRef<ModelSettings>(
    initialMode === 'custom' ? initial : { baseUrl: '', apiKey: '', model: '' },
  );

  // Discard unsaved edits: every time the dialog opens it starts from the saved settings.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!open) return;
    const nextMode: ProviderMode = isDeepSeekUrl(initial.baseUrl) ? 'deepseek' : 'custom';
    setMode(nextMode);
    setSettings(initial);
    setShowKey(false);
    setModels([]);
    setModelStatus({ state: 'idle' });
    deepseekDraftRef.current = nextMode === 'deepseek' ? initial : DEFAULT_SETTINGS;
    customDraftRef.current = nextMode === 'custom' ? initial : { baseUrl: '', apiKey: '', model: '' };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  const endpointValid = isValidChatCompletionsUrl(settings.baseUrl);
  const canFetchModels = endpointValid && Boolean(settings.apiKey.trim());
  const canSave = endpointValid && Boolean(settings.model.trim());

  const loadModels = useCallback((baseUrl: string, apiKey: string) => {
    const loadId = ++loadIdRef.current;
    setModels([]);
    setModelStatus({ state: 'loading', message: '正在拉取模型列表…' });
    fetchModelIds({ baseUrl, apiKey })
      .then((ids) => {
        if (loadId !== loadIdRef.current) return;
        setModels(ids);
        // Only auto-select a model when the field is blank; never overwrite user-entered models.
        setSettings((current) => {
          const trimmed = current.model.trim();
          if (trimmed) return current;
          const preferred = ids.find((id) => id === 'deepseek-flash') ?? ids[0];
          return preferred ? { ...current, model: preferred } : current;
        });
        setModelStatus({ state: 'success', message: `已获取 ${ids.length} 个可用模型` });
      })
      .catch((error: unknown) => {
        if (loadId !== loadIdRef.current) return;
        setModelStatus({ state: 'error', message: error instanceof Error ? error.message : '拉取模型列表失败' });
      });
  }, []);

  useEffect(() => {
    if (!open || !canFetchModels) return;
    const timer = setTimeout(() => loadModels(settings.baseUrl, settings.apiKey), 500);
    return () => clearTimeout(timer);
  }, [open, canFetchModels, settings.apiKey, settings.baseUrl, loadModels]);

  const switchMode = (nextMode: ProviderMode) => {
    if (nextMode === mode) {
      if (nextMode === 'deepseek') {
        setSettings((current) => ({
          ...current,
          baseUrl: DEEPSEEK_URL,
          model: current.model.trim() ? current.model : 'deepseek-flash',
        }));
      }
      return;
    }
    loadIdRef.current += 1;
    setModels([]);
    setModelStatus({ state: 'idle' });
    if (nextMode === 'deepseek') {
      customDraftRef.current = settings;
      const saved = deepseekDraftRef.current;
      setMode('deepseek');
      setSettings({
        baseUrl: DEEPSEEK_URL,
        model: saved.model.trim() ? saved.model : 'deepseek-flash',
        apiKey: saved.apiKey,
      });
    } else {
      deepseekDraftRef.current = settings;
      setMode('custom');
      setSettings(customDraftRef.current);
    }
  };

  const refreshModels = () => loadModels(settings.baseUrl, settings.apiKey);

  const selectModel = (event: ChangeEvent<HTMLInputElement>) => {
    setSettings({ ...settings, model: event.target.value });
  };

  const handleSave = () => {
    if (!canSave) return;
    onSave({
      baseUrl: settings.baseUrl.trim().replace(/\/+$/, ''),
      apiKey: settings.apiKey.trim(),
      model: settings.model.trim(),
    });
    onClose();
  };

  if (!open) return null;
  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <section className="modal card" role="dialog" aria-modal="true" aria-labelledby="settings-title">
        <div className="modal-header">
          <span className="form-icon"><Settings2 size={20} /></span>
          <div><h2 id="settings-title">模型设置</h2><p>DeepSeek 或第三方 OpenAI-Compatible API</p></div>
          <button className="icon-button" onClick={onClose} aria-label="关闭"><X size={20} /></button>
        </div>
        <div className="provider-tabs">
          <button type="button" className={mode === 'deepseek' ? 'selected' : ''} onClick={() => switchMode('deepseek')}>DeepSeek</button>
          <button type="button" className={mode === 'custom' ? 'selected' : ''} onClick={() => switchMode('custom')}>第三方 API 链接</button>
        </div>
        <label className="field">
          <span>API 地址（须填到 /chat/completions）</span>
          <input
            value={settings.baseUrl}
            onChange={(e) => setSettings({ ...settings, baseUrl: e.target.value })}
            placeholder={mode === 'deepseek' ? DEEPSEEK_URL : 'https://example.com/v1/chat/completions'}
          />
          {settings.baseUrl.trim() && !endpointValid
            ? <small className="models-status error">请输入完整的 http(s) 接口地址，且必须以 /chat/completions 结尾</small>
            : <small>所有接口均须完整填写到 /chat/completions（不会自动拼接路径）</small>}
        </label>
        <label className="field">
          <span>Model Name<button type="button" className="models-refresh" onClick={refreshModels} disabled={modelStatus.state === 'loading' || !canFetchModels}>{modelStatus.state === 'loading' ? <Loader2 size={13} className="spin" /> : <RefreshCw size={13} />}拉取模型</button></span>
          <input
            value={settings.model}
            onChange={selectModel}
            placeholder={mode === 'deepseek' ? 'deepseek-flash' : '输入或从右侧拉取模型 ID'}
            list="safebeaker-models"
          />
          <datalist id="safebeaker-models">{models.map((model) => <option key={model} value={model} />)}</datalist>
          {modelStatus.message && <small className={`models-status ${modelStatus.state}`}>{modelStatus.message}{modelStatus.state === 'success' && settings.model.trim() && models.length > 0 && !models.includes(settings.model.trim()) ? `（提示：当前填写的「${settings.model.trim()}」不在服务端列表中）` : ''}</small>}
        </label>
        <label className="field">
          <span>API Key</span>
          <div className="key-input"><KeyRound size={17} /><input type={showKey ? 'text' : 'password'} value={settings.apiKey} onChange={(e) => setSettings({ ...settings, apiKey: e.target.value })} placeholder="sk-…（请自行填写）" autoComplete="off" /><button type="button" onClick={() => setShowKey(!showKey)} aria-label={showKey ? '隐藏密钥' : '显示密钥'}>{showKey ? <EyeOff size={17} /> : <Eye size={17} />}</button></div>
          <small>仅保存在当前浏览器的 localStorage，不会写入报告或日志</small>
        </label>
        <div className="settings-note">纯前端调用需要模型服务商允许浏览器跨域访问；请勿在公共设备保存个人密钥。</div>
        <div className="modal-footer">
          <button type="button" className="text-button" onClick={() => { loadIdRef.current += 1; setMode('deepseek'); setSettings(DEFAULT_SETTINGS); deepseekDraftRef.current = DEFAULT_SETTINGS; setModels([]); setModelStatus({ state: 'idle' }); }}><ExternalLink size={14} /> 恢复默认</button>
          <button type="button" className="primary" onClick={handleSave} disabled={!canSave}>保存设置</button>
        </div>
      </section>
    </div>
  );
}
