# 08 — BTQL Integration & Score Monitor

## Overview

The Score Monitor is the bridge between Braintrust's trace data and BrainCanary's deployment decisions. It polls BTQL at regular intervals, aggregates scores by version, and feeds the results to the Stage Controller.

## BTQL Query Patterns

### Primary: Fetch scores for a deployment version

```sql
SELECT
  scores,
  metadata."braincanary.version" AS version,
  created
FROM project_logs('{project_name}', shape => 'traces')
WHERE metadata."braincanary.deployment_id" = '{deployment_id}'
  AND metadata."braincanary.version" = '{version}'
  AND created > '{stage_start_iso}'
```

**Returns:** Array of trace objects with their score values and timestamps.

### Error rate query

```sql
SELECT
  count(*) AS total,
  sum(CASE WHEN error IS NOT NULL THEN 1 ELSE 0 END) AS errors
FROM project_logs('{project_name}', shape => 'traces')
WHERE metadata."braincanary.deployment_id" = '{deployment_id}'
  AND metadata."braincanary.version" = 'canary'
  AND created > '{stage_start_iso}'
```

### Sample count check (lightweight)

```sql
SELECT
  count(*) AS n
FROM project_logs('{project_name}', shape => 'traces')
WHERE metadata."braincanary.deployment_id" = '{deployment_id}'
  AND metadata."braincanary.version" = '{version}'
  AND created > '{stage_start_iso}'
```

## BTQL Client

```typescript
// packages/core/src/braintrust/btql-client.ts

export interface BTQLClientConfig {
  apiKey: string;
  apiUrl: string;  // default: "https://api.braintrust.dev"
}

export interface BTQLRow {
  scores: Record<string, number | null>;
  metadata: Record<string, unknown>;
  created: string;
  error?: string;
}

export class BTQLClient {
  constructor(private config: BTQLClientConfig) {}

  async query(sql: string): Promise<BTQLRow[]> {
    const response = await fetch(`${this.config.apiUrl}/btql`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${this.config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query: sql, fmt: "json" }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new BTQLError(`BTQL query failed (${response.status}): ${body}`);
    }

    const result = await response.json();
    return result.data ?? [];
  }
}

export class BTQLError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BTQLError";
  }
}
```

## Score Monitor

```typescript
// packages/core/src/monitor/score-monitor.ts

import { EventEmitter } from "events";

export interface ScoreMonitorConfig {
  deploymentId: string;
  projectName: string;
  pollIntervalMs: number;
  scorerNames: string[];    // derived from config gates
  stageStartTime: Date;
}

export class ScoreMonitor extends EventEmitter {
  private timer: NodeJS.Timeout | null = null;
  private baselineStats: Map<string, RunningStats> = new Map();
  private canaryStats: Map<string, RunningStats> = new Map();
  private lastQueryTime: Date;
  private isPolling = false;

  constructor(
    private btql: BTQLClient,
    private config: ScoreMonitorConfig
  ) {
    super();
    this.lastQueryTime = config.stageStartTime;
    this.initStats();
  }

  private initStats(): void {
    for (const scorer of this.config.scorerNames) {
      this.baselineStats.set(scorer, new RunningStats());
      this.canaryStats.set(scorer, new RunningStats());
    }
  }

  start(): void {
    this.poll(); // immediate first poll
    this.timer = setInterval(() => this.poll(), this.config.pollIntervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  resetForNewStage(stageStartTime: Date): void {
    this.config.stageStartTime = stageStartTime;
    this.lastQueryTime = stageStartTime;
    this.initStats(); // reset running stats
  }

  private async poll(): Promise<void> {
    if (this.isPolling) return; // prevent overlap
    this.isPolling = true;

    try {
      // Fetch new traces since last query
      for (const version of ["baseline", "canary"] as const) {
        const rows = await this.fetchScores(version);
        const stats = version === "baseline" ? this.baselineStats : this.canaryStats;

        for (const row of rows) {
          for (const scorer of this.config.scorerNames) {
            const score = row.scores[scorer];
            if (score !== null && score !== undefined) {
              stats.get(scorer)!.add(score);
            }
          }
        }

        // Update last query time watermark
        if (rows.length > 0) {
          const latest = rows.reduce((max, r) =>
            r.created > max ? r.created : max, this.lastQueryTime.toISOString()
          );
          // Don't move watermark backward
          const latestDate = new Date(latest);
          if (latestDate > this.lastQueryTime) {
            this.lastQueryTime = latestDate;
          }
        }
      }

      // Emit score updates
      const snapshot: Record<string, { baseline: ScoreStats; canary: ScoreStats }> = {};
      for (const scorer of this.config.scorerNames) {
        const bl = this.baselineStats.get(scorer)!;
        const cn = this.canaryStats.get(scorer)!;
        snapshot[scorer] = {
          baseline: { mean: bl.average, std: bl.standardDeviation, n: bl.count },
          canary: { mean: cn.average, std: cn.standardDeviation, n: cn.count },
        };
      }

      this.emit("score_update", snapshot);

    } catch (error) {
      this.emit("error", error);
    } finally {
      this.isPolling = false;
    }
  }

  private async fetchScores(version: string): Promise<BTQLRow[]> {
    const query = `
      SELECT scores, metadata, created
      FROM project_logs('${this.config.projectName}', shape => 'traces')
      WHERE metadata."braincanary.deployment_id" = '${this.config.deploymentId}'
        AND metadata."braincanary.version" = '${version}'
        AND created > '${this.config.stageStartTime.toISOString()}'
    `;
    return this.btql.query(query);
  }

  getStats(): { baseline: Map<string, RunningStats>; canary: Map<string, RunningStats> } {
    return { baseline: this.baselineStats, canary: this.canaryStats };
  }
}
```

## Rate Limit Management

BTQL rate limit: 20 requests per object per minute.

BrainCanary's usage per poll cycle:
- 2 queries (baseline + canary scores) = 2 requests
- Poll interval default: 30s → 4 requests/min

**Budget:** 4/20 = 20% of rate limit. Leaves 80% for the user's own BTQL queries and Braintrust UI.

If we add error rate queries: 6/20 = 30%. Still fine.

**Backoff strategy:** If a BTQL query returns 429, exponential backoff with jitter:
```typescript
const retryDelays = [1000, 2000, 4000, 8000, 16000]; // ms
```

## Data Freshness

There's inherent latency between when a trace is logged and when scores are available:
1. Request completes → Braintrust SDK flushes trace (async, typically < 1s)
2. Online scorers run on the trace (1-5s depending on scorer)
3. BrainCanary polls BTQL (up to poll_interval latency)

**Total latency:** 5-35 seconds from response to gate evaluation. This is fine for deployment decisions that operate on minutes-scale windows.

## Validation at Deploy Time

Before starting a deployment, BrainCanary validates against Braintrust:

```typescript
async function validateConfig(config: DeploymentConfig, btql: BTQLClient): Promise<void> {
  // 1. Verify project exists
  const projectCheck = await btql.query(
    `SELECT count(*) AS n FROM project_logs('${config.deployment.project}', shape => 'traces') LIMIT 1`
  );
  
  // 2. Verify scorers exist (query recent traces for score field names)
  const scorerCheck = await btql.query(`
    SELECT scores FROM project_logs('${config.deployment.project}', shape => 'traces') LIMIT 10
  `);
  
  const availableScorers = new Set<string>();
  for (const row of scorerCheck) {
    for (const key of Object.keys(row.scores ?? {})) {
      availableScorers.add(key);
    }
  }
  
  const configuredScorers = extractScorerNames(config);
  for (const scorer of configuredScorers) {
    if (!availableScorers.has(scorer)) {
      throw new Error(
        `Scorer "${scorer}" not found in project "${config.deployment.project}". ` +
        `Available scorers: ${[...availableScorers].join(", ")}`
      );
    }
  }
}
```

## Edge Cases

1. **No scores yet** — Gates return `insufficient_data`. Stage timer ticks but won't promote until min_samples reached.
2. **Scorer not present on some traces** — Skip traces where `scores[scorer]` is null. Count only traces with that scorer.
3. **BTQL downtime** — Log error, skip poll cycle, retry next interval. Don't rollback on monitor failure (fail-open for the monitor, not the deployment).
4. **Score of 0** — Valid score, included in statistics. Zero is not null.
5. **Very slow scoring** — If online scorers take > poll_interval to complete, some traces won't have scores yet. The watermark-based approach handles this naturally — scores appear on the next poll.
