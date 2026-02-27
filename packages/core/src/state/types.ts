import type { DeploymentConfig } from "../config/schema.js";
import type { GateResult } from "../statistics/evaluate-gate.js";

export type DeploymentLifecycleState =
  | "IDLE"
  | "PENDING"
  | "STAGE"
  | "PAUSED"
  | "ROLLING_BACK"
  | "ROLLED_BACK"
  | "PROMOTED";

export interface VersionScoreStats {
  mean: number;
  std: number;
  n: number;
}

export interface ScoreSnapshot {
  [scorer: string]: {
    baseline: VersionScoreStats;
    canary: VersionScoreStats;
  };
}

export interface DeploymentSnapshot {
  id: string;
  name: string;
  config: DeploymentConfig;
  state: DeploymentLifecycleState;
  stageIndex: number;
  stageEnteredAt: string;
  startedAt: string;
  completedAt?: string;
  finalState?: "PROMOTED" | "ROLLED_BACK";
  pausedStageIndex?: number | null;
  canaryWeight: number;
  reason?: string;
}

export interface StageDecision {
  promote: boolean;
  rollback: boolean;
  nextAction: "hold" | "auto_promote" | "rollback";
  reason?: string;
  gateResults: GateResult[];
  timeRemainingMs: number;
}

export interface GateEvaluationInput {
  scores: ScoreSnapshot;
  canaryErrorRate: number;
}
