import type { DeploymentConfig, Deployment } from "@braincanary/core";
import { buildTraceMetadata, withTrace, type BraintrustLogger } from "@braincanary/core";

export interface ForwardRequestArgs {
  deployment: Deployment;
  deploymentId: string;
  deploymentName: string;
  stageIndex: number;
  version: "baseline" | "canary";
  pathname: string;
  body: unknown;
  logger: BraintrustLogger | null;
  incomingHeaders: Headers;
}

export async function forwardRuntimeRequest(args: ForwardRequestArgs): Promise<Response> {
  const selected = args.version === "canary" ? args.deployment.canary : args.deployment.baseline;
  const runtime = args.deployment.runtime;

  const target = runtime.mode === "gateway"
    ? {
        baseUrl: runtime.gateway.base_url,
        apiKey: process.env[runtime.gateway.api_key_env] || process.env.BRAINTRUST_API_KEY || ""
      }
    : {
        baseUrl: resolveDirectBaseUrl(args.deployment),
        apiKey: process.env[runtime.direct.api_key_env] || process.env.OPENAI_API_KEY || ""
      };

  if (!target.apiKey) {
    return new Response(
      JSON.stringify({ error: `Missing API key env var for runtime mode '${runtime.mode}'` }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" }
      }
    );
  }

  const rewrittenBody = rewriteBody(args.body, {
    model: selected.model,
    ...(selected.prompt ? { prompt: selected.prompt } : {}),
    ...(selected.system_prompt ? { systemPrompt: selected.system_prompt } : {})
  });

  const metadata = buildTraceMetadata({
    deploymentId: args.deploymentId,
    deploymentName: args.deploymentName,
    version: args.version,
    stage: args.stageIndex,
    model: selected.model,
    ...(selected.prompt ? { prompt: selected.prompt } : {})
  });

  const outgoingHeaders = new Headers();
  copyAllowedHeaders(args.incomingHeaders, outgoingHeaders);
  outgoingHeaders.set("Authorization", `Bearer ${target.apiKey}`);
  outgoingHeaders.set("Content-Type", "application/json");

  const response = await withTrace(args.logger, metadata, async () => {
    return fetch(`${target.baseUrl}${args.pathname}`, {
      method: "POST",
      headers: outgoingHeaders,
      body: JSON.stringify(rewrittenBody)
    });
  });

  const proxyHeaders = new Headers(response.headers);
  proxyHeaders.set("X-BrainCanary-Version", args.version);
  proxyHeaders.set("X-BrainCanary-Deployment", args.deploymentId);
  proxyHeaders.set("X-BrainCanary-Stage", String(args.stageIndex + 1));

  return new Response(response.body, {
    status: response.status,
    headers: proxyHeaders
  });
}

function resolveDirectBaseUrl(deployment: Deployment): string {
  const custom = deployment.runtime.direct.base_url;
  if (custom) {
    return custom.replace(/\/$/, "");
  }

  switch (deployment.runtime.direct.provider) {
    case "openai":
      return "https://api.openai.com/v1";
    case "anthropic":
      return "https://api.anthropic.com/v1";
    case "google":
      return "https://generativelanguage.googleapis.com/v1beta";
    default:
      return "https://api.openai.com/v1";
  }
}

function rewriteBody(
  body: unknown,
  options: { model: string; prompt?: string; systemPrompt?: string }
): Record<string, unknown> {
  const payload = typeof body === "object" && body !== null ? { ...(body as Record<string, unknown>) } : {};

  payload.model = options.model;

  if (options.systemPrompt && Array.isArray(payload.messages)) {
    const messages = payload.messages as Array<Record<string, unknown>>;
    if (messages.length > 0 && messages[0]?.role === "system") {
      messages[0] = { ...messages[0], content: options.systemPrompt };
    } else {
      messages.unshift({ role: "system", content: options.systemPrompt });
    }
    payload.messages = messages;
  }

  if (options.prompt) {
    payload.metadata = {
      ...(payload.metadata as Record<string, unknown> | undefined),
      braincanary_prompt: options.prompt
    };
  }

  return payload;
}

function copyAllowedHeaders(from: Headers, to: Headers): void {
  from.forEach((value, key) => {
    const lower = key.toLowerCase();
    if (["host", "content-length", "authorization"].includes(lower)) {
      return;
    }
    to.set(key, value);
  });
}
