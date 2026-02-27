import { EventEmitter } from "node:events";
import { parseDuration } from "../utils/duration.js";
import type { BTQLClient, BTQLRow, MonitorDiagnostics } from "../braintrust/btql-client.js";
import { RunningStats } from "../statistics/running.js";
import type { ScoreSnapshot } from "../state/types.js";

export interface ScoreMonitorConfig {
  deploymentId: string;
  projectName: string;
  pollInterval: string;
  stageStartTime: Date;
  scorerNames: string[];
  scorerLagGrace: string;
}

export interface ScoreMonitorStats {
  baseline: Map<string, RunningStats>;
  canary: Map<string, RunningStats>;
  errorRateCanary: number;
}

export class ScoreMonitor extends EventEmitter {
  private timer: NodeJS.Timeout | null = null;
  private baselineStats = new Map<string, RunningStats>();
  private canaryStats = new Map<string, RunningStats>();
  private baselineWatermark: Date;
  private canaryWatermark: Date;
  private inFlight = false;
  private canaryTotal = 0;
  private canaryErrors = 0;

  constructor(
    private readonly btql: BTQLClient,
    private readonly config: ScoreMonitorConfig
  ) {
    super();
    this.baselineWatermark = config.stageStartTime;
    this.canaryWatermark = config.stageStartTime;
    this.resetStats();
  }

  start(): void {
    const interval = parseDuration(this.config.pollInterval);
    void this.poll();
    this.timer = setInterval(() => {
      void this.poll();
    }, interval);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  resetForStage(stageStart: Date): void {
    this.baselineWatermark = stageStart;
    this.canaryWatermark = stageStart;
    this.canaryErrors = 0;
    this.canaryTotal = 0;
    this.resetStats();
  }

  getStats(): ScoreMonitorStats {
    return {
      baseline: this.baselineStats,
      canary: this.canaryStats,
      errorRateCanary: this.canaryTotal > 0 ? this.canaryErrors / this.canaryTotal : 0
    };
  }

  getDiagnostics(): MonitorDiagnostics {
    return this.btql.getDiagnostics();
  }

  private resetStats(): void {
    this.baselineStats.clear();
    this.canaryStats.clear();
    for (const scorer of this.config.scorerNames) {
      this.baselineStats.set(scorer, new RunningStats());
      this.canaryStats.set(scorer, new RunningStats());
    }
  }

  private async poll(): Promise<void> {
    if (this.inFlight) {
      return;
    }
    this.inFlight = true;

    try {
      const baselineRows = await this.fetchRows("baseline", this.baselineWatermark);
      this.consumeRows("baseline", baselineRows);
      this.baselineWatermark = maxCreatedAt(this.baselineWatermark, baselineRows);

      const canaryRows = await this.fetchRows("canary", this.canaryWatermark);
      this.consumeRows("canary", canaryRows);
      this.canaryWatermark = maxCreatedAt(this.canaryWatermark, canaryRows);

      const snapshot = this.buildSnapshot();
      this.emit("score_update", snapshot);
      this.emit("monitor_health", this.btql.getDiagnostics());
    } catch (error) {
      this.emit("error", error);
      this.emit("monitor_health", this.btql.getDiagnostics());
    } finally {
      this.inFlight = false;
    }
  }

  private async fetchRows(version: "baseline" | "canary", watermark: Date): Promise<BTQLRow[]> {
    const sql = `
      SELECT id, scores, metadata, created, error
      FROM project_logs('${this.config.projectName}', shape => 'traces')
      WHERE metadata."braincanary.deployment_id" = '${this.config.deploymentId}'
        AND metadata."braincanary.version" = '${version}'
        AND created > '${watermark.toISOString()}'
      ORDER BY created ASC
    `;

    return this.btql.query<BTQLRow>(sql);
  }

  private consumeRows(version: "baseline" | "canary", rows: BTQLRow[]): void {
    const target = version === "baseline" ? this.baselineStats : this.canaryStats;

    for (const row of rows) {
      if (version === "canary") {
        this.canaryTotal += 1;
        if (row.error) {
          this.canaryErrors += 1;
        }
      }

      for (const scorer of this.config.scorerNames) {
        const score = row.scores?.[scorer];
        if (typeof score === "number") {
          target.get(scorer)?.add(score);
        }
      }
    }
  }

  private buildSnapshot(): ScoreSnapshot {
    const snapshot: ScoreSnapshot = {};

    for (const scorer of this.config.scorerNames) {
      const baseline = this.baselineStats.get(scorer)!;
      const canary = this.canaryStats.get(scorer)!;

      snapshot[scorer] = {
        baseline: {
          mean: baseline.average,
          std: baseline.standardDeviation,
          n: baseline.count
        },
        canary: {
          mean: canary.average,
          std: canary.standardDeviation,
          n: canary.count
        }
      };
    }

    return snapshot;
  }
}

function maxCreatedAt(current: Date, rows: BTQLRow[]): Date {
  let max = current;
  for (const row of rows) {
    const created = new Date(row.created);
    if (created > max) {
      max = created;
    }
  }
  return max;
}
