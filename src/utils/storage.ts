import type { ModelSettings, SessionContext } from '../agent/types';

const SETTINGS_KEY = 'safebeaker.model-settings.v1';
const MOCK_KEY = 'safebeaker.mock-mode.v1';
const HISTORY_KEY = 'safebeaker.history.v1';

export const DEFAULT_SETTINGS: ModelSettings = {
  baseUrl: 'https://api.deepseek.com/v1',
  apiKey: '',
  model: 'deepseek-flash',
};

export function loadSettings(): ModelSettings {
  try {
    const value = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? 'null') as Partial<ModelSettings> | null;
    if (!value) return DEFAULT_SETTINGS;
    return {
      baseUrl: typeof value.baseUrl === 'string' ? value.baseUrl : DEFAULT_SETTINGS.baseUrl,
      apiKey: typeof value.apiKey === 'string' ? value.apiKey : '',
      model: typeof value.model === 'string' ? value.model : DEFAULT_SETTINGS.model,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(settings: ModelSettings): void {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

export function loadMockMode(): boolean {
  const stored = localStorage.getItem(MOCK_KEY);
  return stored === null ? !loadSettings().apiKey : stored === 'true';
}

export function saveMockMode(enabled: boolean): void {
  localStorage.setItem(MOCK_KEY, String(enabled));
}

export interface SavedReview {
  id: string;
  name: string;
  savedAt: string;
  riskLevel: 'low' | 'medium' | 'high';
  session: SessionContext;
}

export function loadHistory(): SavedReview[] {
  try {
    const value = JSON.parse(localStorage.getItem(HISTORY_KEY) ?? '[]') as unknown;
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is SavedReview =>
      Boolean(item && typeof item === 'object' && 'session' in item && 'savedAt' in item),
    );
  } catch {
    return [];
  }
}

export function saveReview(session: SessionContext): SavedReview[] {
  const history = loadHistory().filter((item) => item.session.id !== session.id);
  const review: SavedReview = {
    id: session.id,
    name: session.input.name,
    savedAt: new Date().toISOString(),
    riskLevel: session.draft?.riskLevel ?? session.parse?.initialRisk ?? 'medium',
    session,
  };
  const next = [review, ...history].slice(0, 30);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
  return next;
}

export function deleteReview(id: string): SavedReview[] {
  const next = loadHistory().filter((item) => item.id !== id);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
  return next;
}
