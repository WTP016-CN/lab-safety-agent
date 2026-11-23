import { describe, expect, it } from 'vitest';
import { applyPdfExtraction, splitExperimentText } from '../src/utils/pdfExtract';

describe('PDF text import', () => {
  it('falls back to full text when sections cannot be identified', () => {
    const result = splitExperimentText('实验名称：COD 测定\n加入试剂并加热');
    expect(result.title).toContain('COD');
    expect(result.procedure).toContain('加入试剂');
    expect(result.reagentListText).toBe('');
  });

  it('splits procedure and reagent sections when headings are present', () => {
    const result = splitExperimentText('实验名称：COD 测定\n实验步骤：加入试剂并加热\n试剂清单：浓硫酸');
    expect(result.procedure).toContain('加入试剂');
    expect(result.reagentListText).toContain('浓硫酸');
  });

  it('merges extraction without overwriting an existing name or reagent list', () => {
    const merged = applyPdfExtraction(
      { name: '已有名称', procedure: '已有步骤', reagentListText: '已有试剂' },
      { title: '识别名称', procedure: '识别步骤', reagentListText: '', pageCount: 1, visionPageCount: 0, mode: 'text' },
    );
    expect(merged.name).toBe('已有名称');
    expect(merged.procedure).toContain('已有步骤');
    expect(merged.procedure).toContain('识别步骤');
    expect(merged.reagentListText).toBe('已有试剂');
  });
});
