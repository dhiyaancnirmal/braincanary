import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { BrainCanaryHttpClient } from "./client.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

export async function ensureDaemon(params: {
  host: string;
  port: number;
  dbPath?: string;
  detach?: boolean;
}): Promise<void> {
  const baseUrl = `http://${params.host}:${params.port}`;
  const client = new BrainCanaryHttpClient(baseUrl);

  if (await client.health()) {
    return;
  }

  const proxyDist = resolve(__dirname, "../../proxy/dist/cli.js");
  const proxySrc = resolve(__dirname, "../../proxy/src/cli.ts");

  const args = [
    existsSync(proxyDist) ? proxyDist : proxySrc,
    "--host",
    params.host,
    "--port",
    String(params.port)
  ];

  if (params.dbPath) {
    args.push("--db", params.dbPath);
  }

  const command = existsSync(proxyDist) ? process.execPath : "tsx";
  const child = spawn(command, args, {
    detached: Boolean(params.detach),
    stdio: params.detach ? "ignore" : "inherit",
    env: process.env
  });

  if (params.detach) {
    child.unref();
  }

  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (await client.health()) {
      return;
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
  }

  throw new Error(`Failed to start daemon at ${baseUrl}`);
}
