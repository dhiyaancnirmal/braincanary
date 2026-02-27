import { z } from "zod";

export const DeploymentEventTypeSchema = z.enum([
  "deployment_started",
  "score_update",
  "gate_status",
  "stage_change",
  "rollback_triggered",
  "deployment_complete",
  "paused",
  "resumed",
  "monitor_health"
]);

export type DeploymentEventType = z.infer<typeof DeploymentEventTypeSchema>;

export interface DeploymentEventEnvelope<T = unknown> {
  type: DeploymentEventType;
  timestamp: string;
  deployment_id: string;
  data: T;
}

export interface ScoreSummary {
  mean: number;
  std: number;
  n: number;
}

export interface MonitorHealthSnapshot {
  status: "healthy" | "degraded";
  consecutive_failures: number;
  total_requests: number;
  total_rate_limited: number;
  last_success_at?: string;
  last_error_at?: string;
  last_error?: string;
  last_backoff_ms?: number;
}
