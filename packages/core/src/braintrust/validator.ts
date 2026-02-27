import type { DeploymentConfig } from "../config/schema.js";
import type { BTQLClient } from "./btql-client.js";

export interface ValidationResult {
  availableScorers: string[];
}

export async function validateBraintrustConfig(
  config: DeploymentConfig,
  btqlClient: BTQLClient
): Promise<ValidationResult> {
  const project = config.deployment.project;

  await btqlClient.query(
    `SELECT count(*) AS n FROM project_logs('${project}', shape => 'traces') LIMIT 1`
  );

  const rows = await btqlClient.query<{ scores: Record<string, number | null> }>(
    `SELECT scores FROM project_logs('${project}', shape => 'traces') LIMIT 100`
  );

  const availableScorers = new Set<string>();
  for (const row of rows) {
    for (const key of Object.keys(row.scores ?? {})) {
      availableScorers.add(key);
    }
  }

  const requiredScorers = new Set<string>();
  for (const stage of config.deployment.stages) {
    for (const gate of stage.gates) {
      requiredScorers.add(gate.scorer);
    }
  }

  for (const scorer of requiredScorers) {
    if (!availableScorers.has(scorer)) {
      throw new Error(
        `Scorer '${scorer}' was not found in Braintrust project '${project}'. Available scorers: ${
          [...availableScorers].join(", ") || "none"
        }`
      );
    }
  }

  return {
    availableScorers: [...availableScorers]
  };
}
