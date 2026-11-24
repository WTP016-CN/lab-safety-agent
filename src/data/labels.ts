import type { HazardTag, RiskLevel, WasteCategory } from '../agent/types';

export const RISK_LABELS: Record<RiskLevel, string> = { low: '低危', medium: '中危', high: '高危' };

export const WASTE_CATEGORY_LABELS: Record<WasteCategory, string> = {
  inorganic_acid: '无机酸性废液',
  alkali: '碱性废液',
  heavy_metal: '含重金属废液',
  chromium: '含铬专项废液',
  mercury: '含汞专项废液',
  fluoride: '含氟废液',
  cyanide: '含氰废液',
  sulfide: '含硫化物废液',
  halogenated_organic: '含卤有机废液',
  non_halogenated_organic: '非卤有机废液',
  contaminated_solid: '沾染危废固体',
  other: '其他实验废液',
};

export const HAZARD_LABELS: Record<HazardTag, string> = {
  strong_acid: '腐蚀性',
  concentrated_sulfuric_acid: '强腐蚀 · 遇水放热',
  strong_base: '腐蚀性',
  strong_oxidizer: '氧化性',
  organic_reducer: '还原性',
  cyanide: '剧毒 · 遇酸放气',
  sulfide: '遇酸放出 H₂S',
  fluoride: '含氟腐蚀性',
  hydrofluoric_acid: 'HF 专项风险',
  mercury: '含汞毒性',
  chromium_vi: '六价铬毒性',
  heavy_metal: '重金属毒性',
  halogenated_organic: '含卤有机',
  nonhalogenated_organic: '易燃有机',
};
