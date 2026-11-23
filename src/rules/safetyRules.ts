import type {
  ExperimentInput,
  HazardTag,
  LocalAuditResult,
  LocalRuleIssue,
  SafetyDraft,
  WasteStream,
} from '../agent/types';
import {
  getComponentTags,
  hasDangerousHazard,
  inferHazardTags,
  isKnownReagent,
  normalizeText,
  parseReagentList,
} from './reagentCatalog';

const SPECIAL_COLLECTION: Record<'mercury' | 'chromium_vi' | 'fluoride', {
  categories: WasteStream['category'][];
  label: string;
  ruleId: string;
}> = {
  mercury: {
    categories: ['mercury', 'heavy_metal'],
    label: '含汞',
    ruleId: 'SAFE-006',
  },
  chromium_vi: {
    categories: ['chromium', 'heavy_metal'],
    label: '含六价铬',
    ruleId: 'SAFE-007',
  },
  fluoride: {
    categories: ['fluoride'],
    label: '含氟',
    ruleId: 'SAFE-008',
  },
};

function hasAnyTag(tags: Set<HazardTag>, expected: HazardTag[]): boolean {
  return expected.some((tag) => tags.has(tag));
}

function issue(
  ruleId: string,
  message: string,
  evidence: string[],
  suggestion: string,
  severity: 'blocker' | 'warning' = 'blocker',
): LocalRuleIssue {
  return { ruleId, severity, message, evidence, suggestion };
}

function componentMatchesForbidden(
  component: string,
  forbiddenText: string,
): boolean {
  const componentTags = inferHazardTags(component);
  const forbiddenTags = inferHazardTags(forbiddenText);
  const text = forbiddenText.toLowerCase();
  if (hasAnyTag(new Set(componentTags), forbiddenTags)) return true;
  if (/汞|mercury/.test(text)) return componentTags.includes('mercury');
  if (/六价铬|铬酸|重铬酸|chromium/.test(text)) return componentTags.includes('chromium_vi');
  if (/卤代|含卤|chlorinated|halogenated/.test(text)) {
    return componentTags.includes('halogenated_organic');
  }
  if (/强酸|酸类|acid/.test(text)) return componentTags.includes('strong_acid');
  if (/强碱|碱类|alkali|base/.test(text)) return componentTags.includes('strong_base');
  if (/氰化物|cyanide/.test(text)) return componentTags.includes('cyanide');
  if (/硫化物|sulfide/.test(text)) return componentTags.includes('sulfide');
  if (/氟化物|氢氟酸|fluoride|hydrofluoric/.test(text)) return componentTags.includes('fluoride');
  return false;
}

function checkWasteStream(stream: WasteStream): LocalRuleIssue[] {
  const tags = getComponentTags(stream.mainComponents);
  const issues: LocalRuleIssue[] = [];
  const names = stream.mainComponents.join('、');

  if (tags.has('strong_acid') && tags.has('cyanide')) {
    issues.push(issue(
      'SAFE-001',
      `废液桶「${stream.bucketLabel}」同时含有强酸与氰化物，混合可能释放剧毒氰化氢（HCN）。`,
      [names],
      '立即隔离该桶，按剧毒品/氰化物废液交由学校 EHS 处置，严禁自行酸化或中和。',
    ));
  }

  if (tags.has('strong_acid') && tags.has('sulfide')) {
    issues.push(issue(
      'SAFE-002',
      `废液桶「${stream.bucketLabel}」同时含有强酸与硫化物，混合可能释放剧毒硫化氢（H2S）。`,
      [names],
      '保持碱性并单独收集硫化物废液；已混合时立即撤离并报告实验室负责人。',
    ));
  }

  const containsPotentOxidizer = /氯酸盐|高锰酸钾|高氯酸/.test(names);
  if (tags.has('concentrated_sulfuric_acid') && containsPotentOxidizer) {
    issues.push(issue(
      'SAFE-003',
      `废液桶「${stream.bucketLabel}」将浓硫酸与氯酸盐/高锰酸钾等高氧化性物质共桶，存在剧烈放热或爆炸风险。`,
      [names],
      '分开收集，氧化性废液须远离酸、可燃物和还原性物质。',
    ));
  }

  if (tags.has('strong_oxidizer') && hasAnyTag(tags, [
    'organic_reducer',
    'nonhalogenated_organic',
    'halogenated_organic',
  ])) {
    issues.push(issue(
      'SAFE-004',
      `废液桶「${stream.bucketLabel}」混有强氧化剂与有机还原性物质，可能发生放热、燃烧或爆炸。`,
      [names],
      '将氧化剂废液与所有有机废液分开收集，并使用原厂容器与二次容器盛装。',
    ));
  }

  if (tags.has('halogenated_organic') && tags.has('nonhalogenated_organic')) {
    issues.push(issue(
      'SAFE-005',
      `废液桶「${stream.bucketLabel}」混入含卤与非卤有机废液，会显著增加处置难度和交叉污染风险。`,
      [names],
      '含卤有机废液与非卤有机废液必须使用不同标签桶分别收集。',
    ));
  }

  for (const tag of ['mercury', 'chromium_vi', 'fluoride'] as const) {
    if (!tags.has(tag)) continue;
    const special = SPECIAL_COLLECTION[tag];
    if (!special.categories.includes(stream.category) || !stream.hazardTags.includes(tag)) {
      issues.push(issue(
        special.ruleId,
        `${special.label}成分出现在废液桶「${stream.bucketLabel}」中，但该桶未按${special.label}专项危废标识和类别收集。`,
        [names, `实际类别：${stream.category}`],
        `改用${special.label}专项废液桶，桶标签同时注明全部成分、危险特性及严禁混入项。`,
      ));
    }
  }

  if (tags.has('hydrofluoric_acid')) {
    const emergencyText = JSON.stringify(stream);
    if (!/葡萄糖酸钙|六氟灵|HF急救/.test(emergencyText)) {
      issues.push(issue(
        'SAFE-008B',
        `废液桶「${stream.bucketLabel}」涉及氢氟酸，但未标注 HF 专项应急与钙剂信息。`,
        [names],
        '在标签和应急处置卡中注明氢氟酸接触后立即冲洗并尽快使用葡萄糖酸钙凝胶，同时就医。',
        'warning',
      ));
    }
  }

  for (const component of stream.mainComponents) {
    for (const forbidden of stream.forbiddenItems) {
      if (componentMatchesForbidden(component, forbidden)) {
        issues.push(issue(
          'SAFE-010',
          `废液桶「${stream.bucketLabel}」的实际成分「${component}」命中其自身严禁混入项「${forbidden}」。`,
          [component, forbidden],
          '重新分类并联系 EHS；不得继续向该类废液桶倒入相关物质。',
        ));
      }
    }
  }

  return issues;
}

function normalizedReagentMatch(reagent: string, destination: string): boolean {
  const reagentKey = normalizeText(reagent);
  const destinationKey = normalizeText(destination);
  if (reagentKey.length < 2) return false;
  return destinationKey.includes(reagentKey) || reagentKey.includes(destinationKey);
}

/**
 * Deterministic waste and compatibility audit. Bucket hazards are derived from
 * component names; model-supplied hazardTags are treated as display metadata.
 */
export function auditSafetyDraft(
  input: ExperimentInput,
  draft: SafetyDraft,
): LocalAuditResult {
  const issues: LocalRuleIssue[] = [];
  const reagents = parseReagentList(input.reagentListText);

  for (const stream of draft.wasteStreams) {
    issues.push(...checkWasteStream(stream));
  }

  const dispositions = draft.reagentDisposition ?? [];
  const wasteComponents = draft.wasteStreams.flatMap((stream) =>
    stream.mainComponents.map((component) => ({ stream, component })),
  );

  for (const reagent of reagents) {
    const dangerous = hasDangerousHazard(reagent.categories);
    const disposition = dispositions.find((item) =>
      normalizedReagentMatch(reagent.name, item.reagentName),
    );
    const inWaste = wasteComponents.some(({ component }) =>
      normalizedReagentMatch(reagent.name, component),
    );

    if (dangerous && !disposition && !inWaste) {
      issues.push(issue(
        'SAFE-009',
        `高危试剂「${reagent.name}」未出现在废液分类或处置去向中，存在漏桶风险。`,
        [`危险标签：${reagent.categories.join(', ') || '待核实'}`],
        '补充该试剂的去向；如进入废液，必须明确对应废液桶，不得默认为已消耗。',
      ));
    }

    if (disposition?.destination === 'waste_stream') {
      const linked = draft.wasteStreams.find((stream) => stream.id === disposition.wasteStreamId);
      if (!linked) {
        issues.push(issue(
          'SAFE-009B',
          `试剂「${reagent.name}」的处置记录引用了不存在的废液桶「${disposition.wasteStreamId ?? '空'}」。`,
          [disposition.note],
          '修正废液桶 ID，确保每个废液去向都能对应到实际标签。',
        ));
      }
    }

    if (!isKnownReagent(reagent.name)) {
      issues.push(issue(
        'SAFE-011',
        `试剂「${reagent.name}」未被本地目录识别，无法自动确认其危险属性与专项收集要求。`,
        [input.reagentListText],
        '核对包装标签和 SDS 后人工确认，并将该试剂作为残余风险列入复核记录。',
        'warning',
      ));
    }
  }

  if (draft.wasteStreams.length === 0) {
    issues.push(issue(
      'SAFE-012',
      '方案未提供任何废液分类桶，无法完成危废分类审查。',
      ['wasteStreams 为空'],
      '至少列出实验产生的全部废液类别及对应收集容器。',
    ));
  }

  const uniqueIssues = issues.filter((entry, index, all) =>
    all.findIndex((candidate) =>
      candidate.ruleId === entry.ruleId && candidate.message === entry.message,
    ) === index,
  );

  return {
    passed: !uniqueIssues.some((entry) => entry.severity === 'blocker'),
    issues: uniqueIssues,
  };
}
