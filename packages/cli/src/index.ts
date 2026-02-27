#!/usr/bin/env node
import { defineCommand, runMain } from "citty";
import chalk from "chalk";
import ora from "ora";
import { loadConfig } from "@braincanary/core";
import { BrainCanaryHttpClient } from "./client.js";
import { ensureDaemon } from "./daemon.js";
import { printHistory, printStatus } from "./output.js";

function client(host: string, port: number): BrainCanaryHttpClient {
  return new BrainCanaryHttpClient(`http://${host}:${port}`);
}

const deployCommand = defineCommand({
  meta: {
    name: "deploy",
    description: "Start or update deployment"
  },
  args: {
    config: { type: "string", default: "./braincanary.config.yaml", alias: "c" },
    dryRun: { type: "boolean", default: false },
    detach: { type: "boolean", default: false, alias: "d" },
    verbose: { type: "boolean", default: false, alias: "v" },
    host: { type: "string", default: "127.0.0.1" },
    port: { type: "string", default: "4100" },
    db: { type: "string" }
  },
  run: async ({ args }) => {
    const spinner = ora("Validating config").start();
    try {
      const cfg = await loadConfig(String(args.config));
      spinner.succeed("Config valid");

      if (args.dryRun) {
        console.log(chalk.green("Dry-run successful"));
        console.log(`Stages: ${cfg.deployment.stages.map((s) => `${s.weight}%`).join(" -> ")}`);
        return;
      }

      await ensureDaemon({
        host: String(args.host),
        port: Number(args.port),
        detach: Boolean(args.detach),
        ...(args.db ? { dbPath: String(args.db) } : {})
      });

      const api = client(String(args.host), Number(args.port));
      const result = await api.deploy(String(args.config));
      console.log(chalk.green(`Deployment started: ${result.deployment_id}`));
      console.log(chalk.gray(`State: ${result.state}`));
      console.log(chalk.cyan(`Dashboard: http://${args.host}:${args.port}/dashboard`));
    } catch (error) {
      spinner.fail(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  }
});

const statusCommand = defineCommand({
  meta: { name: "status", description: "Get status" },
  args: {
    host: { type: "string", default: "127.0.0.1" },
    port: { type: "string", default: "4100" },
    json: { type: "boolean", default: false },
    watch: { type: "boolean", default: false, alias: "w" }
  },
  run: async ({ args }) => {
    const api = client(String(args.host), Number(args.port));

    const render = async () => {
      const status = await api.status();
      if (args.json) {
        console.log(JSON.stringify(status, null, 2));
      } else {
        console.clear();
        printStatus(status);
      }
    };

    if (!args.watch) {
      await render();
      return;
    }

    while (true) {
      await render();
      await new Promise((resolve) => setTimeout(resolve, 5_000));
    }
  }
});

const promoteCommand = defineCommand({
  meta: { name: "promote", description: "Promote stage" },
  args: {
    force: { type: "boolean", default: false },
    host: { type: "string", default: "127.0.0.1" },
    port: { type: "string", default: "4100" }
  },
  run: async ({ args }) => {
    const api = client(String(args.host), Number(args.port));
    await api.promote(Boolean(args.force));
    console.log(chalk.green("Promoted"));
  }
});

const rollbackCommand = defineCommand({
  meta: { name: "rollback", description: "Rollback deployment" },
  args: {
    reason: { type: "string" },
    host: { type: "string", default: "127.0.0.1" },
    port: { type: "string", default: "4100" }
  },
  run: async ({ args }) => {
    const api = client(String(args.host), Number(args.port));
    await api.rollback(args.reason ? String(args.reason) : undefined);
    console.log(chalk.yellow("Rollback triggered"));
  }
});

const pauseCommand = defineCommand({
  meta: { name: "pause", description: "Pause stage timer" },
  args: {
    host: { type: "string", default: "127.0.0.1" },
    port: { type: "string", default: "4100" }
  },
  run: async ({ args }) => {
    const api = client(String(args.host), Number(args.port));
    await api.pause();
    console.log(chalk.yellow("Paused"));
  }
});

const resumeCommand = defineCommand({
  meta: { name: "resume", description: "Resume stage timer" },
  args: {
    host: { type: "string", default: "127.0.0.1" },
    port: { type: "string", default: "4100" }
  },
  run: async ({ args }) => {
    const api = client(String(args.host), Number(args.port));
    await api.resume();
    console.log(chalk.green("Resumed"));
  }
});

const historyCommand = defineCommand({
  meta: { name: "history", description: "Show past deployments" },
  args: {
    limit: { type: "string", default: "10" },
    host: { type: "string", default: "127.0.0.1" },
    port: { type: "string", default: "4100" },
    json: { type: "boolean", default: false }
  },
  run: async ({ args }) => {
    const api = client(String(args.host), Number(args.port));
    const history = await api.history(Number(args.limit));
    if (args.json) {
      console.log(JSON.stringify(history, null, 2));
    } else {
      printHistory(history);
    }
  }
});

const validateCommand = defineCommand({
  meta: { name: "validate", description: "Validate config file" },
  args: {
    config: { type: "string", default: "./braincanary.config.yaml", alias: "c" }
  },
  run: async ({ args }) => {
    const spinner = ora("Validating config").start();
    try {
      const cfg = await loadConfig(String(args.config));
      spinner.succeed("Config valid");
      const stages = cfg.deployment.stages.map((s) => `${s.weight}%`).join(" -> ");
      const scorers = new Set<string>();
      for (const stage of cfg.deployment.stages) {
        for (const gate of stage.gates) scorers.add(gate.scorer);
      }
      console.log(`Stages: ${stages}`);
      console.log(`Scorers: ${[...scorers].join(", ") || "none"}`);
    } catch (error) {
      spinner.fail(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  }
});

const main = defineCommand({
  meta: {
    name: "braincanary",
    description: "Progressive canary deployments for AI agents"
  },
  subCommands: {
    deploy: deployCommand,
    status: statusCommand,
    promote: promoteCommand,
    rollback: rollbackCommand,
    pause: pauseCommand,
    resume: resumeCommand,
    history: historyCommand,
    validate: validateCommand
  }
});

runMain(main);
