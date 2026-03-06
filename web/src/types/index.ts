export type ProgressStatus = "ok" | "none" | "needs_context" | "schema_invalid" | "evidence_missing";

export interface EvidenceSpan {
  paper_uid: string;
  chunk_hash: string;
  quote: string;
  offset_start?: number;
  offset_end?: number;
  page?: number | null;
  section?: string;
  ordinal?: number;
}

export interface GroundedText {
  text: string;
  confidence: number;
  evidence: EvidenceSpan[];
}

// --- Paper Ledger V2 (The Systematic DNA) ---

export interface BenchItem {
  name: string;
  version?: string | null;
  split?: string | null;
  confidence: number;
  evidence: EvidenceSpan[];
}

export interface MetricItem {
  name: string;
  direction: "higher_is_better" | "lower_is_better" | "unknown";
  confidence: number;
  evidence: EvidenceSpan[];
}

export interface ResultItem {
  benchmark: string;
  metric: string;
  score: number | null;
  score_unit?: string | null;
  budget: {
    budget_type: string;
    budget_value: number | null;
    budget_value_unit: string | null;
    missing_reason: string;
  };
  setting: Record<string, any>;
  confidence: number;
  evidence: EvidenceSpan[];
}

export interface BaselineItem {
  name_raw: string;
  name_canonical?: string | null;
  baseline_type?: string | null;
  is_strongest_claimed: boolean;
  confidence: number;
  evidence: EvidenceSpan[];
}

export interface AblationItem {
  axis_tag: string;
  effect_direction: "hurts" | "helps" | "mixed" | "unknown";
  effect_magnitude_hint?: string | null;
  confidence: number;
  evidence: EvidenceSpan[];
}

export interface LimitationItem {
  type: "limitation" | "failure_case" | "boundary_condition" | "open_problem";
  statement: GroundedText;
  falsifiable_hook?: string | null;
  confidence: number;
  evidence: EvidenceSpan[];
}

export interface PaperLedgerV2 {
  schema_version: "paper_ledger_v2";
  paper_identity: {
    paper_id: string;
    canonical_id: string;
    title: string;
    year: number;
    venue?: string | null;
    authors?: string[];
  };
  problem_statement: GroundedText;
  contribution_summary: GroundedText;
  protocol_signature: {
    benchmarks: BenchItem[];
    metrics: MetricItem[];
    budget: {
      budget_type: string;
      budget_value: number | null;
      budget_value_unit: string | null;
      is_hard_cap: boolean;
      missing_reason: string;
      confidence: number;
      evidence: EvidenceSpan[];
    };
    eval_protocol_keywords: string[];
    train_protocol_keywords: string[];
  };
  method_signature: {
    knife_types: string[];
    key_operators: string[];
    learned_components: string[];
    algorithm_family?: string | null;
    core_objective_form: GroundedText;
    confidence: number;
    evidence: EvidenceSpan[];
  };
  assumption_signature: {
    assumption_tags: string[];
    notes?: string | null;
    confidence: number;
    evidence: EvidenceSpan[];
  };
  results_facts: ResultItem[];
  baselines: BaselineItem[];
  ablations: AblationItem[];
  limitations_failures: LimitationItem[];
  extraction_meta: {
    status: string;
    parser_version: string;
    llm_model: string;
    prompt_version: string;
    generated_at: string;
    notes?: string | null;
  };
}

// --- Frontier types ---

export interface FrontierPoint {
  paper_uid: string;
  score: number;
  budget_value: number;
  updated_at: string;
  title?: string;
}

export interface FrontierGroup {
  benchmark: string;
  budget_type: string;
  frontier: FrontierPoint[];
  points: FrontierPoint[];
}

export interface FrontierPayload {
  generated_at: string;
  groups: FrontierGroup[];
}

// --- Other types ---

export interface Topic {
  topic_id: number;
  model_version: string;
  label: string;
  description: string;
  top_terms: string[];
  paper_count: number;
}

export interface LineagePayload {
  topic_id: number;
  node_count: number;
  edge_count: number;
  nodes: any[];
  edges: any[];
}

export interface PaperDiff {
  diff_id: string;
  paper_a_uid: string;
  paper_b_uid: string;
  diff_type: string;
  protocol_shift_flag: number;
  protocol_shift_reason: string;
  delta_json: any;
  evidence_index_json: Record<string, EvidenceSpan[]>;
  status: ProgressStatus;
}
