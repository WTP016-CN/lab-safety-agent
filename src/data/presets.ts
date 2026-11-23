import type { ExperimentInput } from '../agent/types';

export interface ExperimentPreset extends ExperimentInput {
  id: 'cod' | 'soil' | 'ammonia';
  label: string;
  path: string;
  icon: string;
}

export const PRESETS: ExperimentPreset[] = [
  {
    id: 'cod',
    label: '重铬酸钾法测定水样 COD',
    path: '完整高危 · 自动校验与重写',
    icon: 'flask',
    name: '重铬酸钾法测定水样 COD',
    procedure: '取 20.0 mL 水样，加入 10.0 mL 0.25 mol/L 重铬酸钾标准溶液、0.4 g 硫酸汞及 30 mL 硫酸银-浓硫酸溶液，连接回流冷凝装置，在通风橱内加热回流 2 小时。冷却后稀释、滴定，并收集全部消解残液和冲洗液。',
    reagentListText: '重铬酸钾（0.25 mol/L，10.0 mL，CAS 7778-50-9）\n浓硫酸（98%，约 30 mL，CAS 7664-93-9）\n硫酸银（溶于浓硫酸，CAS 10294-26-3）\n硫酸汞（0.4 g，CAS 7783-35-9）',
  },
  {
    id: 'soil',
    label: '土壤重金属酸消解前处理',
    path: '信息缺失 · 动态多轮追问',
    icon: 'mountain',
    name: '土壤重金属酸消解前处理',
    procedure: '用混合酸消解土样测铅镉。',
    reagentListText: '混合酸（具体种类与用量待补充）',
  },
  {
    id: 'ammonia',
    label: '纳氏试剂分光光度法测氨氮',
    path: '常见分析 · 含汞碱性废液',
    icon: 'waves',
    name: '纳氏试剂分光光度法测氨氮',
    procedure: '取适量水样，加入酒石酸钾钠溶液掩蔽干扰，加入纳氏试剂显色，在 420 nm 测定吸光度。实验在通风橱内进行，不加热；纳氏试剂每份样品加入 1.0 mL，显色液和润洗液全部收集。',
    reagentListText: '纳氏试剂（含碘化汞、碘化钾、氢氧化钠，每份 1.0 mL）\n酒石酸钾钠溶液（500 g/L，每份 1.0 mL）\n氨氮标准溶液（已知浓度）',
  },
];
