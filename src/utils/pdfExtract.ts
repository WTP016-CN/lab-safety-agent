import type { PDFPageProxy } from 'pdfjs-dist';
import type { ExperimentInput, ModelSettings } from '../agent/types';

export type PdfExtractMode = 'text' | 'vision' | 'mixed';

export interface PdfExtractResult {
  title: string;
  procedure: string;
  reagentListText: string;
  pageCount: number;
  visionPageCount: number;
  mode: PdfExtractMode;
  /** Non-fatal problem (e.g. some scanned pages could not be recognised). */
  warning?: string;
}

export interface PdfExtractOptions {
  settings: ModelSettings;
  onProgress?: (message: string) => void;
  timeoutMs?: number;
}

interface VisionSections {
  title: string;
  procedure: string;
  reagentListText: string;
}

interface ChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string | Array<{ type?: string; text?: string }>;
    };
  }>;
  error?: { message?: string };
}

const MAX_VISION_PAGES = 6;
const VISION_RENDER_SCALE = 1.5;
const EMPTY_PAGE_TEXT = 20;
const DEFAULT_VISION_TIMEOUT_MS = 90_000;

const VISION_PROMPT = `你是实验安全助手，正在读取环境科学实验指导 PDF 的页面图片。请完整、准确地转录图片中的中文文字、数字、单位与操作条件，不要总结，也不要补充图片中没有的信息。
只返回一个 JSON 对象，不要使用 Markdown 代码块，也不要输出解释：
{
  "title": "实验名称；无法确定时为空字符串",
  "procedure": "实验目的、原理、步骤、操作条件与注意事项的完整文字",
  "reagents": "拟用试剂清单，每行一种，尽量保留浓度、用量与 CAS；无法可靠区分时为空字符串"
}
若无法可靠区分实验步骤与试剂，请把完整转录放入 procedure，并让 reagents 为空字符串。图片可能来自扫描件，请逐页识别。`;

export class PdfImportError extends Error {
  readonly detail?: string;

  constructor(message: string, detail?: string) {
    super(message);
    this.name = 'PdfImportError';
    this.detail = detail;
  }
}

export async function extractPdfContent(
  file: File,
  options: PdfExtractOptions,
): Promise<PdfExtractResult> {
  const { settings, onProgress } = options;
  const timeoutMs = options.timeoutMs ?? DEFAULT_VISION_TIMEOUT_MS;
  onProgress?.('正在读取 PDF 文本层…');

  try {
    const pdfjs = await loadPdfJs();
    const loadingTask = pdfjs.getDocument({
      data: new Uint8Array(await file.arrayBuffer()),
    });

    try {
      const pdf = await loadingTask.promise;
      const pageTexts: string[] = [];

      for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
        onProgress?.(`正在读取文本层（第 ${pageNumber}/${pdf.numPages} 页）…`);
        const page = await pdf.getPage(pageNumber);
        try {
          const content = await page.getTextContent();
          pageTexts.push(textFromItems(content.items));
        } catch {
          pageTexts.push('');
        } finally {
          page.cleanup();
        }
      }

      const fullText = pageTexts.filter(Boolean).join('\n\n').trim();
      const scanned = pageTexts.every((text) => text.length < EMPTY_PAGE_TEXT);
      const visionPageNumbers = scanned
        ? Array.from(
            { length: Math.min(pdf.numPages, MAX_VISION_PAGES) },
            (_, index) => index + 1,
          )
        : pageTexts
            .map((text, index) => ({ page: index + 1, text }))
            .filter(({ text }) => text.length < EMPTY_PAGE_TEXT)
            .slice(0, MAX_VISION_PAGES)
            .map(({ page }) => page);

      let visionSections: VisionSections | null = null;
      let visionWarning: string | undefined;
      if (visionPageNumbers.length > 0) {
        try {
          const images: string[] = [];
          for (let index = 0; index < visionPageNumbers.length; index += 1) {
            onProgress?.(`正在渲染关键页面（${index + 1}/${visionPageNumbers.length}）…`);
            const page = await pdf.getPage(visionPageNumbers[index]);
            try {
              images.push(await renderPageToImage(page));
            } finally {
              page.cleanup();
            }
          }
          onProgress?.('正在调用视觉模型识别页面文字…');
          visionSections = parseVisionText(
            await requestVisionText(settings, images, timeoutMs),
          );
        } catch (error) {
          // Scanned PDFs have nothing else to fall back on; mixed PDFs keep their text layer.
          if (scanned) throw error;
          visionWarning = error instanceof Error ? error.message : String(error);
        }
      }

      if (scanned) {
        if (!visionSections) {
          throw new PdfImportError(
            '未能从 PDF 中识别出可用文字，请重试或换用支持视觉输入的模型。',
          );
        }
        return {
          ...visionSections,
          pageCount: pdf.numPages,
          visionPageCount: visionPageNumbers.length,
          mode: 'vision',
        };
      }

      const textSections = splitExperimentText(fullText);
      if (!visionSections) {
        return {
          ...textSections,
          pageCount: pdf.numPages,
          visionPageCount: 0,
          mode: 'text',
          ...(visionWarning ? { warning: `${visionPageNumbers.length} 页扫描页未能识别：${visionWarning}` } : {}),
        };
      }

      return {
        title: textSections.title || visionSections.title,
        procedure: appendBlock(textSections.procedure, visionSections.procedure),
        reagentListText: appendBlock(
          textSections.reagentListText,
          visionSections.reagentListText,
        ),
        pageCount: pdf.numPages,
        visionPageCount: visionPageNumbers.length,
        mode: 'mixed',
      };
    } finally {
      await loadingTask.destroy().catch(() => undefined);
    }
  } catch (error) {
    throw toPdfImportError(error);
  }
}

export function applyPdfExtraction(
  input: ExperimentInput,
  result: PdfExtractResult,
): ExperimentInput {
  return {
    name: input.name.trim() ? input.name : result.title.trim().slice(0, 120),
    procedure: appendBlock(input.procedure, result.procedure),
    reagentListText: result.reagentListText.trim()
      ? appendBlock(input.reagentListText, result.reagentListText)
      : input.reagentListText,
  };
}

export function splitExperimentText(text: string): VisionSections {
  const normalized = normalizeText(text);
  const lines = normalized.split('\n');
  const headings: Array<{ index: number; type: 'procedure' | 'reagents' | 'other'; rest: string }> = [];

  lines.forEach((line, index) => {
    const heading = matchHeading(line);
    if (heading) headings.push({ ...heading, index });
  });

  const hasProcedure = headings.some((heading) => heading.type === 'procedure');
  const hasReagents = headings.some((heading) => heading.type === 'reagents');
  if (!hasProcedure || !hasReagents) {
    return {
      title: detectTitle(lines),
      procedure: normalized,
      reagentListText: '',
    };
  }

  const sectionText = (type: 'procedure' | 'reagents'): string => {
    for (let index = headings.length - 1; index >= 0; index -= 1) {
      const heading = headings[index];
      if (heading.type !== type) continue;
      const next = headings.find((candidate) => candidate.index > heading.index);
      const body = [
        heading.rest,
        ...lines.slice(heading.index + 1, next ? next.index : lines.length),
      ]
        .join('\n')
        .trim();
      if (body) return body;
    }
    return '';
  };

  const procedure = sectionText('procedure');
  const reagentListText = sectionText('reagents');
  if (!procedure || !reagentListText) {
    return {
      title: detectTitle(lines),
      procedure: normalized,
      reagentListText: '',
    };
  }

  return { title: detectTitle(lines), procedure, reagentListText };
}

async function loadPdfJs() {
  const pdfjs = await import('pdfjs-dist');
  const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  return pdfjs;
}

async function renderPageToImage(page: PDFPageProxy): Promise<string> {
  const viewport = page.getViewport({ scale: VISION_RENDER_SCALE });
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.ceil(viewport.width));
  canvas.height = Math.max(1, Math.ceil(viewport.height));

  try {
    await page.render({ canvas, viewport, background: '#ffffff' }).promise;
    return canvas.toDataURL('image/jpeg', 0.86);
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }
}

async function requestVisionText(
  settings: ModelSettings,
  images: string[],
  timeoutMs: number,
): Promise<string> {
  const baseUrl = settings.baseUrl.trim();
  const apiKey = settings.apiKey.trim();
  const model = settings.model.trim();
  if (!baseUrl) throw new PdfImportError('请先在模型设置中填写 Base URL。');
  if (!apiKey) throw new PdfImportError('请先在模型设置中填写 API Key。');
  if (!model) throw new PdfImportError('请先在模型设置中填写模型名称。');

  const endpoint = resolveChatCompletionsUrl(baseUrl);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const request = window.fetch.bind(window);
    const response = await request(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0.1,
        max_tokens: 6000,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: VISION_PROMPT },
              ...images.map((url) => ({
                type: 'image_url',
                image_url: { url },
              })),
            ],
          },
        ],
      }),
      signal: controller.signal,
    });

    const bodyText = await response.text();
    let body: ChatCompletionResponse = {};
    if (bodyText) {
      try {
        body = JSON.parse(bodyText) as ChatCompletionResponse;
      } catch {
        if (response.ok) {
          throw new PdfImportError(
            '模型返回了非 JSON 响应，请检查 Base URL。',
            bodyText.slice(0, 300),
          );
        }
      }
    }

    if (!response.ok) {
      const serverMessage =
        body.error?.message?.slice(0, 300) ||
        bodyText.slice(0, 300) ||
        response.statusText;
      if (response.status === 401 || response.status === 403) {
        throw new PdfImportError('模型鉴权失败，请检查 API Key。', serverMessage);
      }
      if (response.status === 429) {
        throw new PdfImportError('模型请求过于频繁，请稍后重试。', serverMessage);
      }
      throw new PdfImportError(
        `模型接口返回 HTTP ${response.status}，请检查模型配置或视觉输入支持。`,
        serverMessage,
      );
    }

    const content = contentAsText(body).trim();
    if (!content) {
      throw new PdfImportError(
        '模型未返回识别文字，请重试或更换支持视觉输入的模型。',
      );
    }
    return content;
  } catch (error) {
    if (error instanceof PdfImportError) throw error;
    if (error instanceof Error && error.name === 'AbortError') {
      throw new PdfImportError(
        `扫描版识别超时（${Math.round(timeoutMs / 1000)} 秒），请重试。`,
      );
    }
    if (error instanceof TypeError) {
      throw new PdfImportError(
        '无法连接模型接口，请检查网络、Base URL 和浏览器跨域设置。',
        error.message,
      );
    }
    throw new PdfImportError(
      '视觉模型调用失败，请重试。',
      error instanceof Error ? error.message : String(error),
    );
  } finally {
    clearTimeout(timer);
  }
}

function resolveChatCompletionsUrl(baseUrl: string): string {
  const base = baseUrl.trim().replace(/\/+$/, '');
  if (!base) throw new PdfImportError('请先在模型设置中填写 Base URL。');
  return /\/chat\/completions$/i.test(base) ? base : `${base}/chat/completions`;
}

function parseVisionText(content: string): VisionSections {
  const data = extractJsonObject(content);
  if (!data) return splitExperimentText(content);

  const title = asText(data.title);
  const procedure =
    asText(data.procedure) ||
    asText(data.steps) ||
    asText(data.text) ||
    asText(data.fullText);
  const reagentListText =
    asText(data.reagents) ||
    asText(data.reagentListText) ||
    asText(data.reagent_list) ||
    asText(data.reagentList);

  if (!procedure && !reagentListText) {
    const fallback =
      asText(data.fullText) || asText(data.text) || asText(data.content);
    if (!fallback) {
      throw new PdfImportError(
        '模型未返回可用的实验文字，请重试或更换支持视觉输入的模型。',
      );
    }
    const split = splitExperimentText(fallback);
    return {
      title: title || split.title,
      procedure: split.procedure,
      reagentListText: split.reagentListText,
    };
  }

  return { title, procedure, reagentListText };
}

function extractJsonObject(value: string): Record<string, unknown> | null {
  const cleaned = value.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end <= start) return null;

  try {
    const parsed: unknown = JSON.parse(cleaned.slice(start, end + 1));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function asText(value: unknown): string {
  if (typeof value === 'string') return normalizeText(value);
  if (!Array.isArray(value)) return '';
  return normalizeText(
    value
      .map((item) => {
        if (typeof item === 'string') return item;
        if (item && typeof item === 'object') {
          return Object.values(item as Record<string, unknown>)
            .filter((part): part is string => typeof part === 'string')
            .join(' ');
        }
        return '';
      })
      .filter(Boolean)
      .join('\n'),
  );
}

function contentAsText(data: ChatCompletionResponse): string {
  const content = data.choices?.[0]?.message?.content;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((part) => (part.type === 'text' ? part.text ?? '' : ''))
    .join('');
}

function textFromItems(items: ReadonlyArray<unknown>): string {
  let text = '';
  for (const item of items) {
    if (!item || typeof item !== 'object' || !('str' in item)) continue;
    const textItem = item as { str?: unknown; hasEOL?: boolean };
    if (typeof textItem.str !== 'string') continue;
    text += textItem.str;
    if (textItem.hasEOL) text += '\n';
    else if (textItem.str && !/\s$/.test(textItem.str)) text += ' ';
  }
  return normalizeText(text);
}

function normalizeText(value: string): string {
  return value
    .replace(/\r\n?/g, '\n')
    .replace(/\u00a0/g, ' ')
    .replace(/([\u3400-\u9fff])[ \t]+(?=[\u3400-\u9fff])/g, '$1')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function matchHeading(
  line: string,
): { type: 'procedure' | 'reagents' | 'other'; rest: string } | null {
  const rules: Array<{
    type: 'procedure' | 'reagents' | 'other';
    pattern: RegExp;
  }> = [
    {
      type: 'procedure',
      pattern:
        /^\s*(?:[一二三四五六七八九十百]+[、.．]|\d+[、.．])?\s*(?:实验)?(?:操作)?(?:步骤|流程|方法)\s*[:：]?\s*(.*)$/,
    },
    {
      type: 'reagents',
      pattern:
        /^\s*(?:[一二三四五六七八九十百]+[、.．]|\d+[、.．])?\s*(?:实验)?(?:主要)?(?:试剂|药品)(?:清单|列表)?(?:[与及和]仪器)?\s*[:：]?\s*(.*)$/,
    },
    {
      type: 'other',
      pattern:
        /^\s*(?:[一二三四五六七八九十百]+[、.．]|\d+[、.．])?\s*(?:实验目的|实验原理|仪器(?:[与及和]试剂)?|设备|注意事项|安全(?:注意|提示|要求)|数据处理|结果(?:[与及和])?讨论|思考题|参考文献)\s*[:：]?\s*(.*)$/,
    },
  ];

  for (const rule of rules) {
    const match = line.match(rule.pattern);
    if (match) return { type: rule.type, rest: (match[1] ?? '').trim() };
  }
  return null;
}

function detectTitle(lines: string[]): string {
  const candidates = lines.map((line) => line.trim()).filter(Boolean);
  const isHeading = (line: string) => Boolean(matchHeading(line));
  const isGeneric = (line: string) =>
    /^(?:实验报告|实验指导|实验讲义|实验方案|目\s*录)$/.test(line);
  const named = candidates.find(
    (line) =>
      !isHeading(line) &&
      !isGeneric(line) &&
      line.length >= 4 &&
      line.length <= 80 &&
      /(实验|测定|分析|制备|合成|探究|检测|监测|处理)/.test(line),
  );
  const first = candidates.find(
    (line) => !isHeading(line) && !isGeneric(line) && line.length >= 2 && line.length <= 80,
  );
  return (named ?? first ?? '')
    .replace(/^(?:实验名称|实验题目|题目)\s*[:：]\s*/, '')
    .replace(/^(?:\d+|[一二三四五六七八九十]+)[、.．]\s*/, '')
    .slice(0, 80)
    .trim();
}

function appendBlock(base: string, addition: string): string {
  const text = addition.trim();
  if (!text) return base;
  if (!base.trim()) return text;
  if (base.includes(text)) return base;
  return `${base.trimEnd()}\n\n${text}`;
}

function toPdfImportError(error: unknown): PdfImportError {
  if (error instanceof PdfImportError) return error;
  const name = error instanceof Error ? error.name : '';
  const detail =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : undefined;
  if (name === 'PasswordException' || /password/i.test(detail ?? '')) {
    return new PdfImportError('该 PDF 已加密，无法读取。请移除密码后重试。', detail);
  }
  if (name === 'InvalidPDFException') {
    return new PdfImportError('文件不是有效的 PDF，或文件已损坏。', detail);
  }
  return new PdfImportError('PDF 读取失败，请重试或更换文件。', detail);
}
