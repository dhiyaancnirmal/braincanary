import Database from "better-sqlite3";
import type { DeploymentEventEnvelope } from "../contracts/events.js";
import type { DeploymentConfig } from "../config/schema.js";
import type { DeploymentSnapshot, ScoreSnapshot } from "../state/types.js";

export interface DeploymentHistoryItem {
  id: string;
  name: string;
  state: string;
  startedAt: string;
  completedAt?: string;
  finalState?: string;
}

interface DeploymentRow {
  id: string;
  name: string;
  config_json: string;
  state: string;
  stage_index: number;
  stage_entered_at: string;
  started_at: string;
  completed_at: string | null;
  final_state: string | null;
  paused_stage_index: number | null;
  canary_weight: number;
  reason: string | null;
}

export class SqliteStateStore {
  private db: Database.Database;

  constructor(filePath: string) {
    this.db = new Database(filePath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("synchronous = NORMAL");
    this.init();
  }

  init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS deployments (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        config_json TEXT NOT NULL,
        state TEXT NOT NULL,
        stage_index INTEGER NOT NULL,
        stage_entered_at TEXT NOT NULL,
        started_at TEXT NOT NULL,
        completed_at TEXT,
        final_state TEXT,
        paused_stage_index INTEGER,
        canary_weight INTEGER NOT NULL,
        reason TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS state_transitions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        deployment_id TEXT NOT NULL,
        from_state TEXT NOT NULL,
        to_state TEXT NOT NULL,
        reason TEXT,
        scores_snapshot TEXT,
        timestamp TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY(deployment_id) REFERENCES deployments(id)
      );

      CREATE TABLE IF NOT EXISTS score_snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        deployment_id TEXT NOT NULL,
        stage_index INTEGER NOT NULL,
        scorer TEXT NOT NULL,
        baseline_mean REAL NOT NULL,
        baseline_std REAL NOT NULL,
        baseline_n INTEGER NOT NULL,
        canary_mean REAL NOT NULL,
        canary_std REAL NOT NULL,
        canary_n INTEGER NOT NULL,
        timestamp TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY(deployment_id) REFERENCES deployments(id)
      );

      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        deployment_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        FOREIGN KEY(deployment_id) REFERENCES deployments(id)
      );
    `);
  }

  createDeployment(snapshot: DeploymentSnapshot): void {
    const stmt = this.db.prepare(`
      INSERT INTO deployments (
        id, name, config_json, state, stage_index, stage_entered_at,
        started_at, completed_at, final_state, paused_stage_index, canary_weight, reason
      ) VALUES (
        @id, @name, @config_json, @state, @stage_index, @stage_entered_at,
        @started_at, @completed_at, @final_state, @paused_stage_index, @canary_weight, @reason
      )
    `);

    stmt.run(this.toRow(snapshot));
  }

  updateDeployment(snapshot: DeploymentSnapshot): void {
    const stmt = this.db.prepare(`
      UPDATE deployments
      SET
        state = @state,
        stage_index = @stage_index,
        stage_entered_at = @stage_entered_at,
        completed_at = @completed_at,
        final_state = @final_state,
        paused_stage_index = @paused_stage_index,
        canary_weight = @canary_weight,
        reason = @reason
      WHERE id = @id
    `);

    stmt.run(this.toRow(snapshot));
  }

  recordTransition(
    deploymentId: string,
    fromState: string,
    toState: string,
    reason: string | undefined,
    scoresSnapshot?: ScoreSnapshot
  ): void {
    const stmt = this.db.prepare(`
      INSERT INTO state_transitions (deployment_id, from_state, to_state, reason, scores_snapshot)
      VALUES (?, ?, ?, ?, ?)
    `);

    stmt.run(
      deploymentId,
      fromState,
      toState,
      reason ?? null,
      scoresSnapshot ? JSON.stringify(scoresSnapshot) : null
    );
  }

  recordScoreSnapshot(deploymentId: string, stageIndex: number, scores: ScoreSnapshot): void {
    const insert = this.db.prepare(`
      INSERT INTO score_snapshots (
        deployment_id, stage_index, scorer,
        baseline_mean, baseline_std, baseline_n,
        canary_mean, canary_std, canary_n
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const tx = this.db.transaction(() => {
      for (const [scorer, summary] of Object.entries(scores)) {
        insert.run(
          deploymentId,
          stageIndex,
          scorer,
          summary.baseline.mean,
          summary.baseline.std,
          summary.baseline.n,
          summary.canary.mean,
          summary.canary.std,
          summary.canary.n
        );
      }
    });

    tx();
  }

  recordEvent<T>(event: DeploymentEventEnvelope<T>): void {
    const stmt = this.db.prepare(
      `INSERT INTO events (deployment_id, event_type, payload_json, timestamp) VALUES (?, ?, ?, ?)`
    );
    stmt.run(event.deployment_id, event.type, JSON.stringify(event.data), event.timestamp);
  }

  getActiveDeployment(): DeploymentSnapshot | null {
    const row = this.db
      .prepare(
        `SELECT * FROM deployments WHERE state NOT IN ('IDLE', 'PROMOTED', 'ROLLED_BACK') ORDER BY started_at DESC LIMIT 1`
      )
      .get() as DeploymentRow | undefined;

    return row ? this.fromRow(row) : null;
  }

  getDeployment(id: string): DeploymentSnapshot | null {
    const row = this.db.prepare(`SELECT * FROM deployments WHERE id = ?`).get(id) as
      | DeploymentRow
      | undefined;
    return row ? this.fromRow(row) : null;
  }

  listHistory(limit: number): DeploymentHistoryItem[] {
    const rows = this.db
      .prepare(
        `SELECT id, name, state, started_at, completed_at, final_state
         FROM deployments
         ORDER BY started_at DESC
         LIMIT ?`
      )
      .all(limit) as Array<{
      id: string;
      name: string;
      state: string;
      started_at: string;
      completed_at: string | null;
      final_state: string | null;
    }>;

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      state: row.state,
      startedAt: row.started_at,
      ...(row.completed_at ? { completedAt: row.completed_at } : {}),
      ...(row.final_state ? { finalState: row.final_state } : {})
    }));
  }

  getRecentEvents(deploymentId: string, limit = 50): DeploymentEventEnvelope[] {
    const rows = this.db
      .prepare(
        `SELECT event_type, timestamp, payload_json FROM events WHERE deployment_id = ? ORDER BY id DESC LIMIT ?`
      )
      .all(deploymentId, limit) as Array<{
      event_type: string;
      timestamp: string;
      payload_json: string;
    }>;

    return rows.map((row) => ({
      type: row.event_type,
      timestamp: row.timestamp,
      deployment_id: deploymentId,
      data: JSON.parse(row.payload_json)
    })) as DeploymentEventEnvelope[];
  }

  close(): void {
    this.db.close();
  }

  private toRow(snapshot: DeploymentSnapshot): Record<string, unknown> {
    return {
      id: snapshot.id,
      name: snapshot.name,
      config_json: JSON.stringify(snapshot.config),
      state: snapshot.state,
      stage_index: snapshot.stageIndex,
      stage_entered_at: snapshot.stageEnteredAt,
      started_at: snapshot.startedAt,
      completed_at: snapshot.completedAt ?? null,
      final_state: snapshot.finalState ?? null,
      paused_stage_index: snapshot.pausedStageIndex ?? null,
      canary_weight: snapshot.canaryWeight,
      reason: snapshot.reason ?? null
    };
  }

  private fromRow(row: DeploymentRow): DeploymentSnapshot {
    return {
      id: row.id,
      name: row.name,
      config: JSON.parse(row.config_json) as DeploymentConfig,
      state: row.state as DeploymentSnapshot["state"],
      stageIndex: row.stage_index,
      stageEnteredAt: row.stage_entered_at,
      startedAt: row.started_at,
      ...(row.completed_at ? { completedAt: row.completed_at } : {}),
      ...(row.final_state
        ? { finalState: row.final_state as NonNullable<DeploymentSnapshot["finalState"]> }
        : {}),
      pausedStageIndex: row.paused_stage_index,
      canaryWeight: row.canary_weight,
      ...(row.reason ? { reason: row.reason } : {})
    };
  }
}
