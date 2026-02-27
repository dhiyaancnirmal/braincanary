import { readFile } from "node:fs/promises";
import YAML from "yaml";
import { DeploymentConfigSchema, type DeploymentConfig } from "./schema.js";

export async function loadConfig(path: string): Promise<DeploymentConfig> {
  const raw = await readFile(path, "utf8");
  const parsed = YAML.parse(raw);
  const result = DeploymentConfigSchema.safeParse(parsed);
  if (!result.success) {
    const messages = result.error.issues.map((issue) => {
      const pointer = issue.path.length > 0 ? issue.path.join(".") : "root";
      return `  ${pointer}: ${issue.message}`;
    });
    throw new Error(`Invalid braincanary config:\n${messages.join("\n")}`);
  }
  return result.data;
}
