import * as Braintrust from "braintrust";
import type { DeploymentConfig } from "../config/schema.js";

export interface TraceMetadata {
  [key: string]: string | number | boolean | null | undefined;
}

export interface BraintrustLogger {
  traced?<T>(fn: (span: { log: (args: Record<string, unknown>) => void }) => Promise<T>): Promise<T>;
  flush?: () => Promise<void>;
}

export function createBraintrustLogger(config: DeploymentConfig): BraintrustLogger | null {
  const initLogger = (Braintrust as Record<string, unknown>).initLogger as
    | ((args: Record<string, unknown>) => BraintrustLogger)
    | undefined;

  if (!initLogger) {
    return null;
  }

  const apiKey = process.env.BRAINTRUST_API_KEY;
  if (!apiKey) {
    return null;
  }

  return initLogger({
    projectName: config.deployment.project,
    apiKey,
    flush: true,
    noExitFlush: true
  });
}

export function wrapProviderClient(provider: "openai" | "anthropic" | "google", client: unknown): unknown {
  const bt = Braintrust as Record<string, unknown>;
  if (provider === "openai") {
    const wrap = bt.wrapOpenAI as ((c: unknown) => unknown) | undefined;
    return wrap ? wrap(client) : client;
  }
  if (provider === "anthropic") {
    const wrap = bt.wrapAnthropic as ((c: unknown) => unknown) | undefined;
    return wrap ? wrap(client) : client;
  }
  const wrap = bt.wrapGoogleGenAI as ((c: unknown) => unknown) | undefined;
  return wrap ? wrap(client) : client;
}

export async function withTrace<T>(
  logger: BraintrustLogger | null,
  metadata: TraceMetadata,
  run: () => Promise<T>
): Promise<T> {
  if (!logger?.traced) {
    return run();
  }

  return logger.traced(async (span) => {
    span.log({ metadata });
    return run();
  });
}

export function buildTraceMetadata(args: {
  deploymentId: string;
  deploymentName: string;
  version: "baseline" | "canary";
  stage: number;
  model: string;
  prompt?: string;
}): TraceMetadata {
  return {
    "braincanary.deployment_id": args.deploymentId,
    "braincanary.deployment_name": args.deploymentName,
    "braincanary.version": args.version,
    "braincanary.stage": args.stage,
    "braincanary.model": args.model,
    "braincanary.prompt": args.prompt
  };
}
