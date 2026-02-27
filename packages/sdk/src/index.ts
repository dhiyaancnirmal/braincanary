import OpenAI from "openai";

export interface WrapOptions {
  proxyBaseUrl?: string;
  deploymentId?: string;
  metadata?: Record<string, string>;
  timeoutMs?: number;
}

export function wrap<T extends OpenAI>(client: T, options: WrapOptions = {}): T {
  const baseURL = options.proxyBaseUrl ?? process.env.BRAINCANARY_BASE_URL ?? "http://127.0.0.1:4100/v1";
  const source = client as unknown as {
    apiKey?: string;
    organization?: string;
    project?: string;
    defaultHeaders?: Record<string, string>;
  };

  // OpenAI client options are immutable after construction, so create a compatible clone.
  const cloned = new OpenAI({
    apiKey: source.apiKey,
    organization: source.organization,
    project: source.project,
    baseURL,
    defaultHeaders: {
      ...(source.defaultHeaders ?? {}),
      ...(options.deploymentId ? { "x-braincanary-deployment-id": options.deploymentId } : {}),
      ...options.metadata
    },
    timeout: options.timeoutMs
  });

  return cloned as T;
}

export interface BrainCanaryClientOptions {
  baseURL?: string;
  apiKey?: string;
  deploymentId?: string;
}

export function createBrainCanaryClient(options: BrainCanaryClientOptions = {}): OpenAI {
  return new OpenAI({
    apiKey: options.apiKey ?? process.env.BRAINTRUST_API_KEY ?? "",
    baseURL: options.baseURL ?? "http://127.0.0.1:4100/v1",
    defaultHeaders: options.deploymentId
      ? { "x-braincanary-deployment-id": options.deploymentId }
      : undefined
  });
}
