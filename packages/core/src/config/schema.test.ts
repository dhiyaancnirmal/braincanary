import { describe, expect, it } from "vitest";
import { DeploymentConfigSchema } from "./schema.js";

const validConfig = {
  deployment: {
    name: "support-agent-v2.3",
    project: "support-agent",
    baseline: { model: "gpt-4o-mini", prompt: "support@v2.2" },
    canary: { model: "gpt-4o-mini", prompt: "support@v2.3" },
    stages: [
      {
        weight: 5,
        duration: "10m",
        min_samples: 10,
        gates: [{ scorer: "Correctness", threshold: 0.8 }]
      },
      {
        weight: 100,
        duration: "10m",
        min_samples: 20,
        gates: []
      }
    ]
  }
};

describe("DeploymentConfigSchema", () => {
  it("applies defaults", () => {
    const parsed = DeploymentConfigSchema.parse(validConfig);
    expect(parsed.deployment.runtime.mode).toBe("direct");
    expect(parsed.deployment.monitor.btql.path).toBe("/btql");
    expect(parsed.deployment.monitor.scorer_lag_grace).toBe("2m");
  });

  it("rejects non-increasing stages", () => {
    const input = structuredClone(validConfig);
    input.deployment.stages = [
      input.deployment.stages[0]!,
      {
        weight: 5,
        duration: "10m",
        min_samples: 10,
        gates: []
      },
      {
        weight: 100,
        duration: "10m",
        min_samples: 10,
        gates: []
      }
    ];

    const result = DeploymentConfigSchema.safeParse(input);
    expect(result.success).toBe(false);
  });
});
