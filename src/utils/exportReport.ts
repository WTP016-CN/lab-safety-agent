import type { SessionContext } from '../agent/types';

const riskName = { low: '低危', medium: '中危', high: '高危' } as const;

export function buildMarkdown(session: SessionContext): string {
  const draft = session.draft;
  if (!draft) return '';
  const lines: string[] = [
    `# ${session.input.name} · 实验安全审查报告`,
    '',
    `> 风险评级：**${riskName[draft.riskLevel]}**  `,
    `> 双重校验：**${session.audit.requiresManualReview ? '需人工复核' : '已通过'}**  `,
    `> 生成时间：${new Date(session.updatedAt).toLocaleString('zh-CN')}`,
    '',
    '## 实验输入',
    '',
    session.input.procedure,
    '',
    '### 拟用试剂',
    '',
    ...session.input.reagentListText.split('\n').filter(Boolean).map((line) => `- ${line}`),
    '',
    '## 配伍禁忌预警',
    '',
    ...draft.compatibilityWarnings.flatMap((item) => [
      `### ${item.reagents.join(' + ')}`,
      '',
      `- **风险：** ${item.hazard}`,
      `- **反应：** ${item.reaction}`,
      `- **预防：** ${item.prevention}`,
      '',
    ]),
    '## 个人防护与通风',
    '',
    ...draft.ppe.requiredPpe.map((item) => `- **${item.item}**：${item.specification}。${item.reason}`),
    `- **通风要求：** ${draft.ppe.ventilation}`,
    ...draft.ppe.additionalControls.map((item) => `- ${item}`),
    '',
    '## 安全操作规范（SOP）',
    '',
    ...draft.sop.flatMap((step) => [
      `### ${step.order}. ${step.title}`,
      ...step.actions.map((action) => `- ${action}`),
      ...step.safetyNotes.map((note) => `  - ⚠ ${note}`),
      '',
    ]),
    '## 应急处置',
    '',
    ...draft.emergencyProcedures.flatMap((item) => [
      `### ${item.scenario}`,
      ...item.immediateActions.map((action) => `- ${action}`),
      '',
    ]),
    '## 实验后危废分类收集',
    '',
    ...draft.wasteStreams.flatMap((stream) => [
      `### ${stream.bucketLabel}`,
      '',
      `- **类别：** ${stream.category}`,
      `- **主要成分：** ${stream.mainComponents.join('、')}`,
      `- **容器：** ${stream.containerSpec}`,
      `- **储存：** ${stream.storageNotes}`,
      `- **严禁混入：** ${stream.forbiddenItems.join('；')}`,
      '',
    ]),
    '## 实验前安全自查',
    '',
    ...draft.checklist.map((item) => `- [ ] ${item}`),
    '',
    '---',
    '',
    '本报告由 SafeBeaker 辅助生成。结果仅供实验准备参考，不替代学校 EHS 审批、指导教师确认或现场风险评估。',
  ];
  return lines.join('\n');
}

export function downloadMarkdown(session: SessionContext): void {
  const blob = new Blob([buildMarkdown(session)], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `SafeBeaker_${session.input.name.replace(/[\\/:*?"<>|]/g, '_')}.md`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
