import type {
  AgentEngine,
  AiAuditResult,
  ExperimentInput,
  ModelSettings,
  ParseResult,
  SafetyDraft,
  SessionContext,
} from './types';
import {
  AgentOutputError,
  validateAiAuditResult,
  validateParseResult,
  validateSafetyDraft,
} from './schemas';
import {
  AUDIT_SYSTEM_PROMPT,
  CLARIFY_SYSTEM_PROMPT,
  GENERATE_SYSTEM_PROMPT,
  PARSE_SYSTEM_PROMPT,
  buildAuditUserPrompt,
  buildClarifyUserPrompt,
  buildGenerateUserPrompt,
  buildParseUserPrompt,
} from './prompts';

type ErrorCode =
  | 'timeout'
  | 'network'
  | 'auth'
  | 'rate_limit'
  | 'http'
  | 'invalid_json'
  | 'schema_validation'
  | 'unknown';

export class LlmRequestError extends Error {
  readonly code: ErrorCode;
  readonly retryable: boolean;
  readonly detail?: string;

  constructor(code: ErrorCode, message: string, retryable: boolean, detail?: string) {
    super(message);
    this.name = 'LlmRequestError';
    this.code = code;
    this.retryable = retryable;
    this.detail = detail;
  }
}

interface ChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string | Array<{ type?: string; text?: string }>;
    };
  }>;
  error?: { message?: string };
}

export interface LlmClientOptions {
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  onRequest?: (node: 'parse' | 'clarify' | 'generate' | 'audit') => void;
}

export function resolveChatCompletionsUrl(baseUrl: string): string {
  const base = baseUrl.trim().replace(/\/+$/, '');
  if (!base) {
    throw new LlmRequestError('auth', '请先配置 API Base URL。', false);
  }
  if (/\/chat\/completions$/i.test(base)) return base;
  return `${base}/chat/completions`;
}

function contentAsText(data: ChatCompletionResponse): string {
  const content = data.choices?.[0]?.message?.content;
  if (typeof content === 'string' && content.trim()) return content;
  if (Array.isArray(content)) {
    const text = content
      .map((part) => (part.type === 'text' ? part.text ?? '' : ''))
      .join('')
      .trim();
    if (text) return text;
  }
  throw new LlmRequestError(
    'invalid_json',
    '模型未返回可解析的文本内容，请重试本步骤。',
    true,
  );
}

export class LlmEngine implements AgentEngine {
  private readonly settings: ModelSettings;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly onRequest?: LlmClientOptions['onRequest'];

  constructor(settings: ModelSettings, options: LlmClientOptions = {}) {
    this.settings = {
      baseUrl: settings.baseUrl.trim(),
      apiKey: settings.apiKey.trim(),
      model: settings.model.trim(),
    };
    this.timeoutMs = options.timeoutMs ?? 75_000;
    this.fetchImpl = options.fetchImpl ?? window.fetch.bind(window);
    this.onRequest = options.onRequest;
  }

  async parse(input: ExperimentInput): Promise<ParseResult> {
    return this.runJsonNode('parse', PARSE_SYSTEM_PROMPT, buildParseUserPrompt(input), validateParseResult);
  }

  async clarify(context: SessionContext): Promise<ParseResult> {
    return this.runJsonNode(
      'clarify',
      CLARIFY_SYSTEM_PROMPT,
      buildClarifyUserPrompt(context),
      validateParseResult,
    );
  }

  async generate(context: SessionContext, correctionIssues: string[]): Promise<SafetyDraft> {
    return this.runJsonNode(
      'generate',
      GENERATE_SYSTEM_PROMPT,
      buildGenerateUserPrompt(context, correctionIssues),
      validateSafetyDraft,
      6500,
    );
  }

  async audit(context: SessionContext, draft: SafetyDraft): Promise<AiAuditResult> {
    return this.runJsonNode(
      'audit',
      AUDIT_SYSTEM_PROMPT,
      buildAuditUserPrompt(context, draft),
      validateAiAuditResult,
      2000,
    );
  }

  private async runJsonNode<T>(
    node: 'parse' | 'clarify' | 'generate' | 'audit',
    system: string,
    user: string,
    validate: (raw: string) => T,
    maxTokens = 3500,
  ): Promise<T> {
    if (!this.settings.apiKey) {
      throw new LlmRequestError('auth', '未配置 API Key，请打开模型设置或使用离线演示模式。', false);
    }
    if (!this.settings.model) {
      throw new LlmRequestError('auth', '未配置模型名称，请打开模型设置。', false);
    }

    this.onRequest?.(node);
    const raw = await this.request(system, user, maxTokens);
    try {
      return validate(raw);
    } catch (error) {
      if (error instanceof AgentOutputError) {
        throw new LlmRequestError(error.code, error.message, true, error.detail);
      }
      throw new LlmRequestError(
        'schema_validation',
        '模型结果校验失败，请重试本步骤。',
        true,
      );
    }
  }

  private async request(system: string, user: string, maxTokens: number): Promise<string> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this.fetchImpl(resolveChatCompletionsUrl(this.settings.baseUrl), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.settings.apiKey}`,
        },
        body: JSON.stringify({
          model: this.settings.model,
          temperature: 0.1,
          max_tokens: maxTokens,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
        }),
        signal: controller.signal,
      });

      const bodyText = await response.text();
      let body: ChatCompletionResponse = {};
      try {
        body = bodyText ? (JSON.parse(bodyText) as ChatCompletionResponse) : {};
      } catch {
        if (response.ok) {
          throw new LlmRequestError(
            'invalid_json',
            '模型服务返回了非 JSON 响应，请检查接口地址。',
            true,
          );
        }
      }

      if (!response.ok) {
        const serverMessage =
          body.error?.message?.slice(0, 300) || bodyText.slice(0, 300) || response.statusText;
        if (response.status === 401 || response.status === 403) {
          throw new LlmRequestError('auth', 'API 鉴权失败，请检查 API Key。', false, serverMessage);
        }
        if (response.status === 429) {
          throw new LlmRequestError(
            'rate_limit',
            '模型请求过于频繁，请稍后重试本步骤。',
            true,
            serverMessage,
          );
        }
        throw new LlmRequestError(
          'http',
          `模型接口返回 HTTP ${response.status}，请检查配置后重试。`,
          response.status >= 500,
          serverMessage,
        );
      }

      return contentAsText(body);
    } catch (error) {
      if (error instanceof LlmRequestError) throw error;
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw new LlmRequestError(
          'timeout',
          `模型请求超时（${Math.round(this.timeoutMs / 1000)} 秒），请重试本步骤。`,
          true,
        );
      }
      if (error instanceof TypeError) {
        throw new LlmRequestError(
          'network',
          '无法连接模型接口。请检查网络、Base URL 及浏览器的跨域设置。',
          true,
          error.message,
        );
      }
      throw new LlmRequestError(
        'unknown',
        '模型调用发生未知错误，请重试本步骤。',
        true,
        error instanceof Error ? error.message : undefined,
      );
    } finally {
      clearTimeout(timer);
    }
  }
}

export function createLlmEngine(settings: ModelSettings, options?: LlmClientOptions): LlmEngine {
  return new LlmEngine(settings, options);
}
