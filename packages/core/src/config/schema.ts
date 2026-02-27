import { z } from "zod";

const DurationSchema = z.string().regex(/^\d+(ms|s|m|h)$/, {
  message: "Duration must be in format like 30s, 10m, 1h, 500ms"
});

export const GateComparisonSchema = z.enum([
  "not_worse_than_baseline",
  "better_than_baseline",
  "absolute_only"
]);

export const GateSchema = z.object({
  scorer: z.string().min(1, "scorer is required"),
  threshold: z.number().min(0).max(1),
  comparison: GateComparisonSchema.default("not_worse_than_baseline"),
  confidence: z.number().min(0.5).max(0.999).default(0.95)
});

export const StageSchema = z.object({
  weight: z.number().int().min(1).max(100),
  duration: DurationSchema.optional(),
  min_samples: z.number().int().min(1).default(30),
  gates: z.array(GateSchema).default([])
});

export const VersionSchema = z.object({
  prompt: z.string().optional(),
  model: z.string().min(1),
  system_prompt: z.string().optional()
});

export const RuntimeModeSchema = z.enum(["direct", "gateway"]);

export const RuntimeSchema = z.object({
  mode: RuntimeModeSchema.default("direct"),
  direct: z
    .object({
      provider: z.enum(["openai", "anthropic", "google"]).default("openai"),
      api_key_env: z.string().default("OPENAI_API_KEY"),
      base_url: z.string().url().optional()
    })
    .default({}),
  gateway: z
    .object({
      base_url: z.string().url().default("https://gateway.braintrust.dev/v1"),
      provider_compat: z.enum(["openai", "anthropic"]).default("openai"),
      api_key_env: z.string().default("BRAINTRUST_API_KEY")
    })
    .default({})
});

export const RollbackSchema = z.object({
  on_score_drop: z.number().min(0).max(1).default(0.1),
  on_error_rate: z.number().min(0).max(1).default(0.05),
  cooldown: DurationSchema.default("5m")
});

export const BTQLMonitorSchema = z.object({
  api_url: z.string().url().default("https://api.braintrust.dev"),
  path: z.string().default("/btql"),
  query_timeout_ms: z.number().int().min(1_000).max(120_000).default(10_000),
  max_retries: z.number().int().min(0).max(10).default(5)
});

export const MonitorSchema = z.object({
  poll_interval: DurationSchema.default("30s"),
  sticky_key: z.string().optional(),
  scorer_lag_grace: DurationSchema.default("2m"),
  btql: BTQLMonitorSchema.default({})
});

export const WebhookSchema = z.object({
  url: z.string().url(),
  on: z.array(z.string()).default(["*"]),
  headers: z.record(z.string()).default({}),
  retries: z.number().int().min(0).max(10).default(3)
});

export const NotificationsSchema = z.object({
  webhooks: z.array(WebhookSchema).default([])
});

export const ServerSchema = z.object({
  port: z.number().int().min(1_024).max(65_535).default(4100),
  host: z.string().default("127.0.0.1"),
  dashboard_port: z.number().int().min(1_024).max(65_535).optional()
});

export const DeploymentSchema = z
  .object({
    name: z.string().min(1),
    project: z.string().min(1),
    runtime: RuntimeSchema.default({}),
    baseline: VersionSchema,
    canary: VersionSchema,
    stages: z.array(StageSchema).min(1),
    rollback: RollbackSchema.default({}),
    monitor: MonitorSchema.default({}),
    notifications: NotificationsSchema.default({}),
    server: ServerSchema.default({})
  })
  .superRefine((deployment, ctx) => {
    const stages = deployment.stages;
    const last = stages[stages.length - 1];
    if (last && last.weight !== 100) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Last stage must have weight=100",
        path: ["stages"]
      });
    }

    for (let i = 1; i < stages.length; i++) {
      if (stages[i]!.weight <= stages[i - 1]!.weight) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Stage weights must be strictly increasing",
          path: ["stages", i, "weight"]
        });
      }
    }

    const nonFinal = stages.slice(0, -1);
    const hasAnyGate = nonFinal.some((stage) => stage.gates.length > 0);
    if (!hasAnyGate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "At least one non-final stage must define at least one gate",
        path: ["stages"]
      });
    }
  });

export const DeploymentConfigSchema = z.object({
  deployment: DeploymentSchema
});

export type DeploymentConfig = z.infer<typeof DeploymentConfigSchema>;
export type Deployment = z.infer<typeof DeploymentSchema>;
export type DeploymentStage = z.infer<typeof StageSchema>;
export type Gate = z.infer<typeof GateSchema>;
export type RollbackConfig = z.infer<typeof RollbackSchema>;
export type RuntimeConfig = z.infer<typeof RuntimeSchema>;
export type MonitorConfig = z.infer<typeof MonitorSchema>;
