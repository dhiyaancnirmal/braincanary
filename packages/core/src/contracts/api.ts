import { z } from "zod";

export const DeploymentLifecycleSchema = z.enum([
  "IDLE",
  "PENDING",
  "STAGE",
  "PAUSED",
  "ROLLING_BACK",
  "ROLLED_BACK",
  "PROMOTED"
]);

export const DeployRequestSchema = z.object({
  config_path: z.string().optional(),
  config: z.unknown().optional()
});

export const PromoteRequestSchema = z.object({
  force: z.boolean().default(false)
});

export const RollbackRequestSchema = z.object({
  reason: z.string().optional()
});

export const HistoryQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(10)
});

export const MonitorStatusSchema = z.object({
  status: z.enum(["healthy", "degraded"]),
  consecutive_failures: z.number().int(),
  total_requests: z.number().int(),
  total_rate_limited: z.number().int(),
  last_success_at: z.string().optional(),
  last_error_at: z.string().optional(),
  last_error: z.string().optional(),
  last_backoff_ms: z.number().int().optional()
});

export const ScoreStatsSchema = z.object({
  mean: z.number(),
  std: z.number(),
  n: z.number().int()
});

export const StatusResponseSchema = z.object({
  deployment: z
    .object({
      id: z.string(),
      name: z.string(),
      state: DeploymentLifecycleSchema,
      stage_index: z.number().int(),
      stage_count: z.number().int(),
      canary_weight: z.number().int(),
      started_at: z.string(),
      stage_entered_at: z.string().optional()
    })
    .nullable(),
  scores: z.record(z.object({ baseline: ScoreStatsSchema, canary: ScoreStatsSchema })),
  gates: z.array(z.unknown()),
  next_action: z.string().nullable(),
  time_remaining_ms: z.number().int().nullable()
});

export type DeployRequest = z.infer<typeof DeployRequestSchema>;
export type PromoteRequest = z.infer<typeof PromoteRequestSchema>;
export type RollbackRequest = z.infer<typeof RollbackRequestSchema>;
export type StatusResponse = z.infer<typeof StatusResponseSchema>;
export type MonitorStatus = z.infer<typeof MonitorStatusSchema>;
