import type { HazardTag, ReagentInfo } from '../agent/types';

export interface CatalogEntry {
  aliases: string[];
  cas?: string;
  tags: HazardTag[];
  hazards: string[];
}

export const REAGENT_CATALOG: CatalogEntry[] = [
  {
    aliases: ['重铬酸钾', 'potassium dichromate', 'k2cr2o7'],
    cas: '7778-50-9',
    tags: ['chromium_vi', 'heavy_metal', 'strong_oxidizer'],
    hazards: ['六价铬致癌', '强氧化性', '环境危害'],
  },
  {
    aliases: ['浓硫酸', '硫酸', 'sulfuric acid', 'h2so4'],
    cas: '7664-93-9',
    tags: ['strong_acid', 'concentrated_sulfuric_acid'],
    hazards: ['强腐蚀性', '稀释剧烈放热', '与还原剂反应'],
  },
  {
    aliases: ['硫酸银', 'silver sulfate', 'ag2so4'],
    cas: '10294-26-3',
    tags: ['heavy_metal'],
    hazards: ['银盐环境危害', '强酸体系腐蚀性'],
  },
  {
    aliases: ['硫酸汞', 'mercuric sulfate', 'mercury sulfate', 'hgso4'],
    cas: '7783-35-9',
    tags: ['mercury', 'heavy_metal'],
    hazards: ['高毒', '汞环境累积', '不可与酸或含卤废液混倒'],
  },
  {
    aliases: ['纳氏试剂', 'nessler reagent', 'nessler'],
    tags: ['mercury', 'heavy_metal', 'strong_base'],
    hazards: ['含汞', '强碱性', '高毒'],
  },
  {
    aliases: ['碘化汞', 'mercuric iodide', 'mercury iodide', 'hgi2'],
    cas: '7774-29-0',
    tags: ['mercury', 'heavy_metal'],
    hazards: ['高毒', '汞环境累积'],
  },
  {
    aliases: ['碘化钾', 'potassium iodide', 'ki'],
    cas: '7681-11-0',
    tags: [],
    hazards: ['常规无机试剂'],
  },
  {
    aliases: ['氢氧化钠', 'sodium hydroxide', 'naoh'],
    cas: '1310-73-2',
    tags: ['strong_base'],
    hazards: ['强腐蚀性', '遇酸放热'],
  },
  {
    aliases: ['酒石酸钾钠', 'potassium sodium tartrate', 'rochelle salt'],
    cas: '304-59-6',
    tags: [],
    hazards: ['常规络合剂'],
  },
  {
    aliases: ['氨氮标准溶液', '氯化铵', 'ammonium chloride', 'nh4cl'],
    cas: '12125-02-9',
    tags: [],
    hazards: ['常规低浓度标准溶液'],
  },
  {
    aliases: ['氢氟酸', 'hydrofluoric acid', 'hf'],
    cas: '7664-39-3',
    tags: ['strong_acid', 'hydrofluoric_acid', 'fluoride'],
    hazards: ['深度组织腐蚀', '低钙血症风险', '必须使用含氟专项废液桶'],
  },
  {
    aliases: ['氟化钠', 'sodium fluoride', 'naf'],
    cas: '7681-49-4',
    tags: ['fluoride'],
    hazards: ['有毒', '含氟废液须专项收集'],
  },
  {
    aliases: ['硝酸', 'nitric acid', 'hno3'],
    cas: '7697-37-2',
    tags: ['strong_acid', 'strong_oxidizer'],
    hazards: ['强腐蚀性', '强氧化性'],
  },
  {
    aliases: ['盐酸', 'hydrochloric acid', 'hcl'],
    cas: '7647-01-0',
    tags: ['strong_acid'],
    hazards: ['强腐蚀性', '酸雾刺激'],
  },
  {
    aliases: ['高氯酸', 'perchloric acid', 'hclo4'],
    cas: '7601-90-3',
    tags: ['strong_acid', 'strong_oxidizer'],
    hazards: ['强腐蚀性', '强氧化性', '与有机物接触有爆炸风险'],
  },
  {
    aliases: ['高锰酸钾', 'potassium permanganate', 'kmno4'],
    cas: '7722-64-7',
    tags: ['strong_oxidizer'],
    hazards: ['强氧化性', '不可与有机物或还原剂混放'],
  },
  {
    aliases: ['氯酸钾', 'potassium chlorate', 'kclo3'],
    cas: '3811-04-9',
    tags: ['strong_oxidizer'],
    hazards: ['强氧化性', '与硫酸或可燃物混合有爆炸风险'],
  },
  {
    aliases: ['高氯酸钠', 'sodium perchlorate', 'naclo4'],
    cas: '7601-89-0',
    tags: ['strong_oxidizer'],
    hazards: ['强氧化性', '与还原剂形成爆炸性混合物'],
  },
  {
    aliases: ['过氧化氢', '双氧水', 'hydrogen peroxide', 'h2o2'],
    cas: '7722-84-1',
    tags: ['strong_oxidizer'],
    hazards: ['氧化性', '分解产氧', '不可与有机物混倒'],
  },
  {
    aliases: ['硫化钠', 'sodium sulfide', 'na2s'],
    cas: '1313-82-2',
    tags: ['sulfide'],
    hazards: ['遇酸释放硫化氢', '强还原性'],
  },
  {
    aliases: ['硫化氢', 'hydrogen sulfide', 'h2s'],
    cas: '7783-06-4',
    tags: ['sulfide'],
    hazards: ['剧毒气体', '遇酸释放'],
  },
  {
    aliases: ['氰化钾', 'potassium cyanide', 'kcn'],
    cas: '151-50-8',
    tags: ['cyanide'],
    hazards: ['剧毒', '遇酸释放氰化氢'],
  },
  {
    aliases: ['氰化钠', 'sodium cyanide', 'nacn'],
    cas: '143-33-9',
    tags: ['cyanide'],
    hazards: ['剧毒', '遇酸释放氰化氢'],
  },
  {
    aliases: ['三氯甲烷', '氯仿', 'chloroform', 'chcl3'],
    cas: '67-66-3',
    tags: ['halogenated_organic'],
    hazards: ['含卤有机废液', '有毒', '不可与非卤有机溶剂混倒'],
  },
  {
    aliases: ['二氯甲烷', 'dichloromethane', 'dcm', 'ch2cl2'],
    cas: '75-09-2',
    tags: ['halogenated_organic'],
    hazards: ['含卤有机废液', '易挥发', '不可与非卤有机溶剂混倒'],
  },
  {
    aliases: ['四氯化碳', 'carbon tetrachloride', 'ccl4'],
    cas: '56-23-5',
    tags: ['halogenated_organic'],
    hazards: ['含卤有机废液', '高毒', '不可与非卤有机溶剂混倒'],
  },
  {
    aliases: ['正己烷', 'hexane', 'c6h14'],
    cas: '110-54-3',
    tags: ['nonhalogenated_organic'],
    hazards: ['非卤有机废液', '易燃', '不可与含卤有机废液混倒'],
  },
  {
    aliases: ['丙酮', 'acetone'],
    cas: '67-64-1',
    tags: ['nonhalogenated_organic'],
    hazards: ['非卤有机废液', '易燃'],
  },
  {
    aliases: ['甲醇', 'methanol', 'ch3oh'],
    cas: '67-56-1',
    tags: ['nonhalogenated_organic'],
    hazards: ['非卤有机废液', '易燃', '有毒'],
  },
  {
    aliases: ['乙醇', 'ethanol', 'c2h5oh'],
    cas: '64-17-5',
    tags: ['nonhalogenated_organic'],
    hazards: ['非卤有机废液', '易燃'],
  },
  {
    aliases: ['苯', 'benzene'],
    cas: '71-43-2',
    tags: ['nonhalogenated_organic'],
    hazards: ['非卤有机废液', '致癌', '易燃'],
  },
  {
    aliases: ['甲苯', 'toluene'],
    cas: '108-88-3',
    tags: ['nonhalogenated_organic'],
    hazards: ['非卤有机废液', '易燃', '有毒'],
  },
  {
    aliases: ['硫酸', 'sulfate'],
    tags: [],
    hazards: ['常规硫酸盐'],
  },
];

const DANGEROUS_TAGS = new Set<HazardTag>([
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
]);

export function normalizeText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, '').replace(/[（(].*?[)）]/g, '');
}

export function inferHazardTags(text: string): HazardTag[] {
  const normalized = normalizeText(text);
  const tags = new Set<HazardTag>();

  for (const entry of REAGENT_CATALOG) {
    if (entry.aliases.some((alias) => normalized.includes(normalizeText(alias)))) {
      entry.tags.forEach((tag) => tags.add(tag));
    }
  }

  if (/强酸|酸性废液/.test(text)) tags.add('strong_acid');
  if (/强碱|碱性废液|naoh|氢氧化钠/.test(normalized)) tags.add('strong_base');
  if (/六价铬|铬酸盐|重铬酸/.test(text)) tags.add('chromium_vi');
  if (/含汞|汞盐/.test(text)) tags.add('mercury');
  if (/含氟|氟化物/.test(text)) {
    tags.add('fluoride');
    if (/氢氟酸|hf/.test(normalized)) tags.add('hydrofluoric_acid');
  }
  if (/含卤|卤代/.test(text)) tags.add('halogenated_organic');
  if (/非卤|无卤/.test(text)) tags.add('nonhalogenated_organic');
  return [...tags];
}

export function hasDangerousHazard(tags: HazardTag[]): boolean {
  return tags.some((tag) => DANGEROUS_TAGS.has(tag));
}

export function isKnownReagent(text: string): boolean {
  const normalized = normalizeText(text);
  return REAGENT_CATALOG.some((entry) =>
    entry.aliases.some((alias) => normalized.includes(normalizeText(alias))),
  );
}

export function lookupCatalogEntry(text: string): CatalogEntry | undefined {
  const normalized = normalizeText(text);
  return REAGENT_CATALOG.find((entry) =>
    entry.aliases.some((alias) => normalized.includes(normalizeText(alias))),
  );
}

export function getComponentTags(components: string[]): Set<HazardTag> {
  return new Set(components.flatMap(inferHazardTags));
}

export function parseReagentList(text: string): ReagentInfo[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      const name = line.split(/[（(]/)[0].trim();
      const entry = lookupCatalogEntry(line);
      return {
        name: name || `未命名试剂 ${index + 1}`,
        cas: entry?.cas,
        concentration: line.match(/[（(]([^）)]*(?:mol\/L|%|g\/L)[^）)]*)/)?.[1],
        amount: line.match(/(\d+(?:\.\d+)?\s*(?:mL|L|g|mg|kg))/)?.[1],
        categories: inferHazardTags(line),
        hazards: entry?.hazards ?? ['目录未覆盖，须核实 SDS 并由人工确认危险属性'],
      } satisfies ReagentInfo;
    });
}
