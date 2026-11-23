export type WorkflowState = 'INPUT' | 'PARSE' | 'CLARIFY' | 'GENERATE' | 'AUDIT' | 'REPORT';
export type WorkflowStatus = 'idle' | 'running' | 'waiting_input' | 'error' | 'done';
export type RiskLevel = 'low' | 'medium' | 'high';

export type HazardTag =
  | 'strong_acid' | 'concentrated_sulfuric_acid' | 'strong_base'
  | 'strong_oxidizer' | 'organic_reducer' | 'cyanide' | 'sulfide'
  | 'fluoride' | 'hydrofluoric_acid' | 'mercury' | 'chromium_vi'
  | 'heavy_metal' | 'halogenated_organic' | 'nonhalogenated_organic';

export interface ExperimentInput {
  name: string;
  procedure: string;
  reagentListText: string;
}

export interface ReagentInfo {
  name: string;
  cas?: string;
  concentration?: string;
  amount?: string;
  categories: HazardTag[];
  hazards: string[];
}

export interface OperationCondition {
  type: 'heating' | 'digestion' | 'reflux' | 'evaporation' | 'sealed' | 'other';
  description: string;
  temperatureC?: number;
  duration?: string;
}

export interface ClarificationOption { value: string; label: string; }
export interface ClarificationQuestion {
  id: string;
  prompt: string;
  control: 'single' | 'multi';
  options: ClarificationOption[];
  required: boolean;
  allowSupplement: boolean;
  rationale: string;
}

export interface ParseResult {
  experimentSummary: string;
  reagents: ReagentInfo[];
  conditions: OperationCondition[];
  initialRisk: RiskLevel;
  riskReasons: string[];
  informationComplete: boolean;
  next_action: 'CLARIFY' | 'GENERATE';
  missing_questions: ClarificationQuestion[];
}

export interface ClarificationAnswer {
  questionId: string;
  value: string[];
  supplement?: string;
}

export interface ClarificationRound {
  round: number;
  questions: ClarificationQuestion[];
  answers: ClarificationAnswer[];
  submittedAt: string | null;
}

export interface CompatibilityWarning {
  id: string;
  severity: RiskLevel;
  reagents: string[];
  hazard: string;
  reaction: string;
  prevention: string;
  relatedRuleId?: string;
}

export interface PpeItem { item: string; specification: string; reason: string; }
export interface PpePlan { requiredPpe: PpeItem[]; ventilation: string; additionalControls: string[]; }
export interface SopStep { order: number; title: string; actions: string[]; safetyNotes: string[]; }
export interface EmergencyProcedure { scenario: string; immediateActions: string[]; }

export type WasteCategory =
  | 'inorganic_acid' | 'alkali' | 'heavy_metal' | 'chromium' | 'mercury'
  | 'fluoride' | 'cyanide' | 'sulfide' | 'halogenated_organic'
  | 'non_halogenated_organic' | 'contaminated_solid' | 'other';

export interface WasteStream {
  id: string;
  category: WasteCategory;
  bucketLabel: string;
  mainComponents: string[];
  hazardTags: HazardTag[];
  forbiddenItems: string[];
  containerSpec: string;
  storageNotes: string;
}

export interface ReagentDisposition {
  reagentName: string;
  destination: 'waste_stream' | 'reacted_or_consumed' | 'not_used';
  wasteStreamId?: string;
  note: string;
}

export interface SafetyDraft {
  draftId: string;
  attempt: number;
  riskLevel: RiskLevel;
  riskRationale: string[];
  compatibilityWarnings: CompatibilityWarning[];
  ppe: PpePlan;
  sop: SopStep[];
  emergencyProcedures: EmergencyProcedure[];
  wasteStreams: WasteStream[];
  reagentDisposition: ReagentDisposition[];
  checklist: string[];
}

export interface LocalRuleIssue {
  ruleId: string;
  severity: 'blocker' | 'warning';
  message: string;
  evidence: string[];
  suggestion: string;
}

export interface LocalAuditResult { passed: boolean; issues: LocalRuleIssue[]; }
export interface AiAuditResult { passed: boolean; issues: string[]; }
export interface AuditResult {
  round: number;
  draftAttempt: number;
  checkedAt: string;
  local: LocalAuditResult;
  ai: AiAuditResult;
  passed: boolean;
  issues: string[];
  requiresManualReview: boolean;
}

export interface AuditLoopState {
  history: AuditResult[];
  retryCount: number;
  requiresManualReview: boolean;
}

export interface StepError {
  step: WorkflowState;
  code: 'timeout' | 'network' | 'auth' | 'rate_limit' | 'http' | 'invalid_json' | 'schema_validation' | 'unknown';
  message: string;
  retryable: boolean;
  occurredAt: string;
  detail?: string;
}

export interface WorkflowSnapshot { state: WorkflowState; status: WorkflowStatus; error: StepError | null; }

export interface TraceEvent {
  id: string;
  at: string;
  type: 'state_transition' | 'user_input' | 'clarification_submit' | 'llm_call' | 'llm_result' | 'rule_audit' | 'ai_audit' | 'auto_rewrite' | 'step_error' | 'report_export';
  state: WorkflowState;
  message: string;
  round?: number;
  attempt?: number;
  details?: Record<string, unknown>;
}

export interface SessionContext {
  schemaVersion: 1;
  id: string;
  createdAt: string;
  updatedAt: string;
  input: ExperimentInput;
  parse: ParseResult | null;
  clarificationRounds: ClarificationRound[];
  draft: SafetyDraft | null;
  audit: AuditLoopState;
  workflow: WorkflowSnapshot;
  trace: TraceEvent[];
}

export interface AgentEngine {
  parse(input: ExperimentInput): Promise<ParseResult>;
  clarify(context: SessionContext): Promise<ParseResult>;
  generate(context: SessionContext, correctionIssues: string[]): Promise<SafetyDraft>;
  audit(context: SessionContext, draft: SafetyDraft): Promise<AiAuditResult>;
}

export interface ModelSettings { baseUrl: string; apiKey: string; model: string; }
