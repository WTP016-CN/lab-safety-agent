import type {
  AgentEngine,
  AiAuditResult,
  ClarificationAnswer,
  ClarificationQuestion,
  ExperimentInput,
  ParseResult,
  ReagentDisposition,
  ReagentInfo,
  SafetyDraft,
  SessionContext,
  WasteStream,
} from './types';
import { parseReagentList } from '../rules/reagentCatalog';

const wait = (milliseconds = 260) => new Promise((resolve) => setTimeout(resolve, milliseconds));

const soilQuestions: ClarificationQuestion[] = [
  {
    id: 'soil_acid',
    prompt: '混合酸的具体组成是什么？',
    control: 'single',
    options: [
      { value: 'hno3_hcl', label: '硝酸 + 盐酸（王水体系）' },
      { value: 'hno3_hcl_hf', label: '硝酸 + 盐酸 + 氢氟酸' },
      { value: 'hno3_h2o2', label: '硝酸 + 过氧化氢' },
      { value: 'uncertain', label: '不确定，需查阅方法后再确认' },
    ],
    required: true,
    allowSupplement: true,
    rationale: '酸体系决定酸雾、氧化性、含氟废液和消解容器要求。',
  },
  {
    id: 'soil_hf',
    prompt: '是否使用氢氟酸（HF）或含氟试剂？',
    control: 'single',
    options: [
      { value: 'yes', label: '使用氢氟酸' },
      { value: 'no', label: '不使用含氟试剂' },
      { value: 'uncertain', label: '不确定' },
    ],
    required: true,
    allowSupplement: false,
    rationale: 'HF 会造成深度组织损伤，并必须进入含氟专项废液桶。',
  },
  {
    id: 'soil_digestion',
    prompt: '采用哪种消解方式？',
    control: 'single',
    options: [
      { value: 'open_hotplate', label: '敞口电热板加热' },
      { value: 'microwave_sealed', label: '微波密闭消解' },
      { value: 'uncertain', label: '尚未确定' },
    ],
    required: true,
    allowSupplement: false,
    rationale: '密闭消解存在压力与氢氟酸腐蚀盲区，需选择专用容器。',
  },
  {
    id: 'soil_scale',
    prompt: '单次样品量与酸用量大约是？',
    control: 'single',
    options: [
      { value: 'small', label: '少量：0.2–0.5 g 样品，酸 < 10 mL' },
      { value: 'medium', label: '常规：0.5–2 g 样品，酸 10–30 mL' },
      { value: 'large', label: '较大：> 2 g 样品或酸 > 30 mL' },
      { value: 'uncertain', label: '不确定' },
    ],
    required: true,
    allowSupplement: true,
    rationale: '试剂规模会影响酸雾、放热以及废液桶容量和二次容器要求。',
  },
];

const isCod = (input: ExperimentInput) => /COD|重铬酸钾法/i.test(input.name) || /重铬酸钾/.test(input.reagentListText);
const isNessler = (input: ExperimentInput) => /纳氏|氨氮/.test(input.name + input.reagentListText);
const isSoil = (input: ExperimentInput) => /土壤|酸消解|铅镉/.test(input.name + input.procedure);

function valuesFor(context: SessionContext, questionId: string): string[] {
  const answer = context.clarificationRounds
    .flatMap((round) => round.answers)
    .find((item) => item.questionId === questionId);
  return answer?.value ?? [];
}

function parseBase(input: ExperimentInput, extraReagents: ReagentInfo[] = []): ParseResult {
  const parsed = parseReagentList(input.reagentListText);
  const seen = new Set(parsed.map((reagent) => reagent.name));
  const reagents = [...parsed, ...extraReagents.filter((reagent) => !seen.has(reagent.name))];
  const highRisk = /重铬酸|浓硫酸|汞|氢氟酸|氰化物|氯酸盐|高氯酸|加热|消解|回流/.test(
    `${input.procedure} ${input.reagentListText}`,
  );
  return {
    experimentSummary: input.procedure.slice(0, 160),
    reagents,
    conditions: [
      ...(/加热|回流/.test(input.procedure) ? [{ type: 'heating' as const, description: '存在加热或回流操作，需在通风橱内进行' }] : []),
      ...(/消解/.test(input.procedure) ? [{ type: 'digestion' as const, description: '样品消解处理' }] : []),
      ...(/密闭|微波/.test(input.procedure) ? [{ type: 'sealed' as const, description: '密闭消解，需关注压力与酸雾' }] : []),
    ],
    initialRisk: highRisk ? 'high' : 'medium',
    riskReasons: highRisk
      ? ['涉及强腐蚀、强氧化、重金属或加热消解条件', '危废必须按危险特性分类并单独贴标', '需核实通风、PPE 与应急处置条件']
      : ['存在常规化学试剂与实验室废液', '需按实际浓度核对 SDS 与院校分类要求'],
    informationComplete: true,
    next_action: 'GENERATE',
    missing_questions: [],
  };
}

function codDraft(context: SessionContext): SafetyDraft {
  const attempt = context.audit.retryCount + 1;
  const bad = attempt === 1;
  const stream: WasteStream = bad
    ? {
        id: 'cod-acid',
        category: 'inorganic_acid',
        bucketLabel: '普通无机酸性废液',
        mainComponents: ['重铬酸钾', '浓硫酸', '硫酸银', '硫酸汞'],
        hazardTags: ['strong_acid'],
        forbiddenItems: ['含卤有机废液', '非卤有机废液'],
        containerSpec: '25 L HDPE 废液桶',
        storageNotes: '通风、防渗、远离还原性物质',
      }
    : {
        id: 'cod-metal',
        category: 'heavy_metal',
        bucketLabel: '含铬、含汞酸性重金属专项废液',
        mainComponents: ['重铬酸钾', '浓硫酸', '硫酸银', '硫酸汞'],
        hazardTags: ['chromium_vi', 'mercury', 'heavy_metal', 'strong_acid'],
        forbiddenItems: ['含卤有机废液', '非卤有机废液', '氰化物/硫化物废液'],
        containerSpec: '25 L 耐酸 HDPE 专用桶，外加二次防漏托盘',
        storageNotes: '密闭、通风、避光，远离还原剂和有机物，满 3/4 封盖',
      };
  const disposition: ReagentDisposition[] = ['重铬酸钾', '浓硫酸', '硫酸银', '硫酸汞'].map((reagentName) => ({
    reagentName,
    destination: 'waste_stream',
    wasteStreamId: stream.id,
    note: bad ? '并入普通酸桶（模拟错误草稿）' : '进入含铬含汞酸性重金属专项桶',
  }));
  return {
    draftId: `mock-cod-${attempt}`,
    attempt,
    riskLevel: 'high',
    riskRationale: ['回流消解使用浓硫酸与重铬酸钾，存在强腐蚀、强氧化和六价铬暴露', '硫酸汞用于掩蔽氯离子，产生含汞有毒废液', '酸性消解液必须按含铬、含汞专项危废单独收集'],
    compatibilityWarnings: [
      {
        id: 'cod-warning-1',
        severity: 'high',
        reagents: ['浓硫酸', '重铬酸钾'],
        hazard: '强酸 + 强氧化剂/六价铬体系',
        reaction: '与有机物或还原性物质接触可剧烈反应，并可能产生热失控。',
        prevention: '严禁与有机废液、还原剂共桶；在通风橱内缓慢加酸并持续冷却。',
        relatedRuleId: 'SAFE-003',
      },
      {
        id: 'cod-warning-2',
        severity: 'high',
        reagents: ['硫酸汞', '酸性废液'],
        hazard: '含汞废液混入普通酸桶',
        reaction: '增加含汞危废扩散和处置风险，污染整桶酸液。',
        prevention: '使用含汞专项标识；含铬、含汞消解液共用一个酸性重金属专项桶并双倍标识。',
        relatedRuleId: 'SAFE-006',
      },
    ],
    ppe: {
      requiredPpe: [
        { item: '耐酸碱丁腈手套', specification: '双层，厚度 ≥ 0.11 mm', reason: '防止浓硫酸和六价铬溶液渗透' },
        { item: '化学护目镜', specification: '带侧翼密封', reason: '防止回流喷溅与酸雾损伤' },
        { item: '耐酸围裙/实验服', specification: '防渗材质', reason: '保护躯干和大腿' },
        { item: '面屏', specification: '加样和开瓶时加戴', reason: '抑制剧烈反应时的飞溅' },
      ],
      ventilation: '所有加酸、连接回流装置和拆解步骤必须在正常运行的全排风通风橱内进行，排风控制器不得关闭。',
      additionalControls: ['准备洗眼器并确认 15 秒内可达', '设置二次防漏托盘', '两人作业并保持疏散通道畅通'],
    },
    sop: [
      { order: 1, title: '实验前核查与预冷', actions: ['核对重铬酸钾、硫酸汞和浓硫酸标签及 SDS', '检查回流冷凝水、通风橱和洗眼器'], safetyNotes: ['禁止佩戴隐形眼镜操作强酸', '通风橱内不得存放无关有机物'] },
      { order: 2, title: '加酸与消解', actions: ['将水样和重铬酸钾加入回流瓶', '在通风橱内沿壁缓慢加入硫酸银-浓硫酸并摇匀'], safetyNotes: ['严禁将水直接倒入浓硫酸', '加酸过程若明显放热应暂停并冷却'] },
      { order: 3, title: '回流与冷却', actions: ['连接冷凝管并开启冷却水', '按方法加热回流 2 小时，结束后自然冷却'], safetyNotes: ['加热期间人员不得离岗', '冷却前不得打开回流装置'] },
      { order: 4, title: '废液收集与区域清理', actions: ['将消解残液、润洗液全部倒入含铬含汞专项桶', '检查台面、玻璃器皿与托盘并用专用吸收材料处理滴漏'], safetyNotes: ['严禁将消解液倒入普通酸桶', '废液桶满 3/4 即封盖并移交学校 EHS'] },
    ],
    emergencyProcedures: [
      { scenario: '酸液溅到皮肤或眼睛', immediateActions: ['立即前往洗眼器/淋浴持续冲洗至少 15 分钟', '脱去污染衣物，不可自行中和', '报告指导教师并就医'] },
      { scenario: '少量含铬/含汞废液泄漏', immediateActions: ['疏散无关人员并设置警戒', '穿戴适配 PPE 后用专用吸附材料收集', '污染物全部作为危险废物密封标识，报告 EHS'] },
    ],
    wasteStreams: [stream],
    reagentDisposition: disposition,
    checklist: ['已阅读全部试剂 SDS 并确认个人过敏史', '通风橱风速和洗眼器状态已确认', '回流装置与冷凝水连接牢固', '含铬含汞专项废液桶标签、二次容器已就位', '指导教师已确认消解与废液分类方案'],
  };
}

function nesslerDraft(context: SessionContext): SafetyDraft {
  const stream: WasteStream = {
    id: 'nessler-mercury',
    category: 'mercury',
    bucketLabel: '含汞强碱性分析废液',
    mainComponents: ['纳氏试剂', '酒石酸钾钠', '氨氮标准溶液'],
    hazardTags: ['mercury', 'heavy_metal', 'strong_base'],
    forbiddenItems: ['酸性废液', '含卤有机废液', '非卤有机废液'],
    containerSpec: '10 L 耐碱 HDPE 专用桶，外加二次防漏托盘',
    storageNotes: '密闭、避光、远离酸类，满 3/4 封盖',
  };
  return {
    draftId: 'mock-nessler-1',
    attempt: context.audit.retryCount + 1,
    riskLevel: 'high',
    riskRationale: ['纳氏试剂含碘化汞与氢氧化钠，具有含汞毒性和强碱性', '显色废液不得与酸、含卤或非卤有机废液混倒', '含汞废液须进入专项桶并移交 EHS'],
    compatibilityWarnings: [
      {
        id: 'nessler-warning-1',
        severity: 'high',
        reagents: ['纳氏试剂', '酸性样品'],
        hazard: '含汞强碱性废液遇酸',
        reaction: '可能放热、破坏试剂体系，并增加汞形态转化和暴露风险。',
        prevention: '废液单独收集，不与任何酸性废液共桶；废液桶明确标注含汞和强碱性。',
        relatedRuleId: 'SAFE-006',
      },
    ],
    ppe: {
      requiredPpe: [
        { item: '丁腈手套', specification: '一次性，接触后立即更换', reason: '防止含汞试剂接触皮肤' },
        { item: '化学护目镜', specification: '带侧翼', reason: '防止比色管液体飞溅' },
        { item: '防渗实验服', specification: '长袖', reason: '减少皮肤暴露' },
      ],
      ventilation: '纳氏试剂移取和显色操作应在通风橱或局部排风装置内进行，避免吸入汞蒸气与碱性气溶胶。',
      additionalControls: ['含汞废液桶使用二次容器', '台面使用一次性防渗垫并及时更换'],
    },
    sop: [
      { order: 1, title: '准备与检查', actions: ['核对纳氏试剂标签和有效期', '在操作区铺设防渗垫并准备含汞废液桶'], safetyNotes: ['禁止将纳氏试剂存放在酸类附近'] },
      { order: 2, title: '显色与测定', actions: ['加入酒石酸钾钠掩蔽干扰', '加入纳氏试剂后混匀并静置显色'], safetyNotes: ['避免吸入气溶胶，比色管加盖混匀'] },
      { order: 3, title: '废液收集', actions: ['显色液、清洗液和润洗液全部倒入含汞强碱性专用桶'], safetyNotes: ['严禁倒入酸性废液或有机废液桶'] },
    ],
    emergencyProcedures: [
      { scenario: '皮肤接触含汞试剂', immediateActions: ['立即用大量清水冲洗至少 15 分钟', '脱去污染物并报告指导教师', '携带试剂成分信息就医'] },
      { scenario: '少量 spilled 试剂', immediateActions: ['停止操作并疏散无关人员', '使用汞专用吸附/收集工具清理，禁止使用普通吸尘器', '密封后按含汞危废标识并报告 EHS'] },
    ],
    wasteStreams: [stream],
    reagentDisposition: [
      { reagentName: '纳氏试剂', destination: 'waste_stream', wasteStreamId: stream.id, note: '含汞强碱性专项桶' },
      { reagentName: '酒石酸钾钠溶液', destination: 'waste_stream', wasteStreamId: stream.id, note: '并入含汞碱性分析废液' },
      { reagentName: '氨氮标准溶液', destination: 'waste_stream', wasteStreamId: stream.id, note: '低浓度标准液并入分析废液' },
    ],
    checklist: ['含汞废液专用桶、标签和二次容器已就位', '通风橱运行正常并远离酸类', '台面防渗垫已铺设', '操作人员已阅读 SDS 并知晓汞暴露处置'],
  };
}

function soilDraft(context: SessionContext): SafetyDraft {
  const acid = valuesFor(context, 'soil_acid')[0] ?? 'hno3_hcl';
  const hf = valuesFor(context, 'soil_hf')[0] === 'yes' || acid === 'hno3_hcl_hf';
  const digestion = valuesFor(context, 'soil_digestion')[0] ?? 'open_hotplate';
  const streams: WasteStream[] = [
    {
      id: 'soil-metal',
      category: 'heavy_metal',
      bucketLabel: '含铅镉酸性重金属废液',
      mainComponents: ['硝酸', '盐酸', '铅', '镉'],
      hazardTags: ['heavy_metal', 'strong_acid'],
      forbiddenItems: ['含氟废液', '含汞废液', '有机废液'],
      containerSpec: '25 L 耐酸 HDPE 桶，外加二次防漏托盘',
      storageNotes: '密闭、通风、远离碱和还原剂，满 3/4 封盖',
    },
    ...(hf ? [{
      id: 'soil-fluoride',
      category: 'fluoride' as const,
      bucketLabel: '含氟（HF）专项废液',
      mainComponents: ['氢氟酸', '硝酸', '盐酸'],
      hazardTags: ['fluoride' as const, 'hydrofluoric_acid' as const, 'strong_acid' as const],
      forbiddenItems: ['含汞废液', '含六价铬废液', '非卤有机废液'],
      containerSpec: '10 L HDPE 含氟专用桶',
      storageNotes: '密闭、防渗、注明 HF 急救信息，远离玻璃容器',
    }] : []),
    {
      id: 'soil-solid',
      category: 'contaminated_solid',
      bucketLabel: '沾染酸液的废手套与吸水纸',
      mainComponents: ['实验手套', '吸水纸'],
      hazardTags: [],
      forbiddenItems: ['一般生活垃圾', '可回收物'],
      containerSpec: '带内衬的危废固体收集袋',
      storageNotes: '密封后标注实验名称和日期，移交学校危废暂存点',
    },
  ];
  const dispositions: ReagentDisposition[] = [
    { reagentName: '混合酸', destination: 'waste_stream', wasteStreamId: 'soil-metal', note: '按实际酸体系进入酸性重金属废液' },
    { reagentName: '硝酸', destination: 'waste_stream', wasteStreamId: 'soil-metal', note: '酸性重金属废液' },
    { reagentName: '盐酸', destination: 'waste_stream', wasteStreamId: 'soil-metal', note: '酸性重金属废液' },
    { reagentName: '铅', destination: 'waste_stream', wasteStreamId: 'soil-metal', note: '含铅重金属废液' },
    { reagentName: '镉', destination: 'waste_stream', wasteStreamId: 'soil-metal', note: '含镉重金属废液' },
    ...(hf ? [{ reagentName: '氢氟酸', destination: 'waste_stream' as const, wasteStreamId: 'soil-fluoride', note: 'HF 专项收集' }] : []),
  ];
  return {
    draftId: 'mock-soil-1',
    attempt: context.audit.retryCount + 1,
    riskLevel: hf ? 'high' : 'medium',
    riskRationale: [
      '土壤消解使用强酸并产生含铅、镉的重金属废液',
      hf ? '使用氢氟酸，存在深度组织腐蚀和低钙血症风险，必须使用含氟专项桶和葡萄糖酸钙应急物资' : '未使用含氟试剂，但仍需防止酸雾与重金属暴露',
      digestion === 'microwave_sealed' ? '微波密闭消解涉及压力容器和酸雾释放风险，必须遵循设备操作规程' : '敞口加热会产生酸雾，应在通风橱内进行',
    ],
    compatibilityWarnings: [
      {
        id: 'soil-warning-1',
        severity: 'high',
        reagents: ['强酸', '重金属'],
        hazard: '酸性重金属废液不得混入含汞或有机废液',
        reaction: '混合后增加处置难度和人员暴露风险。',
        prevention: '按含铅镉酸性重金属废液单独收集；若使用 HF，再进入独立含氟桶。',
        relatedRuleId: 'SAFE-009',
      },
    ],
    ppe: {
      requiredPpe: [
        { item: '耐酸碱手套', specification: '丁腈/丁基材质，HF 场景备专用手套', reason: '防止酸和重金属溶液接触' },
        { item: '化学护目镜与面屏', specification: '加酸时面屏', reason: '防酸雾和飞溅' },
        { item: '防渗实验服', specification: '长袖', reason: '减少躯干污染' },
        ...(hf ? [{ item: 'HF 应急物资', specification: '葡萄糖酸钙凝胶与冲洗水源', reason: 'HF 接触需立即处置并就医' }] : []),
      ],
      ventilation: '土壤酸消解全程在通风橱内进行；若为微波密闭消解，开罐前充分冷却并在通风橱中完成卸压。',
      additionalControls: ['检查消解容器材质与 HJ 方法要求', '准备二次防漏托盘', '避免将含氟废液与玻璃容器长期接触'],
    },
    sop: [
      { order: 1, title: '样品与方案确认', actions: ['核对土壤样品量、酸体系和消解设备', '确认冷却、通风和废液桶已就位'], safetyNotes: ['HF 使用前确认葡萄糖酸钙凝胶在有效期内'] },
      { order: 2, title: '加酸与消解', actions: ['在通风橱内缓慢加入混合酸', '按选定方式完成升温或微波消解'], safetyNotes: ['严禁密闭状态下加酸', '开罐前必须充分冷却'] },
      { order: 3, title: '废液与固体收集', actions: ['将消解液、润洗液倒入含铅镉酸性重金属桶', hf ? '含 HF 的残液单独倒入含氟专项桶' : '检查并收集含酸废手套与吸水纸'], safetyNotes: ['不同类别废液严禁混倒'] },
    ],
    emergencyProcedures: [
      { scenario: '强酸溅到皮肤/眼睛', immediateActions: ['立即冲洗至少 15 分钟', '脱去污染衣物并报告指导教师', '就医时提供酸种类和浓度'] },
      { scenario: 'HF 接触皮肤', immediateActions: ['立即用大量清水冲洗并尽快使用葡萄糖酸钙凝胶', '不要延误就医，即使当时无明显疼痛也要报告', '通知实验室负责人和校医院'] },
      { scenario: '消解罐压力异常', immediateActions: ['停止加热并撤离周围人员', '等待设备完全冷却，不得强行开罐', '报告设备管理员并按厂家规程处置'] },
    ],
    wasteStreams: streams,
    reagentDisposition: dispositions,
    checklist: ['酸体系、HF 使用与消解方式已确认', '通风橱和消解设备状态正常', '含铅镉酸性废液桶与含氟专项桶标签完整', hf ? 'HF 急救物资和葡萄糖酸钙凝胶已就绪' : '酸性废液二次防漏设施已就位', '指导教师已确认废液分类与暂存要求'],
  };
}

function genericDraft(context: SessionContext): SafetyDraft {
  const reagents = parseReagentList(context.input.reagentListText);
  const components = reagents.map((reagent) => reagent.name);
  const stream: WasteStream = {
    id: 'general-acid',
    category: 'inorganic_acid',
    bucketLabel: '常规无机实验废液（待人工确认）',
    mainComponents: components.length ? components : ['实验废液'],
    hazardTags: ['strong_acid'],
    forbiddenItems: ['含汞废液', '含铬废液', '含卤有机废液', '非卤有机废液'],
    containerSpec: '按学校 EHS 要求选用 HDPE 废液桶',
    storageNotes: '实验后由指导教师核对实际类别，严禁凭演示结果直接入桶',
  };
  return {
    draftId: 'mock-generic-1',
    attempt: context.audit.retryCount + 1,
    riskLevel: 'medium',
    riskRationale: ['演示引擎按保守规则生成通用方案', '未知试剂和实际浓度必须由人工对照 SDS 复核'],
    compatibilityWarnings: [],
    ppe: {
      requiredPpe: [{ item: '护目镜', specification: '带侧翼', reason: '基础化学飞溅防护' }, { item: '实验服', specification: '防渗长袖', reason: '基础身体防护' }],
      ventilation: '涉及挥发性或腐蚀性试剂时在通风橱内操作。',
      additionalControls: ['核对全部试剂 SDS', '由指导教师确认危废分类'],
    },
    sop: [
      { order: 1, title: '人工确认实验方案', actions: ['根据演示信息核对实际试剂、浓度和操作条件'], safetyNotes: ['此草稿仅供演示，不可直接用于实验'] },
    ],
    emergencyProcedures: [{ scenario: '不明化学品泄漏', immediateActions: ['停止操作、疏散无关人员', '报告实验室负责人，按 SDS 和现场预案处置'] }],
    wasteStreams: [stream],
    reagentDisposition: reagents.map((reagent) => ({
      reagentName: reagent.name,
      destination: 'waste_stream',
      wasteStreamId: stream.id,
      note: '保守归入通用桶，待人工确认实际分类',
    })),
    checklist: ['试剂与操作条件已由指导教师确认', '废液分类已由 EHS 核实'],
  };
}

/** Deterministic demo agent. It deliberately produces one unsafe first COD draft. */
export class MockAgentEngine implements AgentEngine {
  async parse(input: ExperimentInput): Promise<ParseResult> {
    await wait(420);
    if (isSoil(input)) {
      const base = parseBase(input);
      return {
        ...base,
        initialRisk: 'high',
        informationComplete: false,
        next_action: 'CLARIFY',
        missing_questions: soilQuestions,
        riskReasons: ['混合酸种类与浓度未说明', '未说明是否使用氢氟酸', '未说明消解方式和样品量'],
        conditions: [{ type: 'digestion', description: '土壤混合酸消解，具体条件待补充' }],
      };
    }
    if (isCod(input) || isNessler(input)) return parseBase(input);
    return {
      ...parseBase(input),
      initialRisk: 'medium',
      informationComplete: false,
      next_action: 'CLARIFY',
      missing_questions: [{
        id: 'generic_scale',
        prompt: '请补充单次试剂用量和是否涉及加热或密闭操作。',
        control: 'single',
        options: [
          { value: 'small_ambient', label: '小量、常温、敞口操作' },
          { value: 'heated', label: '涉及加热或回流' },
          { value: 'sealed', label: '涉及密闭/压力操作' },
          { value: 'uncertain', label: '不确定' },
        ],
        required: true,
        allowSupplement: true,
        rationale: '演示引擎需要基本规模与操作条件才能给出可靠方案。',
      }],
    };
  }

  async clarify(context: SessionContext): Promise<ParseResult> {
    await wait(260);
    if (!isSoil(context.input)) return parseBase(context.input);
    const answers: ClarificationAnswer[] = context.clarificationRounds.flatMap((round) => round.answers);
    const followUpAnswer = answers.find((item) => item.questionId === 'soil_clarify_again');
    if (!followUpAnswer) {
      const uncertain = answers.some((item) => item.value.includes('uncertain'));
      if (uncertain) {
        return {
          ...parseBase(context.input),
          initialRisk: 'high',
          informationComplete: false,
          next_action: 'CLARIFY',
          missing_questions: [{
            id: 'soil_clarify_again',
            prompt: '仍有关键安全条件未确定。请查阅实验方法后补充混合酸组成、HF 使用与消解方式。',
            control: 'single',
            options: [
              { value: 'confirmed', label: '已确认：采用硝酸+盐酸敞口消解，不使用 HF' },
              { value: 'confirmed_hf', label: '已确认：使用硝酸+盐酸+氢氟酸消解' },
              { value: 'uncertain', label: '暂时无法确认，先只生成人工复核清单' },
            ],
            required: true,
            allowSupplement: true,
            rationale: '选择“不确定”不能支持可靠的废液分类与 HF 风险判断。',
          }],
        };
      }
    }
    const base = parseBase(context.input);
    return {
      ...base,
      informationComplete: true,
      next_action: 'GENERATE',
      missing_questions: [],
      riskReasons: [
        '酸消解产生含铅镉酸性重金属废液',
        ...(valuesFor(context, 'soil_hf')[0] === 'yes' ? ['使用氢氟酸，必须单独收集含氟废液'] : []),
        valuesFor(context, 'soil_digestion')[0] === 'microwave_sealed' ? '微波密闭消解存在压力风险' : '敞口加热会产生酸雾',
      ],
    };
  }

  async generate(context: SessionContext): Promise<SafetyDraft> {
    await wait(500);
    if (isCod(context.input)) return codDraft(context);
    if (isNessler(context.input)) return nesslerDraft(context);
    if (isSoil(context.input)) return soilDraft(context);
    return genericDraft(context);
  }

  async audit(_context: SessionContext, draft: SafetyDraft): Promise<AiAuditResult> {
    await wait(360);
    const firstCodDraft = draft.draftId === 'mock-cod-1';
    if (firstCodDraft) {
      return {
        passed: false,
        issues: [
          '含六价铬与含汞消解液被归入普通无机酸废液，缺少铬/汞专项标识与独立收集要求。',
          '建议将同一份消解液统一收集到含铬、含汞酸性重金属专项桶，而非物理拆分。',
        ],
      };
    }
    return { passed: true, issues: [] };
  }
}
