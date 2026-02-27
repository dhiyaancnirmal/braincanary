import { randomUUID } from "node:crypto";
import type { DeploymentConfig, DeploymentStage, Gate } from "../config/schema.js";
import type { DeploymentEventEnvelope } from "../contracts/events.js";
import { DeploymentEventBus } from "../events/event-bus.js";
import { parseDuration } from "../utils/duration.js";
import type { SqliteStateStore } from "../db/store.js";
import type { ScoreMonitor } from "../monitor/score-monitor.js";
import { evaluateGate, type GateResult, type StatsLike } from "../statistics/evaluate-gate.js";
import { transitionSnapshot } from "./machine.js";
import type { DeploymentSnapshot, ScoreSnapshot, StageDecision } from "./types.js";

export class StageController {
  private snapshot: DeploymentSnapshot | null = null;
  private latestScores: ScoreSnapshot = {};
  private latestGates: GateResult[] = [];
  private nextAction: "hold" | "auto_promote" | "rollback" = "hold";
  private timeRemainingMs: number | null = null;
  private monitor: ScoreMonitor | null = null;

  constructor(
    private readonly store: SqliteStateStore,
    private readonly bus: DeploymentEventBus = new DeploymentEventBus()
  ) {}

  get eventBus(): DeploymentEventBus {
    return this.bus;
  }

  getSnapshot(): DeploymentSnapshot | null {
    return this.snapshot;
  }

  getStatus(): {
    deployment: DeploymentSnapshot | null;
    scores: ScoreSnapshot;
    gates: GateResult[];
    nextAction: string | null;
    timeRemainingMs: number | null;
  } {
    return {
      deployment: this.snapshot,
      scores: this.latestScores,
      gates: this.latestGates,
      nextAction: this.snapshot ? this.nextAction : null,
      timeRemainingMs: this.timeRemainingMs
    };
  }

  recoverFromStore(): DeploymentSnapshot | null {
    const active = this.store.getActiveDeployment();
    this.snapshot = active;
    return active;
  }

  startDeployment(config: DeploymentConfig, deploymentId = randomUUID()): DeploymentSnapshot {
    const firstStage = config.deployment.stages[0]!;
    const now = new Date().toISOString();
    const pending: DeploymentSnapshot = {
      id: deploymentId,
      name: config.deployment.name,
      config,
      state: "PENDING",
      stageIndex: 0,
      stageEnteredAt: now,
      startedAt: now,
      canaryWeight: firstStage.weight
    };

    this.store.createDeployment(pending);
    this.snapshot = pending;
    this.emit("deployment_started", {
      deployment_id: deploymentId,
      name: pending.name,
      stage_index: 0,
      canary_weight: firstStage.weight
    });

    this.transition("STAGE", "deployment_initialized", {
      canaryWeight: firstStage.weight,
      stageEnteredAt: now
    });

    return this.snapshot!;
  }

  attachMonitor(monitor: ScoreMonitor): void {
    this.monitor = monitor;

    monitor.on("score_update", (snapshot: ScoreSnapshot) => {
      this.onScoreUpdate(snapshot);
    });

    monitor.on("monitor_health", (health) => {
      this.onMonitorHealth(health as Record<string, unknown>);
    });

    monitor.on("error", (error) => {
      this.emit("monitor_health", {
        status: "degraded",
        error: error instanceof Error ? error.message : String(error)
      });
    });
  }

  pause(): void {
    if (!this.snapshot || this.snapshot.state !== "STAGE") {
      throw new Error("Cannot pause when deployment is not in STAGE");
    }

    this.transition("PAUSED", "manual_pause", {
      pausedStageIndex: this.snapshot.stageIndex
    });
    this.emit("paused", { stage_index: this.snapshot.stageIndex });
  }

  resume(): void {
    if (!this.snapshot || this.snapshot.state !== "PAUSED") {
      throw new Error("Cannot resume when deployment is not paused");
    }

    const stageIndex = this.snapshot.pausedStageIndex ?? this.snapshot.stageIndex;
    this.transition("STAGE", "manual_resume", {
      stageIndex,
      stageEnteredAt: new Date().toISOString(),
      pausedStageIndex: null,
      canaryWeight: this.snapshot.config.deployment.stages[stageIndex]!.weight
    });

    this.emit("resumed", { stage_index: stageIndex });
  }

  promote(force = false): void {
    if (!this.snapshot || !["STAGE", "PAUSED"].includes(this.snapshot.state)) {
      throw new Error("Cannot promote in current state");
    }

    if (!force && this.snapshot.state === "STAGE") {
      const decision = this.evaluateStage(this.latestScores, this.currentCanaryErrorRate());
      if (!decision.promote) {
        throw new Error("Gate checks are not passing; use --force to override");
      }
    }

    this.advanceStage("manual_promote");
  }

  rollback(reason = "manual_rollback"): void {
    if (!this.snapshot || ["ROLLED_BACK", "PROMOTED", "IDLE"].includes(this.snapshot.state)) {
      throw new Error("No active deployment to rollback");
    }

    this.transition("ROLLING_BACK", reason, {
      canaryWeight: 0,
      reason
    });

    this.transition("ROLLED_BACK", reason, {
      finalState: "ROLLED_BACK",
      completedAt: new Date().toISOString(),
      canaryWeight: 0,
      reason
    });

    this.emit("rollback_triggered", {
      reason,
      stage_index: this.snapshot.stageIndex,
      canary_weight: 0
    });

    this.emit("deployment_complete", {
      final_state: "ROLLED_BACK"
    });
  }

  onScoreUpdate(snapshot: ScoreSnapshot): void {
    this.latestScores = snapshot;
    if (!this.snapshot || this.snapshot.state !== "STAGE") {
      return;
    }

    this.store.recordScoreSnapshot(this.snapshot.id, this.snapshot.stageIndex, snapshot);
    this.emit("score_update", snapshot);

    const decision = this.evaluateStage(snapshot, this.currentCanaryErrorRate());
    this.latestGates = decision.gateResults;
    this.nextAction = decision.nextAction;
    this.timeRemainingMs = decision.timeRemainingMs;

    this.emit("gate_status", {
      gates: decision.gateResults,
      next_action: decision.nextAction,
      time_remaining_ms: decision.timeRemainingMs
    });

    if (decision.rollback) {
      this.rollback(decision.reason ?? "rollback_triggered");
      return;
    }

    if (decision.promote) {
      this.advanceStage("auto_promote");
    }
  }

  private onMonitorHealth(health: Record<string, unknown>): void {
    this.emit("monitor_health", {
      status: (health.status as string | undefined) ?? "healthy",
      consecutive_failures: Number(health.consecutiveFailures ?? health.consecutive_failures ?? 0),
      total_requests: Number(health.totalRequests ?? health.total_requests ?? 0),
      total_rate_limited: Number(health.totalRateLimited ?? health.total_rate_limited ?? 0),
      last_error: (health.lastError ?? health.last_error) as string | undefined,
      last_error_at: (health.lastErrorAt ?? health.last_error_at) as string | undefined,
      last_success_at: (health.lastSuccessAt ?? health.last_success_at) as string | undefined,
      last_backoff_ms: Number(health.lastBackoffMs ?? health.last_backoff_ms ?? 0)
    });
  }

  private advanceStage(reason: string): void {
    if (!this.snapshot) {
      return;
    }

    const stages = this.snapshot.config.deployment.stages;
    const nextIndex = this.snapshot.stageIndex + 1;

    if (nextIndex >= stages.length) {
      this.transition("PROMOTED", reason, {
        canaryWeight: 100,
        finalState: "PROMOTED",
        completedAt: new Date().toISOString()
      });

      this.emit("deployment_complete", {
        final_state: "PROMOTED"
      });
      return;
    }

    const next = stages[nextIndex]!;
    const from = this.snapshot.stageIndex;
    this.transition("STAGE", reason, {
      stageIndex: nextIndex,
      stageEnteredAt: new Date().toISOString(),
      canaryWeight: next.weight
    });

    if (this.monitor) {
      this.monitor.resetForStage(new Date(this.snapshot.stageEnteredAt));
    }

    this.emit("stage_change", {
      from,
      to: nextIndex,
      canary_weight: next.weight
    });
  }

  private evaluateStage(snapshot: ScoreSnapshot, canaryErrorRate: number): StageDecision {
    if (!this.snapshot) {
      return {
        promote: false,
        rollback: false,
        nextAction: "hold",
        gateResults: [],
        timeRemainingMs: 0
      };
    }

    const stage = this.snapshot.config.deployment.stages[this.snapshot.stageIndex]!;
    const gateResults = stage.gates.map((gate) => this.evaluateGate(gate, stage, snapshot));

    const now = Date.now();
    const stageEnteredAt = new Date(this.snapshot.stageEnteredAt).getTime();
    const durationMs = stage.duration ? parseDuration(stage.duration) : 0;
    const elapsed = now - stageEnteredAt;
    const timeRemainingMs = Math.max(0, durationMs - elapsed);
    const durationElapsed = elapsed >= durationMs;

    const samplesReached = gateResults.every((result) => result.canaryN >= stage.min_samples);
    const allPassing = gateResults.length > 0 && gateResults.every((result) => result.status === "passing");

    const rollbackReason = this.evaluateRollback(gateResults, canaryErrorRate);
    if (rollbackReason) {
      return {
        promote: false,
        rollback: true,
        nextAction: "rollback",
        reason: rollbackReason,
        gateResults,
        timeRemainingMs
      };
    }

    const promote = allPassing && durationElapsed && samplesReached;
    return {
      promote,
      rollback: false,
      nextAction: promote ? "auto_promote" : "hold",
      gateResults,
      timeRemainingMs
    };
  }

  private evaluateGate(gate: Gate, stage: DeploymentStage, scores: ScoreSnapshot): GateResult {
    const baseline = scores[gate.scorer]?.baseline;
    const canary = scores[gate.scorer]?.canary;

    const baselineStats = makeRunningStats(
      baseline?.mean ?? 0,
      baseline?.std ?? 0,
      baseline?.n ?? 0
    );
    const canaryStats = makeRunningStats(canary?.mean ?? 0, canary?.std ?? 0, canary?.n ?? 0);

    return evaluateGate(gate, baselineStats, canaryStats, stage.min_samples);
  }

  private evaluateRollback(gates: GateResult[], canaryErrorRate: number): string | null {
    if (!this.snapshot) {
      return null;
    }

    const rollbackConfig = this.snapshot.config.deployment.rollback;
    const regressing = gates.find(
      (gate) => gate.status === "failing" && gate.pValue !== null && gate.pValue < 0.01
    );
    if (regressing) {
      return `score_regression:${regressing.scorer}`;
    }

    const absoluteDrop = gates.find(
      (gate) => gate.baselineMean - gate.canaryMean > rollbackConfig.on_score_drop
    );
    if (absoluteDrop) {
      return `absolute_drop:${absoluteDrop.scorer}`;
    }

    if (canaryErrorRate > rollbackConfig.on_error_rate) {
      return "error_rate_exceeded";
    }

    return null;
  }

  private currentCanaryErrorRate(): number {
    if (!this.monitor) {
      return 0;
    }
    return this.monitor.getStats().errorRateCanary;
  }

  private transition(
    to: DeploymentSnapshot["state"],
    reason: string,
    patch: Partial<DeploymentSnapshot> = {}
  ): void {
    if (!this.snapshot) {
      throw new Error("No active deployment");
    }

    const from = this.snapshot.state;
    this.snapshot = transitionSnapshot(this.snapshot, to, patch);
    this.store.updateDeployment(this.snapshot);
    this.store.recordTransition(this.snapshot.id, from, to, reason, this.latestScores);
  }

  private emit<T>(type: DeploymentEventEnvelope<T>["type"], data: T): void {
    if (!this.snapshot) {
      return;
    }
    const event: DeploymentEventEnvelope<T> = {
      type,
      deployment_id: this.snapshot.id,
      timestamp: new Date().toISOString(),
      data
    };

    this.store.recordEvent(event);
    this.bus.emitEvent(event);
  }
}

function makeRunningStats(mean: number, std: number, n: number): StatsLike {
  const samples: number[] = [];
  if (n <= 1) {
    if (n === 1) samples.push(mean);
  } else {
    for (let i = 0; i < n; i++) {
      const offset = i % 2 === 0 ? std : -std;
      samples.push(mean + offset);
    }
  }

  return {
    get count() {
      return n;
    },
    get average() {
      return mean;
    },
    get rawSamples() {
      return samples.length > 1 ? samples : [mean, mean];
    }
  };
}
