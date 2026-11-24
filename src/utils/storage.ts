import type { ModelSettings, SessionContext } from '../agent/types';

const SETTINGS_KEY = 'safebeaker.model-settings.v1';
const MOCK_KEY = 'safebeaker.mock-mode.v1';
const HISTORY_KEY = 'safebeaker.history.v1';
const MAX_HISTORY = 30;

export const DEFAULT_SETTINGS: ModelSettings = {
  baseUrl: 'https://api.deepseek.com/chat/completions',
  apiKey: '',
  model: 'deepseek-flash',
};

export class StorageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StorageError';
  }
}

function readItem(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeItem(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    throw new StorageError('浏览器本地存储不可用或空间不足，保存失败。可删除部分历史记录后重试。');
  }
}

export function loadSettings(): ModelSettings {
  try {
    const value = JSON.parse(readItem(SETTINGS_KEY) ?? 'null') as Partial<ModelSettings> | null;
    if (!value || typeof value !== 'object') return DEFAULT_SETTINGS;
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
  writeItem(SETTINGS_KEY, JSON.stringify(settings));
}

export function loadMockMode(): boolean {
  const stored = readItem(MOCK_KEY);
  return stored === null ? !loadSettings().apiKey : stored === 'true';
}

export function saveMockMode(enabled: boolean): void {
  writeItem(MOCK_KEY, String(enabled));
}

export interface SavedReview {
  id: string;
  name: string;
  savedAt: string;
  riskLevel: 'low' | 'medium' | 'high';
  session: SessionContext;
}

/** Rejects corrupted / outdated entries that would crash the report view. */
function isSavedReview(item: unknown): item is SavedReview {
  if (!item || typeof item !== 'object') return false;
  const review = item as Partial<SavedReview>;
  const session = review.session as Partial<SessionContext> | undefined;
  return typeof review.id === 'string'
    && typeof review.savedAt === 'string'
    && ['low', 'medium', 'high'].includes(review.riskLevel as string)
    && Boolean(session && typeof session === 'object')
    && typeof session?.id === 'string'
    && Boolean(session?.input && session.draft && session.audit && session.workflow)
    && Array.isArray(session?.trace);
}

export function loadHistory(): SavedReview[] {
  try {
    const value = JSON.parse(readItem(HISTORY_KEY) ?? '[]') as unknown;
    return Array.isArray(value) ? value.filter(isSavedReview) : [];
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
  // When the quota is exceeded, drop the oldest reviews until the new one fits.
  let next = [review, ...history].slice(0, MAX_HISTORY);
  for (;;) {
    try {
      writeItem(HISTORY_KEY, JSON.stringify(next));
      return next;
    } catch (error) {
      if (next.length <= 1) throw error;
      next = next.slice(0, -1);
    }
  }
}

export function deleteReview(id: string): SavedReview[] {
  const next = loadHistory().filter((item) => item.id !== id);
  writeItem(HISTORY_KEY, JSON.stringify(next));
  return next;
}
