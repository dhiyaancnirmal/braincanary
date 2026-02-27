# 06 — State Machine Specification

## States

```
IDLE → PENDING → STAGE_1 → STAGE_2 → ... → STAGE_N → PROMOTED
                    │          │              │
                    └──────────┴──────────────┘
                               │
                          ROLLING_BACK → ROLLED_BACK
                               │
                             PAUSED (from any STAGE_*)
```

| State | Description |
|-------|-------------|
| `IDLE` | No deployment active. Proxy routes 100% to default. |
| `PENDING` | Config validated, deployment initialized, about to enter first stage. |
| `STAGE_N` | Active canary at stage N's traffic weight. Monitor polling. Gates evaluating. |
| `PAUSED` | Stage timer frozen. Traffic split held. Monitor still polling but no auto-promotion. |
| `ROLLING_BACK` | Transitional. Canary weight set to 0%. Flush in-flight requests. |
| `ROLLED_BACK` | Terminal. Canary disabled. Audit log written. |
| `PROMOTED` | Terminal. Canary becomes the new baseline at 100%. Deployment complete. |

## Transitions

| From | To | Trigger | Guard Conditions |
|------|----|---------|------------------|
| `IDLE` | `PENDING` | `braincanary deploy` command | Config validates. Braintrust project/scorers resolve. |
| `PENDING` | `STAGE_1` | Automatic (immediate) | Proxy started. wrapOpenAI client initialized. |
| `STAGE_N` | `STAGE_N+1` | Auto-promote OR manual `promote` | All gates passing AND duration elapsed AND min_samples reached. |
| `STAGE_N` | `ROLLING_BACK` | Auto-rollback OR manual `rollback` | Any gate failing at confidence OR absolute drop exceeded OR error rate exceeded OR manual trigger. |
| `STAGE_N` | `PAUSED` | Manual `pause` | Always allowed. |
| `PAUSED` | `STAGE_N` | Manual `resume` | Returns to the stage that was paused. Timer resumes. |
| `STAGE_FINAL` | `PROMOTED` | Auto-promote (final stage weight=100) | Same as normal promotion. |
| `ROLLING_BACK` | `ROLLED_BACK` | Automatic (after in-flight drain) | All canary requests completed or timed out (5s max). |

## Gate Evaluation Logic

```typescript
interface GateResult {
  scorer: string;
  status: "passing" | "failing" | "insufficient_data";
  baseline_mean: number;
  canary_mean: number;
  p_value: number | null;       // null if insufficient data
  absolute_check: boolean;      // canary_mean >= threshold
  comparison_check: boolean;    // statistical test result
  n_baseline: number;
  n_canary: number;
}

function evaluateGate(gate: Gate, baseline: ScoreStats, canary: ScoreStats): GateResult {
  // 1. Check if enough samples
  if (canary.n < stage.min_samples || baseline.n < 10) {
    return { status: "insufficient_data", ... };
  }

  // 2. Absolute threshold check
  const absolute_check = canary.mean >= gate.threshold;

  // 3. Statistical comparison (if configured)
  let comparison_check = true;
  let p_value = null;
  
  if (gate.comparison !== "absolute_only") {
    const tTestResult = welchTTest(baseline.scores, canary.scores);
    p_value = tTestResult.pValue;
    
    if (gate.comparison === "not_worse_than_baseline") {
      // One-sided: reject H0 that canary < baseline
      // Canary passes if we can't prove it's worse
      comparison_check = tTestResult.oneSidedP > (1 - gate.confidence);
    } else if (gate.comparison === "better_than_baseline") {
      // One-sided: canary must be statistically better
      comparison_check = tTestResult.oneSidedP < (1 - gate.confidence);
    }
  }

  const passing = absolute_check && comparison_check;
  return { status: passing ? "passing" : "failing", ... };
}
```

## Promotion Decision

```typescript
function shouldPromote(stage: Stage, gates: GateResult[], stageEnteredAt: Date): boolean {
  // All gates must be passing (not insufficient_data, not failing)
  const allGatesPassing = gates.every(g => g.status === "passing");
  
  // Minimum duration must have elapsed
  const durationElapsed = Date.now() - stageEnteredAt.getTime() >= parseDuration(stage.duration);
  
  // Minimum samples must be reached (already checked in gate evaluation)
  const samplesReached = gates.every(g => g.n_canary >= stage.min_samples);
  
  return allGatesPassing && durationElapsed && samplesReached;
}
```

## Rollback Decision

```typescript
function shouldRollback(
  config: RollbackConfig,
  gates: GateResult[],
  canaryErrorRate: number
): { rollback: boolean; reason: string } {
  // 1. Any gate strongly failing (high confidence that canary is worse)
  const failingGate = gates.find(g => 
    g.status === "failing" && g.p_value !== null && g.p_value < 0.01
  );
  if (failingGate) {
    return { rollback: true, reason: `score_regression:${failingGate.scorer}` };
  }
  
  // 2. Absolute score drop exceeded
  const droppedGate = gates.find(g => 
    g.baseline_mean - g.canary_mean > config.on_score_drop
  );
  if (droppedGate) {
    return { rollback: true, reason: `absolute_drop:${droppedGate.scorer}` };
  }
  
  // 3. Error rate exceeded
  if (canaryErrorRate > config.on_error_rate) {
    return { rollback: true, reason: "error_rate_exceeded" };
  }
  
  return { rollback: false, reason: "" };
}
```

## SQLite Persistence Schema

```sql
CREATE TABLE deployments (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  config JSON NOT NULL,
  state TEXT NOT NULL DEFAULT 'PENDING',
  stage_index INTEGER NOT NULL DEFAULT 0,
  started_at TEXT NOT NULL,
  stage_entered_at TEXT,
  completed_at TEXT,
  final_state TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE state_transitions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  deployment_id TEXT NOT NULL REFERENCES deployments(id),
  from_state TEXT NOT NULL,
  to_state TEXT NOT NULL,
  reason TEXT,
  scores_snapshot JSON,
  timestamp TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE score_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  deployment_id TEXT NOT NULL REFERENCES deployments(id),
  version TEXT NOT NULL,           -- 'baseline' | 'canary'
  scorer TEXT NOT NULL,
  mean REAL NOT NULL,
  std REAL NOT NULL,
  n INTEGER NOT NULL,
  stage_index INTEGER NOT NULL,
  timestamp TEXT NOT NULL DEFAULT (datetime('now'))
);
```

## Crash Recovery

On startup, BrainCanary:
1. Opens SQLite DB
2. Reads the latest deployment where `state NOT IN ('PROMOTED', 'ROLLED_BACK', 'IDLE')`
3. If found: resume that deployment from the persisted state
4. Re-initialize the score monitor with `stage_entered_at` from DB
5. Log: `"Recovered deployment {name} at stage {N}. Resuming monitoring."`
6. If no active deployment: start in IDLE state

## Event Emission

Every state transition emits a typed event:

```typescript
type DeploymentEvent =
  | { type: "deployment_started"; deployment_id: string; config: DeploymentConfig }
  | { type: "stage_promoted"; from: number; to: number; scores: ScoreSnapshot }
  | { type: "rollback_triggered"; reason: string; scores: ScoreSnapshot }
  | { type: "deployment_complete"; final_state: "PROMOTED" | "ROLLED_BACK" }
  | { type: "score_update"; version: string; scores: Record<string, ScoreStats> }
  | { type: "gate_status"; gates: GateResult[] }
  | { type: "paused" }
  | { type: "resumed" };
```

Events are dispatched to: WebSocket clients (dashboard), SSE clients (CLI polling), webhook URLs, stdout logger.
