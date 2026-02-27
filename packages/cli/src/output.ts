import chalk from "chalk";
import Table from "cli-table3";

export function printStatus(status: any): void {
  const deployment = status.deployment;
  if (!deployment) {
    console.log(chalk.yellow("No active deployment"));
    return;
  }

  console.log(chalk.cyan("🐤 BrainCanary — Deployment Status"));
  console.log(`\n  Name: ${deployment.name}`);
  console.log(`  State: ${deployment.state} (${deployment.canary_weight}% canary)`);
  console.log(`  Stage: ${deployment.stage_index + 1} / ${deployment.stage_count}`);

  const table = new Table({
    head: ["Scorer", "Baseline", "Canary", "Delta"],
    style: { head: ["cyan"] }
  });

  for (const [scorer, value] of Object.entries(status.scores ?? {})) {
    const row = value as any;
    const baseline = row.baseline?.mean ?? 0;
    const canary = row.canary?.mean ?? 0;
    const delta = canary - baseline;
    table.push([
      scorer,
      baseline.toFixed(3),
      canary.toFixed(3),
      `${delta > 0 ? "+" : ""}${delta.toFixed(3)}`
    ]);
  }

  console.log("\n" + table.toString());

  if (status.gates?.length) {
    console.log("\n  Gates:");
    for (const gate of status.gates) {
      const emoji = gate.status === "passing" ? "✅" : gate.status === "failing" ? "❌" : "⏳";
      console.log(`  ${emoji} ${gate.scorer} (${gate.status})`);
    }
  }

  if (status.next_action) {
    console.log(`\n  Next action: ${status.next_action}`);
  }
}

export function printHistory(history: any): void {
  const table = new Table({
    head: ["Deployment", "State", "Started", "Completed"],
    style: { head: ["cyan"] }
  });

  for (const item of history.deployments ?? []) {
    table.push([item.name, item.finalState ?? item.state, item.startedAt, item.completedAt ?? "-"]);
  }

  console.log(table.toString());
}
