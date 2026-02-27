import { afterEach, describe, expect, it } from "vitest";
import { rmSync } from "node:fs";
import { createRequire } from "node:module";

const DB_PATH = "/tmp/braincanary-core-test.db";

afterEach(() => {
  rmSync(DB_PATH, { force: true });
  rmSync(`${DB_PATH}-wal`, { force: true });
  rmSync(`${DB_PATH}-shm`, { force: true });
});

function hasSqliteBinding(): boolean {
  try {
    const req = createRequire(import.meta.url);
    req("better-sqlite3");
    return true;
  } catch {
    return false;
  }
}

const itIfSqlite = hasSqliteBinding() ? it : it.skip;

describe("SqliteStateStore", () => {
  itIfSqlite("stores and recovers active deployment", async () => {
    const { SqliteStateStore } = await import("./store.js");
    let store: InstanceType<typeof SqliteStateStore>;
    try {
      store = new SqliteStateStore(DB_PATH);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("Could not locate the bindings file")) {
        return;
      }
      throw error;
    }

    store.createDeployment({
      id: "dep-1",
      name: "test",
      config: {
        deployment: {
          name: "test",
          project: "test",
          baseline: { model: "m1" },
          canary: { model: "m2" },
          stages: [
            {
              weight: 5,
              gates: [
                {
                  scorer: "Correctness",
                  threshold: 0.8,
                  comparison: "not_worse_than_baseline",
                  confidence: 0.95
                }
              ],
              min_samples: 10
            },
            { weight: 100, gates: [], min_samples: 10 }
          ],
          runtime: {
            mode: "direct",
            direct: { provider: "openai", api_key_env: "OPENAI_API_KEY" },
            gateway: {
              base_url: "https://gateway.braintrust.dev/v1",
              provider_compat: "openai",
              api_key_env: "BRAINTRUST_API_KEY"
            }
          },
          rollback: { on_score_drop: 0.1, on_error_rate: 0.05, cooldown: "5m" },
          monitor: {
            poll_interval: "30s",
            scorer_lag_grace: "2m",
            btql: {
              api_url: "https://api.braintrust.dev",
              path: "/btql",
              query_timeout_ms: 10000,
              max_retries: 3
            }
          },
          notifications: { webhooks: [] },
          server: { port: 4100, host: "127.0.0.1" }
        }
      },
      state: "STAGE",
      stageIndex: 0,
      stageEnteredAt: new Date().toISOString(),
      startedAt: new Date().toISOString(),
      canaryWeight: 5
    });

    const recovered = store.getActiveDeployment();

    expect(recovered?.id).toBe("dep-1");
    expect(recovered?.state).toBe("STAGE");
    store.close();
  });
});
