import type { DeploymentConfig, DeploymentEventEnvelope } from "@braincanary/core";

interface WebhookConfig {
  url: string;
  on: string[];
  headers: Record<string, string>;
  retries: number;
}

export class WebhookDispatcher {
  private hooks: WebhookConfig[] = [];

  setConfig(config: DeploymentConfig): void {
    this.hooks = config.deployment.notifications.webhooks.map((hook) => ({
      url: hook.url,
      on: hook.on,
      headers: hook.headers,
      retries: hook.retries
    }));
  }

  async dispatch(event: DeploymentEventEnvelope): Promise<void> {
    if (this.hooks.length === 0) {
      return;
    }

    await Promise.all(
      this.hooks
        .filter((hook) => hook.on.includes("*") || hook.on.includes(event.type))
        .map((hook) => this.sendWithRetry(hook, event))
    );
  }

  private async sendWithRetry(hook: WebhookConfig, event: DeploymentEventEnvelope): Promise<void> {
    let attempt = 0;
    while (true) {
      attempt += 1;
      try {
        const response = await fetch(hook.url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...hook.headers
          },
          body: JSON.stringify(event)
        });

        if (!response.ok) {
          throw new Error(`Webhook failed: HTTP ${response.status}`);
        }

        return;
      } catch (error) {
        if (attempt > hook.retries) {
          console.warn(
            `[braincanary] webhook delivery failed for ${hook.url}: ${
              error instanceof Error ? error.message : String(error)
            }`
          );
          return;
        }

        await new Promise((resolve) => setTimeout(resolve, Math.min(2 ** attempt * 250, 5000)));
      }
    }
  }
}
