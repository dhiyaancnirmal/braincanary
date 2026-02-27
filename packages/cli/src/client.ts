export class BrainCanaryHttpClient {
  constructor(private readonly baseUrl: string) {}

  async health(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/health`);
      return res.ok;
    } catch {
      return false;
    }
  }

  async status(): Promise<any> {
    return this.request("GET", "/api/status");
  }

  async deploy(configPath: string): Promise<any> {
    return this.request("POST", "/api/deploy", { config_path: configPath });
  }

  async promote(force = false): Promise<any> {
    return this.request("POST", "/api/promote", { force });
  }

  async rollback(reason?: string): Promise<any> {
    return this.request("POST", "/api/rollback", { reason });
  }

  async pause(): Promise<any> {
    return this.request("POST", "/api/pause", {});
  }

  async resume(): Promise<any> {
    return this.request("POST", "/api/resume", {});
  }

  async history(limit = 10): Promise<any> {
    return this.request("GET", `/api/history?limit=${limit}`);
  }

  async monitor(): Promise<any> {
    return this.request("GET", "/api/monitor");
  }

  private async request(method: string, path: string, body?: unknown): Promise<any> {
    const init: RequestInit = {
      method,
      ...(body ? { headers: { "Content-Type": "application/json" } } : {}),
      ...(body ? { body: JSON.stringify(body) } : {})
    };

    const response = await fetch(`${this.baseUrl}${path}`, init);

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error ?? `HTTP ${response.status}`);
    }
    return data;
  }
}
