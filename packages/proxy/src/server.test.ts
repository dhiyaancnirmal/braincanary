import { afterEach, describe, expect, it } from "vitest";
import { rmSync } from "node:fs";
import { createRequire } from "node:module";
import { BrainCanaryProxyServer } from "./server.js";

const DB_PATH = "/tmp/braincanary-proxy-test.db";

const require = createRequire(import.meta.url);
const hasSqliteBinding = (() => {
  try {
    require("better-sqlite3");
    return true;
  } catch {
    return false;
  }
})();

const itIfSqlite = hasSqliteBinding ? it : it.skip;

afterEach(() => {
  rmSync(DB_PATH, { force: true });
  rmSync(`${DB_PATH}-wal`, { force: true });
  rmSync(`${DB_PATH}-shm`, { force: true });
});

describe("BrainCanaryProxyServer", () => {
  itIfSqlite("returns status with no active deployment", async () => {
    let server: BrainCanaryProxyServer;
    try {
      server = new BrainCanaryProxyServer({ dbPath: DB_PATH });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("Could not locate the bindings file")) {
        return;
      }
      throw error;
    }
    const response = await server.app.request("/api/status");
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.deployment).toBeNull();
    await server.stop();
  });
});
