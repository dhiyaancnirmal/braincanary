export interface BTQLClientConfig {
  apiKey: string;
  apiUrl: string;
  path: string;
  queryTimeoutMs: number;
  maxRetries: number;
}

export interface BTQLRow {
  id?: string;
  scores: Record<string, number | null>;
  metadata?: Record<string, unknown>;
  created: string;
  error?: string | null;
}

export interface MonitorDiagnostics {
  status: "healthy" | "degraded";
  consecutiveFailures: number;
  totalRequests: number;
  totalRateLimited: number;
  lastSuccessAt?: string;
  lastErrorAt?: string;
  lastError?: string;
  lastBackoffMs?: number;
}

export class BTQLError extends Error {
  constructor(
    message: string,
    readonly status?: number
  ) {
    super(message);
    this.name = "BTQLError";
  }
}

export class BTQLClient {
  private diagnostics: MonitorDiagnostics = {
    status: "healthy",
    consecutiveFailures: 0,
    totalRequests: 0,
    totalRateLimited: 0
  };

  constructor(private readonly config: BTQLClientConfig) {}

  getDiagnostics(): MonitorDiagnostics {
    return { ...this.diagnostics };
  }

  async query<T = BTQLRow>(sql: string): Promise<T[]> {
    const endpoint = `${this.config.apiUrl.replace(/\/$/, "")}${this.config.path}`;
    let attempt = 0;

    while (true) {
      this.diagnostics.totalRequests += 1;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.config.queryTimeoutMs);

      try {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.config.apiKey}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            query: sql,
            fmt: "json"
          }),
          signal: controller.signal
        });

        clearTimeout(timer);

        if (response.status === 429) {
          this.diagnostics.totalRateLimited += 1;
          throw new BTQLError("BTQL rate limited", 429);
        }

        if (!response.ok) {
          const body = await response.text();
          throw new BTQLError(`BTQL query failed (${response.status}): ${body}`, response.status);
        }

        const payload = (await response.json()) as { data?: T[] };
        this.recordSuccess();
        return payload.data ?? [];
      } catch (error) {
        clearTimeout(timer);
        const err = error instanceof Error ? error : new Error(String(error));
        attempt += 1;

        if (attempt > this.config.maxRetries || !isRetryable(err)) {
          this.recordFailure(err.message);
          throw err;
        }

        const backoff = this.computeBackoffMs(attempt);
        this.diagnostics.lastBackoffMs = backoff;
        await sleep(backoff);
      }
    }
  }

  private computeBackoffMs(attempt: number): number {
    const base = Math.min(1_000 * 2 ** (attempt - 1), 16_000);
    const jitter = Math.floor(Math.random() * 400);
    return base + jitter;
  }

  private recordSuccess(): void {
    this.diagnostics.consecutiveFailures = 0;
    this.diagnostics.status = "healthy";
    this.diagnostics.lastSuccessAt = new Date().toISOString();
    delete this.diagnostics.lastError;
    delete this.diagnostics.lastErrorAt;
  }

  private recordFailure(message: string): void {
    this.diagnostics.consecutiveFailures += 1;
    this.diagnostics.status = "degraded";
    this.diagnostics.lastError = message;
    this.diagnostics.lastErrorAt = new Date().toISOString();
  }
}

function isRetryable(error: Error): boolean {
  if (error.name === "AbortError") {
    return true;
  }

  if (error instanceof BTQLError) {
    if (!error.status) {
      return true;
    }
    return error.status === 429 || error.status >= 500;
  }

  return true;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
