# SafeBeaker

面向环境科学与工程实验的多步安全与危废处置审查助手。纯前端应用，支持 OpenAI-Compatible API 和完整离线演示。

## 本地运行

```powershell
npm install
npm run dev
```

打开 `http://localhost:5173`。无 API Key 时默认开启离线演示；右上角可配置 DeepSeek 或任意第三方 API 链接（接口地址、模型名和 API Key 均需自行填写，且地址须完整填到 `/chat/completions`）。DeepSeek 默认端点为 `https://api.deepseek.com/chat/completions`，填写 API Key 后设置弹窗会自动拉取可用模型。

```powershell
npm test
npm run build
npm run preview
```

## Agent 流程

`INPUT/PARSE → CLARIFY（按需、多轮）→ GENERATE → AUDIT → REPORT`

- 解析节点返回 `next_action`，决定是否进入结构化追问。
- 会话保留原始输入、全部追问与回答、历次草稿审核和状态日志。
- 草稿由本地确定性规则与独立 AI 审核员交叉校验。
- 失败且重写少于 2 次时携带问题自动重写；达到上限后进入报告并显示人工复核警告。
- 模型输出经代码块清洗、JSON 解析与 Zod 运行时校验。网络或格式错误保留当前上下文，支持单步重试。

## 上传实验 PDF

在真实模型模式且已配置 API Key 时，新建审查页可上传实验 PDF：

- 优先读取 PDF 文本层，支持多页，并把识别内容合并填入“实验步骤”和“拟用试剂清单”；已有实验名称不会被覆盖。
- 无法自动区分步骤与试剂时，完整文本优先填入实验步骤，试剂清单留空由用户整理。
- 文本层为空或页面为扫描件时，会把关键页面渲染为图片，通过已配置的 OpenAI-Compatible 模型以视觉消息识别。扫描版依赖所选模型支持视觉输入，请求超时约 90 秒，失败可重试。
- PDF、页面图片和 API Key 不会持久化；文件只在本机浏览器处理，或发送给用户配置的模型。识别文本仅保留在当前页面组件状态中，刷新即丢失。

## 模块

- `src/agent/stateMachine.ts`：会话、状态转换和日志。
- `src/agent/useWorkflow.ts`：异步节点编排与自动重写闭环。
- `src/agent/llmClient.ts`、`prompts.ts`、`schemas.ts`：真实模型调用与输出校验。
- `src/agent/mockEngine.ts`：无需联网的确定性演示。
- `src/rules/`：试剂危险属性目录和本地安全规则。
- `src/data/presets.ts`：COD、土壤酸消解、氨氮三个预设。
- `src/utils/pdfExtract.ts`：PDF 文本层提取、扫描页视觉识别与表单合并。
- `src/components/`：五阶段界面、模型设置、历史与报告。

模型密钥、演示开关和主动保存的历史报告保存在浏览器 `localStorage`。密钥不进入 `SessionContext` 或 Trace。纯前端直连模型需服务商允许 CORS；公共设备上请勿保存密钥。

## 安全边界

本应用仅作辅助安全审查，不替代学校 EHS 审批、SDS、标准方法或实验室安全负责人的判断。危废分类、容器和应急处置须按所在机构现行制度复核。
