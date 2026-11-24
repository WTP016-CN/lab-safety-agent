import { z } from 'zod';
import type { AiAuditResult, ParseResult, SafetyDraft } from './types';

const nonEmpty = z.string().trim().min(1);
const riskLevel = z.enum(['low', 'medium', 'high']);
const HAZARD_TAGS = [
  'strong_acid',
  'concentrated_sulfuric_acid',
  'strong_base',
  'strong_oxidizer',
  'organic_reducer',
  'cyanide',
  'sulfide',
  'fluoride',
  'hydrofluoric_acid',
  'mercury',
  'chromium_vi',
  'heavy_metal',
  'halogenated_organic',
  'nonhalogenated_organic',
] as const;
const hazardTag = z.enum(HAZARD_TAGS);

/** Models often emit `null` or `""` for unknown optional fields; treat both as absent. */
const blankToUndefined = (value: unknown) =>
  value === null || (typeof value === 'string' && !value.trim()) ? undefined : value;
const optionalText = z.preprocess(blankToUndefined, nonEmpty.optional());
const optionalNumber = z.preprocess((value) => {
  const cleaned = blankToUndefined(value);
  if (typeof cleaned === 'string' && /^-?\d+(?:\.\d+)?$/.test(cleaned.trim())) return Number(cleaned);
  return cleaned;
}, z.number().finite().optional());
/** Arrays that may legitimately be empty: accept `null` as `[]`. */
const list = <T extends z.ZodTypeAny>(item: T) =>
  z.preprocess((value) => value ?? [], z.array(item));
/**
 * Hazard tags are display metadata (local rules re-derive hazards from names),
 * so unknown tags are dropped instead of failing the whole step.
 */
const hazardTagList = z.preprocess(
  (value) => (Array.isArray(value)
    ? value.filter((tag) => (HAZARD_TAGS as readonly unknown[]).includes(tag))
    : value ?? []),
  z.array(hazardTag),
);

const reagentSchema = z.object({
  name: nonEmpty,
  cas: optionalText,
  concentration: optionalText,
  amount: optionalText,
  categories: hazardTagList,
  hazards: list(nonEmpty),
});

const conditionType = z.preprocess(
  (value) => (typeof value === 'string'
    && ['heating', 'digestion', 'reflux', 'evaporation', 'sealed', 'other'].includes(value)
    ? value
    : typeof value === 'string' ? 'other' : value),
  z.enum(['heating', 'digestion', 'reflux', 'evaporation', 'sealed', 'other']),
);

const conditionSchema = z.object({
  type: conditionType,
  description: nonEmpty,
  temperatureC: optionalNumber,
  duration: optionalText,
});

const questionSchema = z.object({
  id: nonEmpty,
  prompt: nonEmpty,
  control: z.enum(['single', 'multi']),
  options: z
    .array(z.object({ value: nonEmpty, label: nonEmpty }))
    .min(2)
    .max(10),
  required: z.boolean().default(true),
  allowSupplement: z.boolean().default(true),
  rationale: z.preprocess(blankToUndefined, nonEmpty.default('补充关键安全条件以完成风险评估')),
});

export const parseResultSchema: z.ZodType<ParseResult, z.ZodTypeDef, unknown> = z
  .object({
    experimentSummary: nonEmpty,
    reagents: list(reagentSchema),
    conditions: list(conditionSchema),
    initialRisk: riskLevel,
    riskReasons: z.array(nonEmpty).min(1),
    informationComplete: z.boolean().optional(),
    next_action: z.enum(['CLARIFY', 'GENERATE']),
    missing_questions: list(questionSchema),
  })
  .transform((value): ParseResult => ({
    ...value,
    // Keep `informationComplete` consistent with `next_action` even if the LLM contradicts itself.
    informationComplete: value.next_action === 'GENERATE',
    missing_questions: value.next_action === 'GENERATE' ? [] : value.missing_questions,
  }))
  .superRefine((value, context) => {
    if (value.next_action === 'CLARIFY' && value.missing_questions.length === 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['missing_questions'],
        message: 'CLARIFY 分支必须提供至少一个追问问题',
      });
    }
    if (value.next_action === 'GENERATE' && value.reagents.length === 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['reagents'],
        message: 'GENERATE 分支必须至少识别出一种试剂',
      });
    }
  });

const compatibilitySchema = z.object({
  id: nonEmpty,
  severity: riskLevel,
  reagents: z.array(nonEmpty).min(2),
  hazard: nonEmpty,
  reaction: nonEmpty,
  prevention: nonEmpty,
  relatedRuleId: optionalText,
});

const ppeSchema = z.object({
  requiredPpe: z
    .array(
      z.object({
        item: nonEmpty,
        specification: nonEmpty,
        reason: nonEmpty,
      }),
    )
    .min(1),
  ventilation: nonEmpty,
  additionalControls: list(nonEmpty),
});

const sopSchema = z.object({
  order: z.number().int().positive(),
  title: nonEmpty,
  actions: z.array(nonEmpty).min(1),
  safetyNotes: list(nonEmpty),
});

const emergencySchema = z.object({
  scenario: nonEmpty,
  immediateActions: z.array(nonEmpty).min(1),
});

const wasteCategory = z.enum([
  'inorganic_acid',
  'alkali',
  'heavy_metal',
  'chromium',
  'mercury',
  'fluoride',
  'cyanide',
  'sulfide',
  'halogenated_organic',
  'non_halogenated_organic',
  'contaminated_solid',
  'other',
]);

const wasteStreamSchema = z.object({
  id: nonEmpty,
  category: wasteCategory,
  bucketLabel: nonEmpty,
  mainComponents: z.array(nonEmpty).min(1),
  hazardTags: hazardTagList,
  forbiddenItems: z.array(nonEmpty).min(1),
  containerSpec: nonEmpty,
  storageNotes: nonEmpty,
});

const dispositionSchema = z.object({
  reagentName: nonEmpty,
  destination: z.enum(['waste_stream', 'reacted_or_consumed', 'not_used']),
  wasteStreamId: optionalText,
  note: nonEmpty,
});

export const safetyDraftSchema: z.ZodType<SafetyDraft, z.ZodTypeDef, unknown> = z
  .object({
    draftId: nonEmpty,
    attempt: z.number().int().positive(),
    riskLevel,
    riskRationale: z.array(nonEmpty).min(1),
    compatibilityWarnings: list(compatibilitySchema),
    ppe: ppeSchema,
    sop: z.array(sopSchema).min(1),
    emergencyProcedures: z.array(emergencySchema).min(1),
    wasteStreams: z.array(wasteStreamSchema).min(1),
    reagentDisposition: z.array(dispositionSchema).min(1),
    checklist: z.array(nonEmpty).min(1),
  })
  .transform((value): SafetyDraft => ({
    ...value,
    // Models often fill `wasteStreamId: "无" / "none"` when `destination !== "waste_stream"`.
    reagentDisposition: value.reagentDisposition.map((item) =>
      item.destination === 'waste_stream'
        ? item
        : { reagentName: item.reagentName, destination: item.destination, note: item.note },
    ),
  }))
  .superRefine((value, context) => {
    const streamIds = new Set(value.wasteStreams.map((stream) => stream.id));
    if (streamIds.size !== value.wasteStreams.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['wasteStreams'],
        message: 'wasteStreams.id 不能重复',
      });
    }

    value.sop.forEach((step, index) => {
      if (step.order !== index + 1) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['sop', index, 'order'],
          message: 'SOP order 必须从 1 开始连续递增',
        });
      }
    });

    value.reagentDisposition.forEach((item, index) => {
      if (item.destination === 'waste_stream' && !item.wasteStreamId) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['reagentDisposition', index, 'wasteStreamId'],
          message: '进入废液的试剂必须填写 wasteStreamId',
        });
      }
      if (item.wasteStreamId && !streamIds.has(item.wasteStreamId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['reagentDisposition', index, 'wasteStreamId'],
          message: `引用了不存在的废液桶 ${item.wasteStreamId}`,
        });
      }
    });
  });

export const aiAuditResultSchema: z.ZodType<AiAuditResult, z.ZodTypeDef, unknown> = z
  .object({
    passed: z.boolean(),
    issues: list(nonEmpty),
  })
  .superRefine((value, context) => {
    if (!value.passed && value.issues.length === 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['issues'],
        message: '审核未通过时必须说明问题',
      });
    }
  });

export class AgentOutputError extends Error {
  readonly code: 'invalid_json' | 'schema_validation';
  readonly detail: string;

  constructor(
    code: 'invalid_json' | 'schema_validation',
    message: string,
    detail: string,
  ) {
    super(message);
    this.name = 'AgentOutputError';
    this.code = code;
    this.detail = detail;
  }
}

/** Removes `<think>` reasoning blocks, markdown fences, and isolates the JSON object. */
export function cleanJsonText(raw: string): string {
  let text = raw.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  const danglingClose = text.lastIndexOf('</think>');
  if (danglingClose >= 0) {
    text = text.slice(danglingClose + '</think>'.length).trim();
  }

  const fenced = text.match(/```(?:json|JSON)?\s*([\s\S]*?)```/);
  if (fenced?.[1]) {
    text = fenced[1].trim();
  }

  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start >= 0 && end > start) {
    text = text.slice(start, end + 1);
  }
  return text;
}

export function parseAgentJson(raw: string): unknown {
  const cleaned = cleanJsonText(raw);
  try {
    return JSON.parse(cleaned);
  } catch (error) {
    const message = error instanceof Error ? error.message : '未知 JSON 错误';
    throw new AgentOutputError(
      'invalid_json',
      '模型返回内容不是有效 JSON，请重试本步骤。',
      message,
    );
  }
}

function validate<T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, raw: string): T {
  const parsed = schema.safeParse(parseAgentJson(raw));
  if (!parsed.success) {
    const summary = parsed.error.issues
      .slice(0, 8)
      .map((issue) => `${issue.path.join('.') || 'root'}: ${issue.message}`)
      .join('；');
    throw new AgentOutputError(
      'schema_validation',
      '模型返回的 JSON 结构不符合安全审查协议，请重试本步骤。',
      summary,
    );
  }
  return parsed.data;
}

export function validateParseResult(raw: string): ParseResult {
  return validate(parseResultSchema, raw);
}

export function validateSafetyDraft(raw: string): SafetyDraft {
  return validate(safetyDraftSchema, raw);
}

export function validateAiAuditResult(raw: string): AiAuditResult {
  return validate(aiAuditResultSchema, raw);
}
