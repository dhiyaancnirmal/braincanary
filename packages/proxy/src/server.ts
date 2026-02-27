import { resolve } from "node:path";
import type { Server as HttpServer } from "node:http";
import { Hono } from "hono";
import type { Context } from "hono";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { WebSocketServer } from "ws";
import {
  BTQLClient,
  type DeploymentConfig,
  DeploymentConfigSchema,
  loadConfig,
  createBraintrustLogger,
  chooseVersion,
  DeploymentEventBus,
  ScoreMonitor,
  SqliteStateStore,
  StageController,
  validateBraintrustConfig,
  HistoryQuerySchema,
  PromoteRequestSchema,
  RollbackRequestSchema,
  type DeploymentEventEnvelope
} from "@braincanary/core";
import type { BraintrustLogger } from "@braincanary/core";
import { forwardRuntimeRequest } from "./adapters/runtime.js";
import { WebhookDispatcher } from "./services/webhook-dispatcher.js";

export interface ProxyServerOptions {
  host?: string;
  port?: number;
  dbPath?: string;
  autoConfigPath?: string;
}

export class BrainCanaryProxyServer {
  readonly app = new Hono();

  private readonly store: SqliteStateStore;
  private readonly eventBus = new DeploymentEventBus();
  private readonly controller: StageController;

  private monitor: ScoreMonitor | null = null;
  private logger: BraintrustLogger | null = null;
  private btqlClient: BTQLClient | null = null;
  private webhookDispatcher = new WebhookDispatcher();

  private server?: ReturnType<typeof serve>;
  private ws?: WebSocketServer;

  private host: string;
  private port: number;

  constructor(private readonly options: ProxyServerOptions = {}) {
    this.host = options.host ?? "127.0.0.1";
    this.port = options.port ?? 4100;
    this.store = new SqliteStateStore(options.dbPath ?? "./braincanary.db");
    this.controller = new StageController(this.store, this.eventBus);
    this.controller.recoverFromStore();
    this.eventBus.on("event", (event: DeploymentEventEnvelope) => {
      void this.webhookDispatcher.dispatch(event);
    });

    this.setupApp();
  }

  async start(): Promise<void> {
    this.server = serve({
      fetch: this.app.fetch,
      hostname: this.host,
      port: this.port
    });

    this.ws = new WebSocketServer({ server: this.server as unknown as HttpServer, path: "/ws" });
    this.eventBus.on("event", (event: DeploymentEventEnvelope) => {
      this.broadcast(event);
    });

    if (this.options.autoConfigPath) {
      await this.deployFromPath(this.options.autoConfigPath);
    }
  }

  async stop(): Promise<void> {
    this.monitor?.stop();
    this.ws?.close();
    this.server?.close();
    this.store.close();
  }

  getAddress(): string {
    return `http://${this.host}:${this.port}`;
  }

  async deployFromPath(configPath: string): Promise<{ deployment_id: string; state: string }> {
    const config = await loadConfig(configPath);
    return this.deploy(config);
  }

  async deploy(config: DeploymentConfig): Promise<{ deployment_id: string; state: string }> {
    this.monitor?.stop();

    const apiKey = process.env.BRAINTRUST_API_KEY;
    if (!apiKey) {
      throw new Error("BRAINTRUST_API_KEY is required to deploy");
    }

    this.btqlClient = new BTQLClient({
      apiKey,
      apiUrl: config.deployment.monitor.btql.api_url,
      path: config.deployment.monitor.btql.path,
      queryTimeoutMs: config.deployment.monitor.btql.query_timeout_ms,
      maxRetries: config.deployment.monitor.btql.max_retries
    });

    await validateBraintrustConfig(config, this.btqlClient);

    this.logger = createBraintrustLogger(config);
    this.webhookDispatcher.setConfig(config);
    const snapshot = this.controller.startDeployment(config);

    const scorerNames = uniqueScorers(config);

    this.monitor = new ScoreMonitor(this.btqlClient, {
      deploymentId: snapshot.id,
      projectName: config.deployment.project,
      pollInterval: config.deployment.monitor.poll_interval,
      stageStartTime: new Date(snapshot.stageEnteredAt),
      scorerNames,
      scorerLagGrace: config.deployment.monitor.scorer_lag_grace
    });

    this.controller.attachMonitor(this.monitor);
    this.monitor.start();

    return { deployment_id: snapshot.id, state: snapshot.state };
  }

  private setupApp(): void {
    const dashboardRoot = resolve(process.cwd(), "packages/dashboard/dist");
    this.app.use("/dashboard/*", serveStatic({ root: dashboardRoot }));
    this.app.get("/dashboard", serveStatic({ root: dashboardRoot, path: "index.html" }));

    this.app.get("/health", (c) => c.json({ ok: true }));

    this.app.post("/v1/chat/completions", (c) => this.handleModelRequest(c));
    this.app.post("/v1/completions", (c) => this.handleModelRequest(c));
    this.app.post("/v1/embeddings", (c) => this.handleModelRequest(c));

    this.app.get("/api/status", (c) => {
      const status = this.controller.getStatus();
      const snapshot = status.deployment;

      return c.json({
        deployment: snapshot
          ? {
              id: snapshot.id,
              name: snapshot.name,
              state: snapshot.state,
              stage_index: snapshot.stageIndex,
              stage_count: snapshot.config.deployment.stages.length,
              canary_weight: snapshot.canaryWeight,
              started_at: snapshot.startedAt,
              stage_entered_at: snapshot.stageEnteredAt
            }
          : null,
        scores: status.scores,
        gates: status.gates,
        next_action: status.nextAction,
        time_remaining_ms: status.timeRemainingMs
      });
    });

    this.app.post("/api/deploy", async (c) => {
      try {
        const body = (await c.req.json().catch(() => ({}))) as {
          config_path?: string;
          config?: unknown;
        };

        if (!body.config_path && !body.config) {
          return c.json({ error: "config_path or config is required" }, 400);
        }

        const result = body.config_path
          ? await this.deployFromPath(body.config_path)
          : await this.deploy(DeploymentConfigSchema.parse(body.config));

        return c.json(result);
      } catch (error) {
        return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
      }
    });

    this.app.post("/api/promote", async (c) => {
      try {
        const body = PromoteRequestSchema.parse(await c.req.json().catch(() => ({})));
        this.controller.promote(body.force);
        return c.json({ ok: true });
      } catch (error) {
        return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
      }
    });

    this.app.post("/api/rollback", async (c) => {
      try {
        const body = RollbackRequestSchema.parse(await c.req.json().catch(() => ({})));
        this.controller.rollback(body.reason);
        return c.json({ ok: true });
      } catch (error) {
        return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
      }
    });

    this.app.post("/api/pause", () => {
      try {
        this.controller.pause();
        return new Response(JSON.stringify({ ok: true }), {
          headers: { "Content-Type": "application/json" }
        });
      } catch (error) {
        return new Response(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }), {
          status: 400,
          headers: { "Content-Type": "application/json" }
        });
      }
    });

    this.app.post("/api/resume", () => {
      try {
        this.controller.resume();
        return new Response(JSON.stringify({ ok: true }), {
          headers: { "Content-Type": "application/json" }
        });
      } catch (error) {
        return new Response(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }), {
          status: 400,
          headers: { "Content-Type": "application/json" }
        });
      }
    });

    this.app.get("/api/history", (c) => {
      const parsed = HistoryQuerySchema.safeParse({
        limit: c.req.query("limit")
      });
      const limit = parsed.success ? parsed.data.limit : 10;
      return c.json({ deployments: this.store.listHistory(limit) });
    });

    this.app.get("/api/monitor", () => {
      if (!this.btqlClient) {
        return new Response(
          JSON.stringify({
            status: "healthy",
            consecutive_failures: 0,
            total_requests: 0,
            total_rate_limited: 0
          }),
          {
            headers: { "Content-Type": "application/json" }
          }
        );
      }

      const diagnostics = this.btqlClient.getDiagnostics();
      return new Response(
        JSON.stringify({
          status: diagnostics.status,
          consecutive_failures: diagnostics.consecutiveFailures,
          total_requests: diagnostics.totalRequests,
          total_rate_limited: diagnostics.totalRateLimited,
          last_success_at: diagnostics.lastSuccessAt,
          last_error_at: diagnostics.lastErrorAt,
          last_error: diagnostics.lastError,
          last_backoff_ms: diagnostics.lastBackoffMs
        }),
        { headers: { "Content-Type": "application/json" } }
      );
    });

    this.app.get("/api/events", (c) => {
      const deploymentId = this.controller.getSnapshot()?.id;
      if (!deploymentId) {
        return new Response("", {
          status: 204
        });
      }

      const stream = new ReadableStream({
        start: (controller) => {
          for (const event of this.store.getRecentEvents(deploymentId, 25).reverse()) {
            controller.enqueue(encodeSSE(event));
          }

          const onEvent = (event: DeploymentEventEnvelope) => {
            controller.enqueue(encodeSSE(event));
          };

          this.eventBus.on("event", onEvent);

          controller.enqueue(`event: connected\ndata: ${JSON.stringify({ deployment_id: deploymentId })}\n\n`);

          const close = () => {
            this.eventBus.off("event", onEvent);
          };

          c.req.raw.signal.addEventListener("abort", close, { once: true });
        }
      });

      return new Response(stream, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive"
        }
      });
    });
  }

  private async handleModelRequest(c: Context): Promise<Response> {
    const snapshot = this.controller.getSnapshot();
    if (!snapshot) {
      return c.json({ error: "No active deployment" }, 503);
    }

    const body = await c.req.json().catch(() => ({}));
    const stickyKey = snapshot.config.deployment.monitor.sticky_key;
    const stickyValue = extractStickyValue(body, stickyKey, c.req.header("x-braincanary-sticky"));
    const decision = chooseVersion(snapshot, stickyValue);

    const response = await forwardRuntimeRequest({
      deployment: snapshot.config.deployment,
      deploymentId: snapshot.id,
      deploymentName: snapshot.name,
      stageIndex: decision.stageIndex,
      version: decision.version,
      pathname: c.req.path,
      body,
      logger: this.logger,
      incomingHeaders: c.req.raw.headers
    });

    return response;
  }

  private broadcast(event: DeploymentEventEnvelope): void {
    if (!this.ws) {
      return;
    }
    const payload = JSON.stringify(event);
    for (const client of this.ws.clients) {
      if (client.readyState === 1) {
        client.send(payload);
      }
    }
  }
}

function encodeSSE(event: DeploymentEventEnvelope): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

function uniqueScorers(config: DeploymentConfig): string[] {
  const set = new Set<string>();
  for (const stage of config.deployment.stages) {
    for (const gate of stage.gates) {
      set.add(gate.scorer);
    }
  }
  return [...set];
}

function extractStickyValue(body: unknown, stickyKey: string | undefined, headerSticky: string | undefined): string | undefined {
  if (headerSticky) {
    return headerSticky;
  }

  if (!stickyKey || !body || typeof body !== "object") {
    return undefined;
  }

  const parts = stickyKey.split(".");
  let current: unknown = body;
  for (const part of parts) {
    if (!current || typeof current !== "object") {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }

  if (current === undefined || current === null) {
    return undefined;
  }

  return String(current);
}
