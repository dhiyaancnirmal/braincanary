export interface DeploymentStatusResponse {
  deployment: {
    id: string;
    name: string;
    state: string;
    stage_index: number;
    stage_count: number;
    canary_weight: number;
    started_at: string;
    stage_entered_at: string;
  } | null;
  scores: Record<string, { baseline: ScoreStats; canary: ScoreStats }>;
  gates: GateStatus[];
  next_action: string | null;
  time_remaining_ms: number | null;
}

export interface ScoreStats {
  mean: number;
  std: number;
  n: number;
}

export interface GateStatus {
  scorer: string;
  status: "passing" | "failing" | "insufficient_data";
  pValue: number | null;
  baselineMean: number;
  canaryMean: number;
  baselineN: number;
  canaryN: number;
}

export interface EventEnvelope {
  type: string;
  timestamp: string;
  deployment_id: string;
  data: any;
}
