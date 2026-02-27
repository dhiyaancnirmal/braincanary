#!/usr/bin/env node
import { BrainCanaryProxyServer } from "./server.js";

function getArg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  return process.argv[index + 1];
}

async function main(): Promise<void> {
  const host = getArg("--host") ?? process.env.BRAINCANARY_HOST ?? "127.0.0.1";
  const port = Number(getArg("--port") ?? process.env.BRAINCANARY_PORT ?? 4100);
  const dbPath = getArg("--db") ?? process.env.BRAINCANARY_DB_PATH ?? "./braincanary.db";
  const configPath = getArg("--config") ?? process.env.BRAINCANARY_CONFIG;

  const server = new BrainCanaryProxyServer({
    host,
    port,
    dbPath,
    ...(configPath ? { autoConfigPath: configPath } : {})
  });

  await server.start();
  console.log(`[braincanary-proxy] listening on ${server.getAddress()}`);

  const shutdown = async () => {
    console.log("[braincanary-proxy] shutting down...");
    await server.stop();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
