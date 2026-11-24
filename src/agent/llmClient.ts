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

interface ContentPart {
  type?: string;
  text?: string;
  content?: string;
  thought?: boolean;
}

interface ChoiceMessage {
  content?: string | ContentPart[] | null;
  reasoning_content?: string | null;
  reasoning?: string | null;
  refusal?: string | null;
}

interface ChatCompletionResponse {
  choices?: Array<{
    message?: ChoiceMessage;
    delta?: ChoiceMessage;
    text?: string;
    finish_reason?: string | null;
  }>;
  /** OpenAI Responses API (`/v1/responses`) compatibility. */
  output_text?: string;
  output?: Array<{
    type?: string;
    text?: string;
    content?: ContentPart[];
  }>;
  /** Anthropic `/v1/messages` or custom gateway top-level content. */
  content?: string | ContentPart[];
  /** Ollama `/api/chat` top-level message. */
  message?: ChoiceMessage;
  /** Gemini native `generateContent` compatibility. */
  candidates?: Array<{
    content?: { parts?: ContentPart[] };
    finishReason?: string;
  }>;
  error?: string | { message?: string; code?: string | number; type?: string };
  code?: number | string;
  msg?: string;
  base_resp?: { status_code?: number; status_msg?: string };
}

interface ModelsResponse {
  data?: Array<{ id?: string }>;
  error?: string | { message?: string };
}

export interface LlmClientOptions {
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  onRequest?: (node: 'parse' | 'clarify' | 'generate' | 'audit') => void;
  /** External cancellation (e.g. the user starts a new review while a request is in flight). */
  signal?: AbortSignal;
}

const isAbortError = (error: unknown): boolean =>
  error instanceof Error && error.name === 'AbortError';

const defaultFetch: typeof fetch = (...args) => globalThis.fetch(...args);

/** Models known to reject non-default `temperature` values (e.g. OpenAI o-series / gpt-5). */
const FIXED_TEMPERATURE_MODEL = /^(?:o1|o3|o4)(?:$|[-_])|^gpt-5/i;

export function resolveChatCompletionsUrl(baseUrl: string): string {
  const base = baseUrl.trim().replace(/\/+$/, '');
  if (!base) {
    throw new LlmRequestError('auth', '请先配置 API Base URL。', false);
  }
  if (/\/(?:chat\/completions|responses|messages)$/i.test(base)) return base;
  return `${base}/chat/completions`;
}

export function resolveModelsUrl(baseUrl: string): string {
  const base = baseUrl.trim().replace(/\/+$/, '');
  if (!base) {
    throw new LlmRequestError('auth', '请先填写 API 地址。', false);
  }
  if (/\/(?:chat\/completions|responses|messages)$/i.test(base)) {
    return base.replace(/\/(?:chat\/completions|responses|messages)$/i, '/models');
  }
  return `${base}/models`;
}

function partsAsText(parts: ContentPart[]): string {
  return parts
    .map((part) => {
      if (typeof part === 'string') return part;
      if (!part || typeof part !== 'object') return '';
      if (part.thought === true) return '';
      if (part.type === 'thinking' || part.type === 'reasoning' || part.type === 'redacted_thinking') {
        return '';
      }
      if (typeof part.text === 'string') return part.text;
      if (typeof part.content === 'string') return part.content;
      return '';
    })
    .join('')
    .trim();
}

function errorFromEnvelope(data: ChatCompletionResponse): string | null {
  if (typeof data.error === 'string' && data.error.trim()) return data.error.trim();
  if (data.error && typeof data.error === 'object') {
    const msg = data.error.message || (data.error.code ? String(data.error.code) : '');
    if (msg) return msg;
  }
  if (typeof data.code === 'number' && data.code !== 0 && data.code !== 200) {
    const msg = data.msg || (typeof (data as { message?: unknown }).message === 'string' ? (data as { message: string }).message : '');
    if (msg) return `${msg} (code ${data.code})`;
  }
  if (data.base_resp?.status_code && data.base_resp.status_code !== 0) {
    return data.base_resp.status_msg || `status_code ${data.base_resp.status_code}`;
  }
  return null;
}

/** Reassembles an OpenAI SSE (`data: {...}`) payload into a single response object. */
export function parseSseTranscript(raw: string): ChatCompletionResponse | null {
  const lines = raw.split(/\r?\n/);
  if (!lines.some((line) => line.startsWith('data:'))) return null;

  let content = '';
  let reasoning = '';
  let finishReason: string | null = null;
  let lastError: ChatCompletionResponse['error'];
  let parsedAny = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line.startsWith('data:')) continue;
    const payload = line.slice(5).trim();
    if (!payload || payload === '[DONE]') continue;
    try {
      const chunk = JSON.parse(payload) as ChatCompletionResponse & {
        type?: string;
        delta?: string;
      };
      parsedAny = true;
      if (chunk.error) lastError = chunk.error;

      // OpenAI Responses SSE (`response.output_text.delta`)
      if (chunk.type === 'response.output_text.delta' && typeof chunk.delta === 'string') {
        content += chunk.delta;
        continue;
      }

      const choice = chunk.choices?.[0];
      if (choice?.finish_reason) finishReason = choice.finish_reason;
      const delta = choice?.delta ?? choice?.message;
      if (typeof delta?.content === 'string') content += delta.content;
      else if (Array.isArray(delta?.content)) content += partsAsText(delta.content);
      else if (typeof choice?.text === 'string') content += choice.text;

      const deltaReasoning = delta?.reasoning_content ?? delta?.reasoning;
      if (typeof deltaReasoning === 'string') reasoning += deltaReasoning;
    } catch {
      // Ignore keepalive or partial comment lines.
    }
  }

  if (!parsedAny) return null;
  return {
    ...(lastError ? { error: lastError } : {}),
    choices: [
      {
        message: {
          content,
          ...(reasoning ? { reasoning_content: reasoning } : {}),
        },
        finish_reason: finishReason,
      },
    ],
  };
}

function summarizeDebug(url: string, status: number, bodyText: string, data: ChatCompletionResponse): string {
  const choice = data.choices?.[0];
  const finish = choice?.finish_reason ?? data.candidates?.[0]?.finishReason;
  const reasoning = choice?.message?.reasoning_content ?? choice?.message?.reasoning;
  const meta = [
    `HTTP ${status} (${url})`,
    finish ? `finish_reason=${finish}` : '',
    typeof reasoning === 'string' && reasoning.length > 0 ? `reasoning_chars=${reasoning.length}` : '',
  ].filter(Boolean).join(' · ');
  const preview = bodyText.replace(/\s+/g, ' ').trim().slice(0, 360);
  return preview ? `${meta} | 响应片段: ${preview}` : meta;
}

export function extractCompletionText(data: ChatCompletionResponse): string {
  const choice = data.choices?.[0];
  const content = choice?.message?.content ?? choice?.delta?.content;
  if (typeof content === 'string' && content.trim()) return content;
  if (Array.isArray(content)) {
    const text = partsAsText(content);
    if (text) return text;
  }
  if (typeof choice?.text === 'string' && choice.text.trim()) return choice.text;

  // OpenAI Responses API shapes
  if (typeof data.output_text === 'string' && data.output_text.trim()) return data.output_text;
  if (Array.isArray(data.output)) {
    const out = data.output
      .map((item) => {
        if (typeof item?.text === 'string') return item.text;
        if (Array.isArray(item?.content)) return partsAsText(item.content);
        return '';
      })
      .join('')
      .trim();
    if (out) return out;
  }

  // Anthropic `/v1/messages` or custom top-level content/message
  if (typeof data.content === 'string' && data.content.trim()) return data.content;
  if (Array.isArray(data.content)) {
    const text = partsAsText(data.content);
    if (text) return text;
  }
  if (typeof data.message?.content === 'string' && data.message.content.trim()) {
    return data.message.content;
  }
  if (Array.isArray(data.message?.content)) {
    const text = partsAsText(data.message.content);
    if (text) return text;
  }

  // Gemini native `candidates`
  const geminiParts = data.candidates?.[0]?.content?.parts;
  if (Array.isArray(geminiParts)) {
    const text = partsAsText(geminiParts);
    if (text) return text;
  }

  // Fallback for misconfigured reasoning endpoints that place the finished JSON in
  // `reasoning_content` and leave `content` empty with `finish_reason === "stop"`.
  if (choice?.finish_reason === 'stop') {
    const reasoning = choice.message?.reasoning_content ?? choice.message?.reasoning;
    if (typeof reasoning === 'string' && reasoning.trim().endsWith('}')) {
      return reasoning;
    }
  }

  return '';
}

interface RequestAttemptOptions {
  maxTokens?: number;
  omitTemperature?: boolean;
  stream?: boolean;
}

export class LlmEngine implements AgentEngine {
  private readonly settings: ModelSettings;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly onRequest?: LlmClientOptions['onRequest'];
  private readonly signal?: AbortSignal;

  constructor(settings: ModelSettings, options: LlmClientOptions = {}) {
    this.settings = {
      baseUrl: settings.baseUrl.trim(),
      apiKey: settings.apiKey.trim(),
      model: settings.model.trim(),
    };
    this.timeoutMs = options.timeoutMs ?? 120_000;
    this.fetchImpl = options.fetchImpl ?? defaultFetch;
    this.onRequest = options.onRequest;
    this.signal = options.signal;
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
    );
  }

  async audit(context: SessionContext, draft: SafetyDraft): Promise<AiAuditResult> {
    return this.runJsonNode(
      'audit',
      AUDIT_SYSTEM_PROMPT,
      buildAuditUserPrompt(context, draft),
      validateAiAuditResult,
    );
  }

  private async runJsonNode<T>(
    node: 'parse' | 'clarify' | 'generate' | 'audit',
    system: string,
    user: string,
    validate: (raw: string) => T,
  ): Promise<T> {
    if (!this.settings.apiKey) {
      throw new LlmRequestError('auth', '未配置 API Key，请打开模型设置或使用离线演示模式。', false);
    }
    if (!this.settings.model) {
      throw new LlmRequestError('auth', '未配置模型名称，请打开模型设置。', false);
    }

    this.onRequest?.(node);
    // Do NOT set a low `max_tokens` upfront: reasoning models (deepseek-reasoner, Qwen3,
    // GLM, Gemini thinking, etc.) count thinking tokens against `max_tokens` and return
    // empty `content` if capped at 2000–3500. Let the provider use the model's native limit,
    // and only escalate `max_tokens` on `finish_reason === "length"`.
    const raw = await this.requestWithFallbacks(system, user);
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

  private async requestWithFallbacks(system: string, user: string): Promise<string> {
    const omitTemp = FIXED_TEMPERATURE_MODEL.test(this.settings.model);
    let result = await this.requestOnce(system, user, { omitTemperature: omitTemp });

    // 1. Model rejected `temperature: 0.1` (e.g. kimi-k2.5 / reasoning model behind alias)
    if (result.kind === 'temperature_unsupported' && !omitTemp) {
      result = await this.requestOnce(system, user, { omitTemperature: true });
    }

    // 2. Server's default `max_tokens` was too small and cut off thinking/output (`finish_reason: length`)
    if (result.kind === 'truncated') {
      const retry = await this.requestOnce(system, user, { omitTemperature: true, maxTokens: 16_384 });
      if (retry.kind === 'max_tokens_out_of_range') {
        result = await this.requestOnce(system, user, { omitTemperature: true, maxTokens: 8_192 });
      } else {
        result = retry;
      }
    }

    // 3. Some OpenAI-compatible relays return empty `choices[0].message.content` unless `stream: true` is used
    if (result.kind === 'empty' && result.canRetryStream) {
      try {
        const streamed = await this.requestOnce(system, user, { omitTemperature: omitTemp, stream: true });
        if (streamed.kind === 'ok') return streamed.text;
      } catch {
        // Keep the original diagnostic error if the server does not support streaming.
      }
    }

    if (result.kind === 'ok') return result.text;
    throw result.error;
  }

  private async requestOnce(
    system: string,
    user: string,
    attempt: RequestAttemptOptions,
  ): Promise<
    | { kind: 'ok'; text: string }
    | { kind: 'truncated'; error: LlmRequestError }
    | { kind: 'empty'; canRetryStream: boolean; error: LlmRequestError }
    | { kind: 'temperature_unsupported'; error: LlmRequestError }
    | { kind: 'max_tokens_out_of_range'; error: LlmRequestError }
  > {
    if (this.signal?.aborted) {
      throw new LlmRequestError('unknown', '请求已取消。', false);
    }
    const url = resolveChatCompletionsUrl(this.settings.baseUrl);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const cancel = () => controller.abort();
    this.signal?.addEventListener('abort', cancel, { once: true });

    try {
      const payload: Record<string, unknown> = {
        model: this.settings.model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      };
      if (!attempt.omitTemperature) payload.temperature = 0.1;
      if (attempt.maxTokens !== undefined) payload.max_tokens = attempt.maxTokens;
      if (attempt.stream) payload.stream = true;

      const response = await this.fetchImpl(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: attempt.stream ? 'text/event-stream, application/json' : 'application/json',
          Authorization: `Bearer ${this.settings.apiKey}`,
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      const bodyText = await response.text();
      if (response.ok && !bodyText.trim()) {
        return {
          kind: 'empty',
          canRetryStream: !attempt.stream,
          error: new LlmRequestError(
            'invalid_json',
            `模型接口返回了空响应（HTTP ${response.status}），请检查 Base URL 与服务状态。`,
            true,
            `URL: ${url}`,
          ),
        };
      }

      let body: ChatCompletionResponse | null = null;
      const trimmed = bodyText.trim();
      if (trimmed.startsWith('data:') || trimmed.includes('\ndata:')) {
        body = parseSseTranscript(bodyText);
      }
      if (!body && trimmed) {
        try {
          body = JSON.parse(bodyText) as ChatCompletionResponse;
        } catch {
          if (response.ok) {
            const isHtml = /^<!doctype html|^<html/i.test(trimmed);
            throw new LlmRequestError(
              'invalid_json',
              isHtml
                ? 'API 地址返回了网页（HTML）而非模型接口响应，请检查 Base URL 是否填写正确。'
                : '模型服务返回了非 JSON 响应，请检查接口地址。',
              !isHtml,
              `URL: ${url} | 响应片段: ${trimmed.replace(/\s+/g, ' ').slice(0, 300)}`,
            );
          }
        }
      }
      const parsedBody: ChatCompletionResponse = body ?? {};

      if (!response.ok) {
        const envelopeMessage = errorFromEnvelope(parsedBody);
        const serverMessage =
          envelopeMessage?.slice(0, 360) || bodyText.slice(0, 360) || response.statusText;
        if (response.status === 400 && /temperature/i.test(serverMessage)) {
          return {
            kind: 'temperature_unsupported',
            error: new LlmRequestError('http', `模型不支持当前 temperature 参数：${serverMessage}`, false, serverMessage),
          };
        }
        if (response.status === 400 && /max_tokens/i.test(serverMessage) && attempt.maxTokens) {
          return {
            kind: 'max_tokens_out_of_range',
            error: new LlmRequestError('http', `模型 max_tokens 超出范围：${serverMessage}`, false, serverMessage),
          };
        }
        if (response.status === 401 || response.status === 403) {
          throw new LlmRequestError('auth', 'API 鉴权失败，请检查 API Key。', false, serverMessage);
        }
        if (response.status === 404) {
          throw new LlmRequestError(
            'http',
            `接口或模型不存在（HTTP 404），请打开「模型设置」检查 Base URL 与模型名称（当前：${this.settings.model}）。`,
            false,
            serverMessage,
          );
        }
        if (response.status === 429) {
          throw new LlmRequestError(
            'rate_limit',
            '模型请求过于频繁或额度受限，请稍后重试本步骤。',
            true,
            serverMessage,
          );
        }
        throw new LlmRequestError(
          'http',
          `模型接口返回 HTTP ${response.status}${envelopeMessage ? `：${envelopeMessage.slice(0, 120)}` : '，请检查配置后重试。'}`,
          response.status >= 500,
          serverMessage,
        );
      }

      // Some gateways return HTTP 200 with `{ error: { message: "..." } }` or `{ code: 4xx, msg: "..." }`.
      const okEnvelopeError = errorFromEnvelope(parsedBody);
      if (okEnvelopeError && !parsedBody.choices?.length) {
        const authLike = /key|token|auth|unauthorized|令牌|密钥|鉴权/i.test(okEnvelopeError);
        throw new LlmRequestError(
          authLike ? 'auth' : 'http',
          `模型服务返回错误：${okEnvelopeError.slice(0, 160)}`,
          !authLike,
          summarizeDebug(url, response.status, bodyText, parsedBody),
        );
      }

      const choice = parsedBody.choices?.[0];
      if (choice?.message?.refusal) {
        throw new LlmRequestError(
          'http',
          '模型拒绝生成本次安全审查内容，请重试或更换模型。',
          true,
          choice.message.refusal,
        );
      }
      if (choice?.finish_reason === 'content_filter' || choice?.finish_reason === 'sensitive') {
        throw new LlmRequestError(
          'http',
          '模型输出触发了服务端内容安全过滤（实验涉及剧毒或强氧化剂时部分接口可能误拦截），请重试或更换模型。',
          true,
          summarizeDebug(url, response.status, bodyText, parsedBody),
        );
      }

      const text = extractCompletionText(parsedBody);
      if (text) {
        // If `finish_reason === "length"` cut off the JSON mid-object, retry with a higher token cap.
        if (choice?.finish_reason === 'length' && !text.trim().endsWith('}') && !text.includes('```')) {
          return {
            kind: 'truncated',
            error: new LlmRequestError(
              'invalid_json',
              '模型输出因 Token 上限被截断，JSON 未生成完整。建议切换为非推理对话模型（如 deepseek-chat）或重试。',
              true,
              summarizeDebug(url, response.status, bodyText, parsedBody),
            ),
          };
        }
        return { kind: 'ok', text };
      }

      if (choice?.finish_reason === 'length') {
        return {
          kind: 'truncated',
          error: new LlmRequestError(
            'invalid_json',
            '推理模型在思考阶段耗尽了输出 Token 上限，未生成最终 JSON。建议在「模型设置」中切换为对话模型（如 deepseek-chat）后重试。',
            true,
            summarizeDebug(url, response.status, bodyText, parsedBody),
          ),
        };
      }

      return {
        kind: 'empty',
        canRetryStream: !attempt.stream && Boolean(parsedBody.choices?.length),
        error: new LlmRequestError(
          'invalid_json',
          '模型未返回可解析的文本内容，请展开「技术详情」核对模型名称与 Base URL，或切换模型后重试。',
          true,
          summarizeDebug(url, response.status, bodyText, parsedBody),
        ),
      };
    } catch (error) {
      if (error instanceof LlmRequestError) throw error;
      if (isAbortError(error)) {
        if (this.signal?.aborted) {
          throw new LlmRequestError('unknown', '请求已取消。', false);
        }
        throw new LlmRequestError(
          'timeout',
          `模型请求超时（${Math.round(this.timeoutMs / 1000)} 秒）。若使用深度推理模型，可切换为对话模型（如 deepseek-chat）或重试本步骤。`,
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
      this.signal?.removeEventListener('abort', cancel);
    }
  }
}

export function createLlmEngine(settings: ModelSettings, options?: LlmClientOptions): LlmEngine {
  return new LlmEngine(settings, options);
}

export async function fetchModelIds(
  settings: Pick<ModelSettings, 'baseUrl' | 'apiKey'>,
  options: { timeoutMs?: number; fetchImpl?: typeof fetch } = {},
): Promise<string[]> {
  const baseUrl = settings.baseUrl.trim();
  const apiKey = settings.apiKey.trim();
  if (!baseUrl) throw new LlmRequestError('auth', '请先填写 API 地址。', false);
  if (!apiKey) throw new LlmRequestError('auth', '请先填写 API Key。', false);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 15_000);
  const request = options.fetchImpl ?? defaultFetch;

  try {
    const response = await request(resolveModelsUrl(baseUrl), {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: controller.signal,
    });
    const bodyText = await response.text();
    let body: ModelsResponse = {};
    try {
      body = bodyText ? JSON.parse(bodyText) as ModelsResponse : {};
    } catch {
      throw new LlmRequestError('invalid_json', '模型列表返回了非 JSON 响应，请检查 API 地址。', true, bodyText.slice(0, 300));
    }
    const errText = typeof body.error === 'string' ? body.error : body.error?.message;
    if (!response.ok) {
      const detail = errText?.slice(0, 300) || bodyText.slice(0, 300) || response.statusText;
      if (response.status === 401 || response.status === 403) {
        throw new LlmRequestError('auth', '拉取模型列表鉴权失败，请检查 API Key。', false, detail);
      }
      if (response.status === 429) {
        throw new LlmRequestError('rate_limit', '模型列表请求过于频繁，请稍后重试。', true, detail);
      }
      throw new LlmRequestError('http', `模型列表接口返回 HTTP ${response.status}。`, response.status >= 500, detail);
    }

    const ids = (body.data ?? [])
      .map((item) => typeof item.id === 'string' ? item.id.trim() : '')
      .filter(Boolean);
    if (!ids.length) throw new LlmRequestError('schema_validation', '模型列表为空或格式不受支持。', true);
    return [...new Set(ids)].sort((a, b) => a.localeCompare(b));
  } catch (error) {
    if (error instanceof LlmRequestError) throw error;
    if (isAbortError(error)) {
      throw new LlmRequestError('timeout', '拉取模型列表超时，请重试。', true);
    }
    if (error instanceof TypeError) {
      throw new LlmRequestError('network', '无法连接模型列表接口，请检查网络、API 地址及跨域设置。', true, error.message);
    }
    throw new LlmRequestError('unknown', '拉取模型列表失败，请重试。', true, error instanceof Error ? error.message : undefined);
  } finally {
    clearTimeout(timer);
  }
}
