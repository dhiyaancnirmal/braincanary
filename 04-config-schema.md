# 04 — Configuration Schema & DSL

## Config File

`braincanary.config.yaml` — lives in the project root, versioned in git.

```yaml
# braincanary.config.yaml
deployment:
  name: "support-agent-v2.3"
  project: "support-agent"              # Braintrust project name
  
  baseline:
    prompt: "support-agent@v2.2"        # Braintrust prompt slug@version
    model: "claude-sonnet-4-5-20250929"
  
  canary:
    prompt: "support-agent@v2.3"
    model: "claude-sonnet-4-5-20250929"
  
  stages:
    - weight: 5                          # 5% canary traffic
      duration: "10m"                    # minimum time at this stage
      min_samples: 50                    # minimum traces before gate evaluation
      gates:
        - scorer: "Correctness"
          threshold: 0.85                # absolute minimum score
          comparison: "not_worse_than_baseline"
          confidence: 0.95               # Welch's t-test significance level
        - scorer: "Helpfulness"
          threshold: 0.80
          comparison: "not_worse_than_baseline"
          confidence: 0.90
    
    - weight: 25
      duration: "30m"
      min_samples: 200
      gates:
        - scorer: "Correctness"
          threshold: 0.85
          comparison: "not_worse_than_baseline"
          confidence: 0.95
    
    - weight: 50
      duration: "1h"
      min_samples: 500
      gates:
        - scorer: "Correctness"
          threshold: 0.85
    
    - weight: 100                        # full promotion
  
  rollback:
    on_score_drop: 0.10                  # 10% absolute drop from baseline = immediate rollback
    on_error_rate: 0.05                  # 5% error rate = rollback
    cooldown: "5m"                       # wait before re-attempting after rollback
  
  monitor:
    poll_interval: "30s"                 # BTQL polling frequency
    sticky_key: "metadata.user_id"       # session affinity field (optional)
  
  notifications:
    webhooks:
      - url: "https://hooks.slack.com/services/..."
        on: ["stage_promoted", "rollback_triggered", "deployment_complete"]
      - url: "https://api.internal.com/deployments"
        on: ["*"]                        # all events

  server:
    port: 4100                           # proxy listen port
    dashboard_port: 4101                 # dashboard UI port (or same port at /dashboard)
```

## Zod Schema (TypeScript)

```typescript
// packages/core/src/config/schema.ts
import { z } from "zod";

const DurationSchema = z.string().regex(
  /^\d+[smh]$/,
  "Duration must be like '10m', '30s', '1h'"
);

const GateSchema = z.object({
  scorer: z.string().min(1, "Scorer name required"),
  threshold: z.number().min(0).max(1),
  comparison: z.enum([
    "not_worse_than_baseline",  // Welch's t-test: canary >= baseline
    "better_than_baseline",     // Welch's t-test: canary > baseline
    "absolute_only",            // just check threshold, no comparison
  ]).default("not_worse_than_baseline"),
  confidence: z.number().min(0.5).max(0.999).default(0.95),
});

const StageSchema = z.object({
  weight: z.number().int().min(1).max(100),
  duration: DurationSchema.optional(),
  min_samples: z.number().int().min(1).default(30),
  gates: z.array(GateSchema).optional(),
});

const VersionSchema = z.object({
  prompt: z.string().optional(),         // Braintrust prompt slug@version
  model: z.string().min(1),             // model identifier
  system_prompt: z.string().optional(),  // inline override (alternative to prompt slug)
});

const RollbackSchema = z.object({
  on_score_drop: z.number().min(0).max(1).default(0.10),
  on_error_rate: z.number().min(0).max(1).default(0.05),
  cooldown: DurationSchema.default("5m"),
});

const WebhookSchema = z.object({
  url: z.string().url(),
  on: z.array(z.string()).default(["*"]),
  headers: z.record(z.string()).optional(),
});

const MonitorSchema = z.object({
  poll_interval: DurationSchema.default("30s"),
  sticky_key: z.string().optional(),
});

const ServerSchema = z.object({
  port: z.number().int().min(1024).max(65535).default(4100),
  dashboard_port: z.number().int().min(1024).max(65535).optional(),
});

export const DeploymentConfigSchema = z.object({
  deployment: z.object({
    name: z.string().min(1),
    project: z.string().min(1),
    baseline: VersionSchema,
    canary: VersionSchema,
    stages: z.array(StageSchema)
      .min(1, "At least one stage required")
      .refine(
        (stages) => stages[stages.length - 1].weight === 100,
        "Last stage must have weight: 100 (full promotion)"
      )
      .refine(
        (stages) => stages.every((s, i) => i === 0 || s.weight > stages[i - 1].weight),
        "Stage weights must be strictly increasing"
      ),
    rollback: RollbackSchema.default({}),
    monitor: MonitorSchema.default({}),
    notifications: z.object({
      webhooks: z.array(WebhookSchema).default([]),
    }).default({}),
    server: ServerSchema.default({}),
  }),
});

export type DeploymentConfig = z.infer<typeof DeploymentConfigSchema>;
export type Gate = z.infer<typeof GateSchema>;
export type Stage = z.infer<typeof StageSchema>;
```

## Config Loader

```typescript
// packages/core/src/config/loader.ts
import { readFile } from "fs/promises";
import YAML from "yaml";
import { DeploymentConfigSchema, type DeploymentConfig } from "./schema";

export async function loadConfig(path: string): Promise<DeploymentConfig> {
  const raw = await readFile(path, "utf-8");
  const parsed = YAML.parse(raw);
  
  const result = DeploymentConfigSchema.safeParse(parsed);
  if (!result.success) {
    const errors = result.error.issues.map(
      (i) => `  ${i.path.join(".")}: ${i.message}`
    );
    throw new Error(
      `Invalid braincanary.config.yaml:\n${errors.join("\n")}`
    );
  }
  
  return result.data;
}

export function parseDuration(d: string): number {
  const match = d.match(/^(\d+)([smh])$/);
  if (!match) throw new Error(`Invalid duration: ${d}`);
  const [, value, unit] = match;
  const multipliers = { s: 1000, m: 60_000, h: 3_600_000 };
  return parseInt(value) * multipliers[unit as keyof typeof multipliers];
}
```

## Validation Rules

1. **Stages monotonically increase** — weight must go up (5 → 25 → 50 → 100)
2. **Last stage must be 100** — representing full promotion
3. **Scorer names validated at deploy time** — resolved against Braintrust project scores API
4. **Prompt slugs validated at deploy time** — resolved against Braintrust prompts API
5. **At least one gate in at least one non-final stage** — otherwise there's nothing to evaluate
6. **Duration format enforced** — regex `^\d+[smh]$`
7. **Confidence range** — must be between 0.5 and 0.999

## Environment Variables

```bash
BRAINTRUST_API_KEY=bt-...          # Required
BRAINTRUST_API_URL=https://api.braintrust.dev  # Optional (default)
BRAINCANARY_CONFIG=./braincanary.config.yaml   # Optional (default path)
BRAINCANARY_LOG_LEVEL=info                     # debug | info | warn | error
```
